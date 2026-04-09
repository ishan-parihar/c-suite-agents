// Authentication & Authorization Layer

import { v4 as uuidv4 } from "uuid";
import { randomBytes } from "node:crypto";
import { logger } from "../logger.js";
import { getStaffById, getDirectReports, type CoreStaffRole } from "../staff/core-staff.js";
import { getHiringSystem } from "../organic/hiring.js";

export interface AgentSession {
  sessionId: string;
  agentId: string;
  createdAt: number;
  lastActivity: number;
  token: string;
  expiresAt: number;
}

export interface AuthContext {
  sessionId: string;
  agentId: string;
  staff: CoreStaffRole | undefined;
  isHiredAgent: boolean;
}

export class SessionManager {
  private static readonly MAX_SESSIONS = 1000;
  private sessions: Map<string, AgentSession> = new Map();
  private sessionTimeoutMs: number;

  constructor(sessionTimeoutMs: number = 8 * 60 * 60 * 1000) { // 8 hours default
    this.sessionTimeoutMs = sessionTimeoutMs;
  }

  createSession(agentId: string): AgentSession {
    if (this.sessions.size >= SessionManager.MAX_SESSIONS) {
      this.cleanupExpired();
      if (this.sessions.size >= SessionManager.MAX_SESSIONS) {
        throw new Error(`Session limit reached (${SessionManager.MAX_SESSIONS}). Try again later.`);
      }
    }
    const session: AgentSession = {
      sessionId: uuidv4(),
      agentId,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      token: randomBytes(32).toString('hex'),
      expiresAt: Date.now() + this.sessionTimeoutMs
    };
    this.sessions.set(session.sessionId, session);
    logger.info({ agentId, sessionId: session.sessionId }, "Session created");
    return session;
  }

  validateSession(token: string): AgentSession | null {
    const session = Array.from(this.sessions.values())
      .find(s => s.token === token);
    
    if (!session) {
      logger.warn({ token: token.slice(0, 8) + "..." }, "Invalid session token");
      return null;
    }

    if (Date.now() > session.expiresAt) {
      this.sessions.delete(session.sessionId);
      logger.warn({ agentId: session.agentId }, "Session expired");
      return null;
    }

    session.lastActivity = Date.now();
    return session;
  }

  getSession(sessionId: string): AgentSession | null {
    return this.sessions.get(sessionId) || null;
  }

  invalidateSession(sessionId: string): boolean {
    const deleted = this.sessions.delete(sessionId);
    if (deleted) {
      logger.info({ sessionId }, "Session invalidated");
    }
    return deleted;
  }

  invalidateAgentSessions(agentId: string): number {
    let count = 0;
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.agentId === agentId) {
        this.sessions.delete(sessionId);
        count++;
      }
    }
    logger.info({ agentId, count }, "Agent sessions invalidated");
    return count;
  }

  cleanupExpired(): number {
    const now = Date.now();
    let count = 0;
    for (const [sessionId, session] of this.sessions.entries()) {
      if (now > session.expiresAt) {
        this.sessions.delete(sessionId);
        count++;
      }
    }
    if (count > 0) {
      logger.info({ count }, "Expired sessions cleaned up");
    }
    return count;
  }
}

let sessionManager: SessionManager | null = null;
let sessionCleanupTimer: ReturnType<typeof setInterval> | null = null;

export function getSessionManager(): SessionManager {
  if (!sessionManager) {
    sessionManager = new SessionManager();
    sessionCleanupTimer = setInterval(() => sessionManager?.cleanupExpired(), 60 * 60 * 1000);
    if (sessionCleanupTimer && typeof sessionCleanupTimer.unref === "function") sessionCleanupTimer.unref();
  }
  return sessionManager;
}

export function stopSessionManager(): void {
  if (sessionCleanupTimer) {
    clearInterval(sessionCleanupTimer);
    sessionCleanupTimer = null;
  }
  sessionManager = null;
}

export async function validateAgentIdentity(agentId: string): Promise<void> {
  // Check if agent exists in staff registry
  const staff = getStaffById(agentId);
  if (staff) {
    return;
  }

  // Check if agent is a hired auxiliary
  try {
    const hiring = await getHiringSystem();
    const contract = await hiring.getContract(agentId);
    if (contract && contract.status === "active") {
      return;
    }
  } catch {
    // Hiring system not initialized or error — continue to throw
  }

  throw new Error(`Unauthorized agent: ${agentId}`);
}

export async function buildAuthContext(session: AgentSession): Promise<AuthContext> {
  const staff = getStaffById(session.agentId);
  let isHiredAgent = false;

  if (!staff) {
    // Check if hired agent
    try {
      const hiring = await getHiringSystem();
      const contract = await hiring.getContract(session.agentId);
      isHiredAgent = !!(contract && contract.status === "active");
    } catch {
      // Not a hired agent either
    }
  }

  return {
    sessionId: session.sessionId,
    agentId: session.agentId,
    staff,
    isHiredAgent,
  };
}

export async function verifyAgentOwnership(requestedAgentId: string, authContext: AuthContext): Promise<{ authorized: boolean; reason?: string }> {
  // Agent can always access their own resources
  if (authContext.agentId === requestedAgentId) {
    return { authorized: true };
  }

  // Check if agent is a manager of the requested agent
  const reports = getDirectReports(authContext.agentId);
  if (reports.find(r => r.id === requestedAgentId)) {
    return { authorized: true };
  }

  // CEO can access all staff agents
  if (authContext.staff?.id === "ceo-strategic" && authContext.staff?.boardSeat) {
    const targetStaff = getStaffById(requestedAgentId);
    if (targetStaff) {
      return { authorized: true };
    }
  }

  return { 
    authorized: false, 
    reason: `Agent ${authContext.agentId} cannot access resources of ${requestedAgentId}` 
  };
}
