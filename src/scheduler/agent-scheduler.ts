// Agent-Native Scheduler — Cron-like task scheduling for autonomous agents
// Refactored: Uses SessionRegistry for persistent sessions, passes agent param,
// pushes task results to SystemEventQueue for heartbeat injection.

import { logger } from "../logger.js";
import { getCoreStaffIds, getStaffById, AGENT_ID_MAP } from "../staff/core-staff.js";
import { getNativeRuntime } from "../runtime/native-agent-runtime.js";
import { getMessagingSystem } from "../organic/messaging.js";
import { Memory } from "../memory/lancedb.js";
import { getMemoryFacade } from "../memory/index.js";
import { getPromptForRole } from "../staff/prompts.js";
import { sendTelegramMessage } from "../integrations/telegram.js";
import { v4 as uuidv4 } from "uuid";
import { CronExpressionParser } from "cron-parser";
import initSqlJs from "sql.js";
import * as fs from "node:fs/promises";
import { resolve } from "node:path";
import { getSessionRegistry } from "./session-registry.js";
import { SystemEventQueue, currentTimeLine } from "./system-events.js";
import { ErrorBus, createErrorEvent } from "../runtime/error-emitter.js";
import { autoStore } from "../memory/auto.js";

export type ScheduleType =
  | "interval"
  | "cron"
  | "once"
  | "on_event";

export type TaskAction =
  | "query_database"
  | "check_kanban"
  | "send_report"
  | "call_agent"
  | "custom_prompt"
  | "telegram_notify";

export type TaskStatus = "active" | "paused" | "completed" | "failed";

export interface ScheduledTask {
  id: string;
  agent_id: string;
  name: string;
  description: string;
  schedule_type: ScheduleType;
  cron_expression?: string;
  interval_seconds?: number;
  trigger_time?: number;
  event_name?: string;
  action: TaskAction;
  action_params: Record<string, unknown>;
  status: TaskStatus;
  last_run: number;
  next_run: number;
  run_count: number;
  fail_count: number;
  created_at: number;
  enabled: boolean;
}

function safeJsonParse<T>(raw: string | undefined | null, fallback: T): T {
  try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}

export class AgentScheduler {
  private db: any;
  private dbPath: string;
  private running = false;
  private checkIntervalMs: number = 60000;
  private tasks: Map<string, ScheduledTask> = new Map();
  private persistLock = Promise.resolve();
  private persistChainLength = 0;
  private static readonly MAX_CHAIN_LENGTH = 100;

  private constructor(dbPath: string) {
    this.dbPath = dbPath;
    this.db = null;
  }

  static async init(dbPath: string = "scheduler.db"): Promise<AgentScheduler> {
    const instance = new AgentScheduler(dbPath);
    await instance.initializeDB();
    return instance;
  }

  private async initializeDB() {
    const resolved = resolve(this.dbPath);
    if (!resolved.endsWith(".db") && !resolved.endsWith(".sqlite")) {
      throw new Error(`Invalid database path: ${this.dbPath}`);
    }
    this.dbPath = resolved;
    const SQL = await initSqlJs({ locateFile: (f: string) => `node_modules/sql.js/dist/${f}` });

    try {
      const buf = await fs.readFile(this.dbPath);
      this.db = new SQL.Database(new Uint8Array(buf));
    } catch {
      this.db = new SQL.Database();
    }

    this.db.run(`
      CREATE TABLE IF NOT EXISTS scheduled_tasks (
        id TEXT PRIMARY KEY,
        agent_id TEXT,
        name TEXT,
        description TEXT,
        schedule_type TEXT,
        cron_expression TEXT,
        interval_seconds INTEGER,
        trigger_time INTEGER,
        event_name TEXT,
        action TEXT,
        action_params TEXT,
        status TEXT,
        last_run INTEGER,
        next_run INTEGER,
        run_count INTEGER,
        fail_count INTEGER,
        created_at INTEGER,
        enabled INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_agent ON scheduled_tasks(agent_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_next_run ON scheduled_tasks(next_run);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON scheduled_tasks(status);
    `);

    try {
      this.db.run("ALTER TABLE scheduled_tasks ADD COLUMN event_name TEXT");
      await this.persist();
    } catch {
      // Column already exists or table is new
    }

    try {
      this.db.run("CREATE INDEX IF NOT EXISTS idx_tasks_event ON scheduled_tasks(event_name)");
    } catch {
      // Index already exists
    }

    await this.persist();
    await this.loadTasks();
    logger.info({ dbPath: this.dbPath, taskCount: this.tasks.size }, "Agent scheduler initialized");
  }

