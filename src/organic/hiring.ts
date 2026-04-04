// Hiring & Delegation System — Team Building

import initSqlJs from "sql.js";
import * as fs from "node:fs/promises";
import { resolve } from "node:path";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../logger.js";
import { getStaffById, CORE_STAFF_ROLES } from "../staff/core-staff.js";
import { getMessagingSystem, type MessagingSystem } from "./messaging.js";
import { Memory } from "../memory/lancedb.js";
import { Kanban } from "../kanban/sqlite.js";

function safeJsonParse<T>(raw: string | undefined | null, fallback: T): T {
  try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}

export type EmploymentStatus = "active" | "terminated" | "on_hold";
export type DelegationStatus = "pending" | "accepted" | "in_progress" | "blocked" | "completed" | "rejected";

export interface EmploymentContract {
  id: string;
  agent_id: string;
  role: string;
  reports_to: string; // Core staff member who hired them
  budget?: number;
  tasks: string[];
  status: EmploymentStatus;
  hired_at: number;
  terminated_at?: number;
  termination_reason?: string;
}

export interface Delegation {
  id: string;
  from: string;
  to: string;
  task: string;
  description: string;
  priority: "P1" | "P2" | "P3" | "P4";
  deadline?: string;
  status: DelegationStatus;
  created_at: number;
  accepted_at?: number;
  completed_at?: number;
  card_id?: string; // Linked Kanban card
}

export class HiringSystem {
  private contracts: Map<string, EmploymentContract> = new Map();
  private delegations: Map<string, Delegation> = new Map();
  private messaging: MessagingSystem | null = null;

  private constructor(private db: any, private dbPath: string) {}

  private async getMessaging(): Promise<MessagingSystem> {
    if (!this.messaging) this.messaging = await getMessagingSystem();
    return this.messaging;
  }

  private queryAll(sql: string, params?: unknown[]): Record<string, unknown>[] {
    const stmt = this.db.prepare(sql);
    if (params) stmt.bind(params);
    const results: Record<string, unknown>[] = [];
    while (stmt.step()) results.push(stmt.getAsObject() as Record<string, unknown>);
    stmt.free();
    return results;
  }

  static async init(dbPath: string = process.env.HIRING_DB || "hiring.db"): Promise<HiringSystem> {
    const resolved = resolve(dbPath);
    if (!resolved.endsWith(".db") && !resolved.endsWith(".sqlite")) {
      throw new Error(`Invalid database path: ${dbPath}`);
    }
    const SQL = await initSqlJs({ locateFile: (f: string) => `node_modules/sql.js/dist/${f}` });
    let db: any;
    try {
      const buf = await fs.readFile(resolved);
      db = new SQL.Database(new Uint8Array(buf));
    } catch {
      db = new SQL.Database();
    }
    db.run(`
      CREATE TABLE IF NOT EXISTS contracts (
        id TEXT PRIMARY KEY,
        agent_id TEXT UNIQUE,
        role TEXT,
        reports_to TEXT,
        budget REAL,
        tasks TEXT,
        status TEXT,
        hired_at INTEGER,
        terminated_at INTEGER,
        termination_reason TEXT
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS delegations (
        id TEXT PRIMARY KEY,
        from_agent TEXT,
        to_agent TEXT,
        task TEXT,
        description TEXT,
        priority TEXT,
        deadline TEXT,
        status TEXT,
        created_at INTEGER,
        accepted_at INTEGER,
        completed_at INTEGER,
        card_id TEXT
      )
    `);
    const hs = new HiringSystem(db, resolved);
    await hs.loadFromDB();
    await hs.persist();
    return hs;
  }

  private async persist() {
    const data = this.db.export();
    const tmpPath = `${this.dbPath}.tmp`;
    await fs.writeFile(tmpPath, Buffer.from(data));
    await fs.rename(tmpPath, this.dbPath);
  }

  async close(): Promise<void> {
    await this.persist();
  }

