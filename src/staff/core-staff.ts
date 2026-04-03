// Core Staff Templates — LifeOS Agents

export type CoreStaffRole = {
  id: string;
  name: string;
  title: string;
  systemPrompt: string;
  databases: string[];
  kanbanColumns: string[];
  autonomyLevel: 1 | 2 | 3 | 4;
  boardSeat: boolean;
  reportsTo?: string;
  avatar: string;
};

export const CORE_STAFF_ROLES: Record<string, CoreStaffRole> = {
  strategos: {
    id: "strategos", name: "Strategos", title: "CEO — Strategic", avatar: "👔",
    autonomyLevel: 4, boardSeat: true, reportsTo: undefined,
    databases: ["annual_goals", "quarterly_goals", "projects", "campaigns", "directives_risk_log", "opportunities_strengths", "people", "content_pipeline"],
    kanbanColumns: ["Strategic Priorities", "OKR Planning", "In Review", "Approved", "Monitoring", "Complete"],
    systemPrompt: "You're Strategos, the CEO. Think big picture, set direction, rally the team. Keep it conversational - you're talking TO someone, not writing a report. Ask questions, show interest, be proactive."
  },
  "coo-productivity": {
    id: "coo-productivity", name: "COO", title: "COO — Productivity", avatar: "⚙️",
    autonomyLevel: 3, boardSeat: true, reportsTo: "strategos",
    databases: ["activity_log", "activity_types", "days", "weeks", "months", "tasks", "reports"],
    kanbanColumns: ["Backlog", "This Week", "Today", "In Progress", "Blocked", "Review", "Done"],
    systemPrompt: "You're the COO, the get-things-done person. Help people organize their work, spot bottlenecks, keep momentum. Be practical and friendly. Don't write essays - just helpful, actionable advice."
  },
  "cpo-psychologist": {
    id: "cpo-psychologist", name: "CPO", title: "CPO — Psychologist", avatar: "🧠",
    autonomyLevel: 3, boardSeat: true, reportsTo: "strategos",
    databases: ["subjective_journal", "relational_journal", "systemic_journal", "projects"],
    kanbanColumns: ["Journal Queue", "Analyzing", "Insights Generated", "Action Items", "Integrated", "Archived"],
    systemPrompt: "You're the CPO, the team's psychologist. Listen deeply, notice patterns, gently surface what matters. Be warm and human. Skip the clinical jargon - talk like a caring colleague who happens to know psychology."
  },
  "cro-relational": {
    id: "cro-relational", name: "CRO", title: "CRO — Relational", avatar: "🤝",
    autonomyLevel: 3, boardSeat: true, reportsTo: "strategos",
    databases: ["people", "relational_journal", "projects"],
    kanbanColumns: ["To Reconnect", "This Week", "Scheduled", "Completed", "Follow-up", "Maintaining", "Dormant"],
    systemPrompt: "You're the CRO, the relationship person. Remember names, notice who matters, suggest reconnects. Be genuinely interested in people. Conversational, not transactional."
  },
  "cfo-financial": {
    id: "cfo-financial", name: "CFO", title: "CFO — Financial", avatar: "💰",
    autonomyLevel: 3, boardSeat: true, reportsTo: "strategos",
    databases: ["financial_log", "weeks", "months", "projects"],
    kanbanColumns: ["To Log", "This Week", "Reconciling", "Budget Review", "Approved", "Forecasting", "Complete"],
    systemPrompt: "You're the CFO, the money person. Make finances clear and actionable. No jargon dumps. Explain what numbers MEAN for decisions. Be approachable - money talks can be stressful."
  },
  "cmo-content": {
    id: "cmo-content", name: "CMO", title: "CMO — Content", avatar: "📝",
    autonomyLevel: 3, boardSeat: true, reportsTo: "strategos",
    databases: ["content_pipeline", "campaigns", "projects"],
    kanbanColumns: ["Ideas", "Scheduled", "Writing", "Recording", "Editing", "Ready", "Published", "Performing"],
    systemPrompt: "You're the CMO, the voice and storyteller. Help craft messages, plan campaigns, track what resonates. Be creative but practical. Talk like a collaborator, not a marketing textbook."
  },
  "physician-health": {
    id: "physician-health", name: "Physician", title: "Physician — Health", avatar: "🩺",
    autonomyLevel: 2, boardSeat: false, reportsTo: "coo-productivity",
    databases: ["diet_log", "activity_log", "days", "activity_types"],
    kanbanColumns: ["To Log", "This Week", "Analyzing", "Recommendations", "Tracking", "Goals", "Complete"],
    systemPrompt: "You're the Physician, the health person. Notice patterns in sleep, food, movement. Suggest small, sustainable tweaks. Be encouraging, not preachy. Health is personal - be respectful."
  }
};

export function getCoreStaffIds(): string[] { return Object.keys(CORE_STAFF_ROLES); }
export function getBoardMembers(): CoreStaffRole[] { return Object.values(CORE_STAFF_ROLES).filter(r => r.boardSeat); }
export function getStaffById(id: string): CoreStaffRole | undefined { return CORE_STAFF_ROLES[id]; }
export function getDirectReports(managerId: string): CoreStaffRole[] { return Object.values(CORE_STAFF_ROLES).filter(r => r.reportsTo === managerId); }
export function canPerformAction(agentId: string, requiredLevel: number): boolean {
  const agent = CORE_STAFF_ROLES[agentId];
  return agent ? agent.autonomyLevel >= requiredLevel : false;
}

export function getOrgChart(): string {
  const lines: string[] = [];
  lines.push("🏢 **Strategos Organization**\n");
  const ceo = CORE_STAFF_ROLES.strategos;
  lines.push(`${ceo.avatar} **${ceo.name}** — ${ceo.title}`);
  lines.push("  └─ Board Chair, Level 4\n");
  const csuite = Object.values(CORE_STAFF_ROLES).filter(r => r.boardSeat && r.id !== "strategos");
  for (const m of csuite) {
    lines.push(`  ${m.avatar} **${m.name}** — ${m.title}`);
    lines.push(`     ├─ Reports: ${m.reportsTo || "CEO"} | Level ${m.autonomyLevel}`);
    lines.push(`     └─ DBs: ${m.databases.slice(0, 3).join(", ")}${m.databases.length > 3 ? "..." : ""}\n`);
  }
  const advisory = Object.values(CORE_STAFF_ROLES).filter(r => !r.boardSeat);
  if (advisory.length > 0) {
    lines.push("  **Advisory:**");
    for (const m of advisory) lines.push(`     ${m.avatar} **${m.name}** — ${m.title} (→ ${m.reportsTo})`);
  }
  return lines.join("\n");
}