  private async persist() {
    if (!this.db) return;
    const data = this.db.export();
    const tmpPath = `${this.dbPath}.tmp`;
    const currentLock = this.persistLock;
    this.persistLock = currentLock.then(async () => {
      await fs.writeFile(tmpPath, Buffer.from(data));
      await fs.rename(tmpPath, this.dbPath);
    }).catch(async (err) => {
      try { await fs.unlink(tmpPath); } catch { /* tmp may not exist */ }
      throw err;
    }).finally(() => {
      this.persistLock = Promise.resolve();
      this.persistChainLength = 0;
    });
    await this.persistLock;
  }

  private queryAll(sql: string, params?: unknown[]): Record<string, unknown>[] {
    const stmt = this.db.prepare(sql);
    try {
      if (params) stmt.bind(params.map(p => p === undefined ? null : p));
      const results: Record<string, unknown>[] = [];
      while (stmt.step()) results.push(stmt.getAsObject() as Record<string, unknown>);
      return results;
    } finally {
      stmt.free();
    }
  }

  async close(): Promise<void> {
    this.stop();
    await this.persist();
  }

  private async loadTasks() {
    this.tasks.clear();
    const rows = this.queryAll("SELECT * FROM scheduled_tasks") as Record<string, unknown>[];
    if (!rows.length) return;

    for (const row of rows) {
      const task: ScheduledTask = {
        id: row.id as string,
        agent_id: row.agent_id as string,
        name: row.name as string,
        description: row.description as string,
        schedule_type: row.schedule_type as ScheduleType,
        cron_expression: row.cron_expression as string,
        interval_seconds: row.interval_seconds as number,
        trigger_time: row.trigger_time as number,
        event_name: row.event_name as string,
        action: row.action as TaskAction,
        action_params: safeJsonParse(row.action_params as string, {}),
        status: row.status as TaskStatus,
        last_run: row.last_run as number,
        next_run: row.next_run as number,
        run_count: row.run_count as number,
        fail_count: row.fail_count as number,
        created_at: row.created_at as number,
        enabled: row.enabled === 1
      };
      this.tasks.set(task.id, task);
    }
  }

