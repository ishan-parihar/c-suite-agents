import { randomUUID } from "node:crypto";

export interface ExecutionContext {
  correlationId: string;
  phase?: string;
  agentId?: string;
  sessionId?: string;
  chatId?: string;
  threadId?: string;
  taskId?: string;
  scenario?: string;
}

export function createExecutionContext(seed: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    correlationId: seed.correlationId || randomUUID(),
    phase: seed.phase,
    agentId: seed.agentId,
    sessionId: seed.sessionId,
    chatId: seed.chatId,
    threadId: seed.threadId,
    taskId: seed.taskId,
    scenario: seed.scenario,
  };
}

export function withPhase(ctx: ExecutionContext, phase: string): ExecutionContext {
  return { ...ctx, phase };
}

export function startTimer(): number {
  return Date.now();
}

export function elapsedMs(startedAt: number): number {
  return Date.now() - startedAt;
}