  private async loadFromDB() {
    const contractRows = this.queryAll("SELECT * FROM contracts") as Record<string, unknown>[];
    for (const row of contractRows) {
      const contract: EmploymentContract = {
        id: row.id as string,
        agent_id: row.agent_id as string,
        role: row.role as string,
        reports_to: row.reports_to as string,
        budget: row.budget as number | undefined,
        tasks: safeJsonParse(row.tasks as string, []),
        status: row.status as EmploymentStatus,
        hired_at: row.hired_at as number,
        terminated_at: row.terminated_at as number | undefined,
        termination_reason: row.termination_reason as string | undefined
      };
      this.contracts.set(contract.agent_id, contract);
    }

    const delegationRows = this.queryAll("SELECT * FROM delegations") as Record<string, unknown>[];
    for (const row of delegationRows) {
      const delegation: Delegation = {
        id: row.id as string,
        from: row.from_agent as string,
        to: row.to_agent as string,
        task: row.task as string,
        description: row.description as string,
        priority: row.priority as "P1" | "P2" | "P3" | "P4",
        deadline: row.deadline as string | undefined,
        status: row.status as DelegationStatus,
        created_at: row.created_at as number,
        accepted_at: row.accepted_at as number | undefined,
        completed_at: row.completed_at as number | undefined,
        card_id: row.card_id as string | undefined
      };
      this.delegations.set(delegation.id, delegation);
    }

    logger.info({ contracts: this.contracts.size, delegations: this.delegations.size }, "Hiring system loaded from database");
  }

  async create({
    role,
    reports_to,
    budget,
    tasks
  }: {
    role: string;
    reports_to: string;
    budget?: number;
    tasks: string[];
  }): Promise<EmploymentContract> {
    if (budget !== undefined) {
      if (typeof budget !== "number" || !Number.isFinite(budget)) {
        throw new Error("Budget must be a finite number");
      }
      if (budget < 0) {
        throw new Error("Budget cannot be negative");
      }
    }

    const existingContracts = await this.getContractsForManager(reports_to);
    const duplicateRole = existingContracts.find(c => c.role === role);
    if (duplicateRole) {
      throw new Error(`Manager ${reports_to} already has an active contract for role "${role}" (agent: ${duplicateRole.agent_id})`);
    }

    const hiringManager = getStaffById(reports_to);
    if (!hiringManager) {
      throw new Error(`Manager ${reports_to} not found`);
    }

    if (hiringManager.autonomyLevel < 3) {
      throw new Error(`Manager ${reports_to} has insufficient autonomy level (${hiringManager.autonomyLevel}) to hire`);
    }

    const agent_id = `${role.toLowerCase().replace(/\s+/g, "-")}-${uuidv4().slice(0, 8)}`;

    const contract: EmploymentContract = {
      id: uuidv4(),
      agent_id,
      role,
      reports_to,
      budget,
      tasks,
      status: "active",
      hired_at: Date.now()
    };

    this.contracts.set(agent_id, contract);

    this.db.run(
      "INSERT OR REPLACE INTO contracts (id, agent_id, role, reports_to, budget, tasks, status, hired_at, terminated_at, termination_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)",
      [contract.id, contract.agent_id, contract.role, contract.reports_to, contract.budget ?? null, JSON.stringify(contract.tasks), contract.status, contract.hired_at]
    );
    await this.persist();

    try {
      const memory = await Memory.init(process.env.LANCEDB_PATH || "lancedb");
      await memory.ensureAgent(agent_id);
      logger.info({ agent_id }, "Hired agent registered in memory system");
    } catch (err: any) {
      logger.error({ agent_id, err: err.message }, "Failed to register agent in memory");
    }

    try {
      const kanban = await Kanban.init(process.env.KANBAN_DB || "kanban.db");
      await kanban.ensureBoard(agent_id, role);
      logger.info({ agent_id }, "Hired agent registered in kanban system");
    } catch (err: any) {
      logger.error({ agent_id, err: err.message }, "Failed to register agent in kanban");
    }

    // Notify the hiring manager
    await (await this.getMessaging()).send({
      from: "system",
      to: reports_to,
      content: `✅ **TEAM MEMBER HIRED**\n\n**Role:** ${role}\n**Agent ID:** ${agent_id}\n**Budget:** ${budget ? `$${budget}` : "N/A"}\n**Tasks:** ${tasks.join(", ")}\n\nYou can now delegate tasks to this team member.`,
      priority: "P3",
      requires_response: false,
      subject: `New Hire: ${role}`
    });

    logger.info({ agent_id, role, reports_to }, "Auxiliary staff hired");

    return contract;
  }