  async createTask(params: {
    agent_id: string;
    name: string;
    description: string;
    schedule_type: ScheduleType;
    cron_expression?: string;
    interval_seconds?: number;
    trigger_time?: number;
    event_name?: string;
    action: TaskAction;
    action_params: Record<string, unknown>;
  }): Promise<ScheduledTask> {
    const now = Date.now();
    const id = uuidv4();

    let nextRun = now;
    if (params.schedule_type === "interval" && params.interval_seconds) {
      nextRun = now + params.interval_seconds * 1000;
    } else if (params.schedule_type === "once" && params.trigger_time) {
      nextRun = params.trigger_time;
    } else if (params.schedule_type === "cron") {
      nextRun = this.computeNextCron(params.cron_expression || "0 * * * *");
    } else if (params.schedule_type === "on_event") {
      nextRun = 0;
    }

    const task: ScheduledTask = {
      id,
      agent_id: params.agent_id,
      name: params.name,
      description: params.description,
      schedule_type: params.schedule_type,
      cron_expression: params.cron_expression,
      interval_seconds: params.interval_seconds,
      trigger_time: params.trigger_time,
      action: params.action,
      action_params: params.action_params,
      status: "active",
      last_run: 0,
      next_run: nextRun,
      run_count: 0,
      fail_count: 0,
      created_at: now,
      enabled: true
    };

    this.db.run(
      `INSERT INTO scheduled_tasks (id, agent_id, name, description, schedule_type, cron_expression, interval_seconds, trigger_time, event_name, action, action_params, status, last_run, next_run, run_count, fail_count, created_at, enabled)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [task.id, task.agent_id, task.name, task.description, task.schedule_type, task.cron_expression || null, task.interval_seconds || null, task.trigger_time || null, task.event_name || null, task.action, JSON.stringify(task.action_params), task.status, task.last_run, task.next_run, task.run_count, task.fail_count, task.created_at, task.enabled ? 1 : 0]
    );
    await this.persist();
    this.tasks.set(id, task);

    const staff = getStaffById(task.agent_id);
    logger.info({ taskId: id, agentId: task.agent_id, agentName: staff?.name, name: task.name, nextRun: new Date(nextRun).toISOString() }, "Scheduled task created");
    return task;
  }

  async pauseTask(taskId: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    task.enabled = false;
    task.status = "paused";
    this.db.run("UPDATE scheduled_tasks SET enabled = 0, status = 'paused' WHERE id = ?", [taskId]);
    await this.persist();
    logger.info({ taskId }, "Task paused");
    return true;
  }

  async resumeTask(taskId: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    task.enabled = true;
    task.status = "active";
    this.db.run("UPDATE scheduled_tasks SET enabled = 1, status = 'active' WHERE id = ?", [taskId]);
    await this.persist();
    logger.info({ taskId }, "Task resumed");
    return true;
  }

  async deleteTask(taskId: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    this.db.run("DELETE FROM scheduled_tasks WHERE id = ?", [taskId]);
    await this.persist();
    this.tasks.delete(taskId);
    logger.info({ taskId }, "Task deleted");
    return true;
  }

  async triggerTask(eventName: string): Promise<number> {
    const matchingTasks = Array.from(this.tasks.values()).filter(
      t => t.enabled && t.status === "active" && t.schedule_type === "on_event" && t.event_name === eventName
    );
    if (matchingTasks.length === 0) {
      logger.info({ eventName }, "No tasks listening for event");
      return 0;
    }

    let triggered = 0;
    const memory = await this.getMemoryInstance();

    for (const task of matchingTasks) {
      try {
        logger.info({ taskId: task.id, agentId: task.agent_id, eventName }, "Event-triggered task firing");
        task.next_run = Date.now();
        await this.executeTask(task, memory);
        task.last_run = Date.now();
        task.run_count++;

        if (task.action_params.fire_once) {
          task.status = "completed";
          task.enabled = false;
          task.next_run = 0;
        } else {
          task.next_run = 0;
        }

        this.db.run(
          "UPDATE scheduled_tasks SET last_run = ?, next_run = ?, run_count = ?, status = ?, enabled = ? WHERE id = ?",
          [task.last_run, task.next_run, task.run_count, task.status, task.enabled ? 1 : 0, task.id]
        );
        await this.persist();
        triggered++;
      } catch (err: any) {
        logger.error({ taskId: task.id, eventName, err: err.message }, "Event-triggered task failed");
        task.fail_count++;
        this.db.run("UPDATE scheduled_tasks SET fail_count = ? WHERE id = ?", [task.fail_count, task.id]);
        await this.persist();
      }
    }

    return triggered;
  }

  async getTasksForAgent(agentId: string, includeDisabled = false): Promise<ScheduledTask[]> {
    const all = Array.from(this.tasks.values()).filter(t => t.agent_id === agentId);
    return includeDisabled ? all : all.filter(t => t.enabled);
  }

  getAllActiveTasks(): ScheduledTask[] {
    return Array.from(this.tasks.values()).filter(t => t.enabled && t.status === "active");
  }

  async start() {
    if (this.running) {
      logger.warn("Scheduler already running");
      return;
    }

    this.running = true;
    logger.info("Agent scheduler started — checking every 60s");
    this.runSchedulerLoop();
  }

  private schedulerTimer: ReturnType<typeof setTimeout> | null = null;

  stop() {
    this.running = false;
    if (this.schedulerTimer) {
      clearTimeout(this.schedulerTimer);
      this.schedulerTimer = null;
    }
    logger.info("Agent scheduler stopped");
  }

  private runSchedulerLoop() {
    const loop = async () => {
      if (!this.running) return;
      try {
        await this.checkAndRunTasks();
      } catch (err: any) {
        logger.error({ err: err.message }, "Scheduler loop error");
      }
      this.schedulerTimer = setTimeout(loop, this.checkIntervalMs);
      this.schedulerTimer.unref();
    };
    loop();
  }

  private async checkAndRunTasks() {
    const now = Date.now();
    const memory = await this.getMemoryInstance();

    for (const task of this.getAllActiveTasks()) {
      if (task.next_run > now) continue;

      logger.info({ taskId: task.id, agentId: task.agent_id, name: task.name }, "Running scheduled task");

      try {
        await this.executeTask(task, memory);

        // Update task
        task.last_run = now;
        task.run_count++;

        if (task.schedule_type === "once") {
          task.status = "completed";
          task.enabled = false;
          task.next_run = 0;
        } else if (task.schedule_type === "interval" && task.interval_seconds) {
          task.next_run = now + task.interval_seconds * 1000;
        } else if (task.schedule_type === "cron" && task.cron_expression) {
          task.next_run = this.computeNextCron(task.cron_expression);
        }

        this.db.run(
          "UPDATE scheduled_tasks SET last_run = ?, next_run = ?, run_count = ?, status = ?, enabled = ? WHERE id = ?",
          [task.last_run, task.next_run, task.run_count, task.status, task.enabled ? 1 : 0, task.id]
        );
        await this.persist();
      } catch (err: any) {
        logger.error({ taskId: task.id, err: err.message }, "Scheduled task execution failed");
        task.fail_count++;
        this.db.run("UPDATE scheduled_tasks SET fail_count = ? WHERE id = ?", [task.fail_count, task.id]);
        await this.persist();

        // Emit error event via ErrorBus
        ErrorBus.emit({
          type: "cron:failed",
          severity: task.fail_count >= 3 ? "error" : "warn",
          component: "scheduler",
          error: err,
          message: `Scheduled task ${task.id} (${task.name}) failed (fail_count: ${task.fail_count})`,
          agentId: task.agent_id,
          context: { taskId: task.id, failCount: task.fail_count },
        });
      }
    }
  }

  /**
   * Execute a scheduled task using a persistent session (SessionRegistry).
   * Pushes results to SystemEventQueue for heartbeat injection.
   */
  private async executeTask(task: ScheduledTask, memory: Memory) {
    const staff = getStaffById(task.agent_id);
    const promptData = getPromptForRole(task.agent_id);
    const systemPrompt = promptData ? promptData.prompt : "You are a helpful AI assistant.";
    const nativeAgentId = AGENT_ID_MAP[task.agent_id] || task.agent_id;

    // Use SessionRegistry for persistent sessions instead of creating fresh ones
    const sessionRegistry = getSessionRegistry();
    let sessionId = await sessionRegistry.getOrCreate(task.agent_id, {
      title: `cron:${task.id} ${task.name}`
    });

    // Restore session in runtime's ContextManager so sendMessage can find it
    const runtime = getNativeRuntime();
    runtime.restoreSession(nativeAgentId, sessionId);

    // Build task-specific prompt with time injection (OpenClaw pattern)
    const timeLine = currentTimeLine();

    let prompt = `## Scheduled Task Execution
## You are ${staff?.avatar} ${staff?.name} (${staff?.title})

### Task: ${task.name}
### Description: ${task.description}
### Action: ${task.action}

${timeLine}

`;

    switch (task.action) {
      case "query_database":
        prompt += `Query your databases for the following: ${JSON.stringify(task.action_params, null, 2)}\nUse your lifeos tools to fetch and analyze the data. Report any findings, anomalies, or items needing attention.`;
        break;
      case "check_kanban":
        prompt += `Check your Kanban board for blocked, overdue, or stale cards. Report the status and flag anything needing attention.`;
        break;
      case "send_report":
        prompt += `Generate a status report for your domain. Include: current workload, completed items, blockers, and next priorities. Keep it brief and actionable.`;
        break;
      case "call_agent":
        const targetAgent = task.action_params.to_agent as string;
        const message = task.action_params.message as string;
        prompt += `You need to communicate with ${targetAgent}. Here's your message:\n\n${message}\n\nUse your message.send tool to send this.`;
        break;
      case "telegram_notify":
        const notifyText = task.action_params.text as string;
        prompt += `Send a notification to the user via Telegram:\n\n${notifyText}\n\nUse your notify.telegram tool to send this.`;
        break;
      case "custom_prompt":
        prompt += `\n### Custom Instructions:\n${task.action_params.prompt || task.action_params.instructions || ""}\n\nExecute this task and report results.`;
        break;
    }

    // Inject relevant memories for this task
    try {
      const mf = await getMemoryFacade();
      const memoryContext = await mf.injectForTask(task.agent_id, `${task.name} ${task.description}`);
      if (memoryContext) {
        prompt += memoryContext;
      }
    } catch {
      // Memory not ready, skip
    }

    // Send message with agent parameter so the runtime loads the native system prompt
    const result = await runtime.sendMessage(sessionId, prompt, nativeAgentId);
    await sessionRegistry.touch(sessionId);

    if (result.text && result.text.trim().length > 0) {
      // AUTO STORE: Save the scheduled task turn
      await autoStore({
        agentId: task.agent_id,
        inputText: `Task: ${task.name} — ${task.description}`,
        outputText: result.text,
        trigger: "scheduled_task",
        context: { taskId: task.id, domain: task.action },
      });

      // Store result as legacy memory (backward compat)
      await memory.upsertEvent({
        agent_id: task.agent_id,
        type: "log",
        content: `[Scheduled Task: ${task.name}]\n${result.text.slice(0, 1000)}`,
        importance: 0.5,
        tags: ["scheduled-task", task.id]
      });

      // Push result to system event queue for heartbeat injection
      // This ensures the agent sees the task result in its next heartbeat
      await SystemEventQueue.enqueue({
        agentId: task.agent_id,
        text: `[Task: ${task.name}]\n${result.text.slice(0, 500)}`,
        contextKey: `cron:${task.id}`,
        priority: (task.action_params.priority as "P1" | "P2" | "P3" | "P4") || "P3",
      });

      // If task has notify flag, only CEO can send to Telegram
      if (task.action_params.notify_user) {
        await sendTelegramMessage(`${staff?.avatar} **${staff?.name}** — *${task.name}*\n\n${result.text.slice(0, 4000)}`);
      }
    }
  }

  // Full cron parser using cron-parser library
  private computeNextCron(expression: string): number {
    try {
      const interval = CronExpressionParser.parse(expression);
      return interval.next().getTime();
    } catch (err: any) {
      logger.warn({ expression, err: err.message }, "Invalid cron expression, using 1h fallback");
      return Date.now() + 3600000;
    }
  }

  private async getMemoryInstance(): Promise<Memory> {
    if (!this._memoryInstance) {
      this._memoryInstance = await Memory.init(process.env.LANCEDB_DIR || ".lancedb");
    }
    return this._memoryInstance;
  }

  private _memoryInstance: Memory | null = null;
}

let scheduler: AgentScheduler | null = null;

export async function getAgentScheduler(): Promise<AgentScheduler> {
  if (!scheduler) scheduler = await AgentScheduler.init(process.env.SCHEDULER_DB || "scheduler.db");
  return scheduler;
}

export async function startAgentScheduler() {
  const s = await getAgentScheduler();
  await s.start();
  return s;
}