  async fire({
    agent_id,
    reason
  }: {
    agent_id: string;
    reason: string;
  }): Promise<EmploymentContract> {
    const contract = this.contracts.get(agent_id);
    if (!contract) {
      throw new Error(`Contract ${agent_id} not found`);
    }

    contract.status = "terminated";
    contract.terminated_at = Date.now();
    contract.termination_reason = reason;

    this.contracts.set(agent_id, contract);

    this.db.run(
      "UPDATE contracts SET status=?, terminated_at=?, termination_reason=? WHERE agent_id=?",
      [contract.status, contract.terminated_at, contract.termination_reason, agent_id]
    );

    // Cancel all pending delegations
    for (const delegation of this.delegations.values()) {
      if (delegation.to === agent_id && delegation.status === "pending") {
        delegation.status = "rejected";
        this.delegations.set(delegation.id, delegation);
        this.db.run(
          "UPDATE delegations SET status=? WHERE id=?",
          [delegation.status, delegation.id]
        );
      }
    }

    await this.persist();

    // Notify the hiring manager
    await (await this.getMessaging()).send({
      from: "system",
      to: contract.reports_to,
      content: `⚠️ **TEAM MEMBER RELEASED**\n\n**Role:** ${contract.role}\n**Agent ID:** ${agent_id}\n**Reason:** ${reason}\n\nAll pending delegations have been cancelled.`,
      priority: "P2",
      requires_response: false,
      subject: `Contract Terminated: ${contract.role}`
    });

    logger.info({ agent_id, role: contract.role, reason }, "Auxiliary staff released");

    return contract;
  }

  async delegate({
    from,
    to,
    task,
    description,
    priority = "P3",
    deadline
  }: {
    from: string;
    to: string;
    task: string;
    description: string;
    priority?: "P1" | "P2" | "P3" | "P4";
    deadline?: string;
  }): Promise<Delegation> {
    const contract = this.contracts.get(to);
    if (!contract) {
      throw new Error(`Agent ${to} is not a hired team member`);
    }

    if (contract.status !== "active") {
      throw new Error(`Agent ${to} is not active (status: ${contract.status})`);
    }

    if (contract.reports_to !== from) {
      throw new Error(`Agent ${to} does not report to ${from}`);
    }

    if (from === to) {
      throw new Error("Cannot delegate to yourself");
    }

    const delegation_id = uuidv4();
    const delegation: Delegation = {
      id: delegation_id,
      from,
      to,
      task,
      description,
      priority,
      deadline,
      status: "pending",
      created_at: Date.now()
    };

    this.delegations.set(delegation_id, delegation);

    this.db.run(
      "INSERT OR REPLACE INTO delegations (id, from_agent, to_agent, task, description, priority, deadline, status, created_at, accepted_at, completed_at, card_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)",
      [delegation.id, delegation.from, delegation.to, delegation.task, delegation.description, delegation.priority, delegation.deadline ?? null, delegation.status, delegation.created_at]
    );
    await this.persist();

    // Notify the assignee
    await (await this.getMessaging()).send({
      from,
      to,
      content: `📋 **TASK DELEGATED**\n\n**Task:** ${task}\n**Description:** ${description}\n**Priority:** ${priority}\n${deadline ? `**Deadline:** ${deadline}` : ""}\n\nReply "accept" or "reject" to confirm.`,
      priority,
      requires_response: true,
      subject: `Delegation: ${task.slice(0, 30)}`
    });

    logger.info({ delegation_id, from, to, task }, "Task delegated");

    return delegation;
  }

  async acceptDelegation(delegation_id: string): Promise<Delegation> {
    const delegation = this.delegations.get(delegation_id);
    if (!delegation) {
      throw new Error(`Delegation ${delegation_id} not found`);
    }

    delegation.status = "accepted";
    delegation.accepted_at = Date.now();

    this.delegations.set(delegation_id, delegation);

    this.db.run(
      "UPDATE delegations SET status=?, accepted_at=? WHERE id=?",
      [delegation.status, delegation.accepted_at, delegation_id]
    );
    await this.persist();

    logger.info({ delegation_id }, "Delegation accepted");

    return delegation;
  }

  async rejectDelegation(delegation_id: string, reason: string): Promise<Delegation> {
    const delegation = this.delegations.get(delegation_id);
    if (!delegation) {
      throw new Error(`Delegation ${delegation_id} not found`);
    }

    delegation.status = "rejected";

    this.delegations.set(delegation_id, delegation);

    this.db.run(
      "UPDATE delegations SET status=? WHERE id=?",
      [delegation.status, delegation_id]
    );
    await this.persist();

    // Notify the delegator
    await (await this.getMessaging()).send({
      from: delegation.to,
      to: delegation.from,
      content: `❌ **DELEGATION REJECTED**\n\n**Task:** ${delegation.task}\n**Reason:** ${reason}\n\nPlease reassign or discuss.`,
      priority: delegation.priority,
      requires_response: true,
      subject: `Delegation Rejected: ${delegation.task.slice(0, 30)}`
    });

    logger.info({ delegation_id, reason }, "Delegation rejected");

    return delegation;
  }

  async updateStatus(delegation_id: string, status: DelegationStatus): Promise<Delegation> {
    const delegation = this.delegations.get(delegation_id);
    if (!delegation) {
      throw new Error(`Delegation ${delegation_id} not found`);
    }

    delegation.status = status;
    if (status === "completed") {
      delegation.completed_at = Date.now();
    }

    this.delegations.set(delegation_id, delegation);

    this.db.run(
      "UPDATE delegations SET status=?, completed_at=? WHERE id=?",
      [delegation.status, delegation.completed_at ?? null, delegation_id]
    );
    await this.persist();

    // Notify manager if completed
    if (status === "completed") {
      await (await this.getMessaging()).send({
        from: delegation.to,
        to: delegation.from,
        content: `✅ **TASK COMPLETED**\n\n**Task:** ${delegation.task}\n\nReady for review.`,
        priority: "P3",
        requires_response: false,
        subject: `Task Completed: ${delegation.task.slice(0, 30)}`
      });
    }

    logger.info({ delegation_id, status }, "Delegation status updated");

    return delegation;
  }

  async getContract(agent_id: string): Promise<EmploymentContract | null> {
    return this.contracts.get(agent_id) || null;
  }

  async getContractsForManager(manager_id: string): Promise<EmploymentContract[]> {
    return Array.from(this.contracts.values())
      .filter(c => c.reports_to === manager_id && c.status === "active");
  }

  async getDelegation(delegation_id: string): Promise<Delegation | null> {
    return this.delegations.get(delegation_id) || null;
  }

  async getDelegationsForAgent(agent_id: string): Promise<Delegation[]> {
    return Array.from(this.delegations.values())
      .filter(d => d.to === agent_id)
      .sort((a, b) => b.created_at - a.created_at);
  }

  async getDelegationsFromManager(manager_id: string): Promise<Delegation[]> {
    return Array.from(this.delegations.values())
      .filter(d => d.from === manager_id)
      .sort((a, b) => b.created_at - a.created_at);
  }

  async getActiveDelegations(): Promise<Delegation[]> {
    return Array.from(this.delegations.values())
      .filter(d => d.status === "accepted" || d.status === "in_progress" || d.status === "pending")
      .sort((a, b) => b.created_at - a.created_at);
  }
}

// Singleton instance
let hiringSystem: HiringSystem | null = null;

export async function getHiringSystem(): Promise<HiringSystem> {
  if (!hiringSystem) {
    hiringSystem = await HiringSystem.init();
  }
  return hiringSystem;
}
