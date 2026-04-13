function daysAgo(dateStr: string): number {
  if (!dateStr) return 999;
  const then = new Date(dateStr);
  if (isNaN(then.getTime())) return 999;
  const now = new Date();
  return Math.floor((now.getTime() - then.getTime()) / (1000 * 60 * 60 * 24));
}

function formatDateTime(dateStr: string): string {
  if (!dateStr) return "No date";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr.split("T")[0];
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export interface ProjectEntry {
  id: string;
  name: string;
  status: string;
  priority: string;
  deadline: string;
  projectStart: string;
  health: string;
  progress: number | null;
  kpi: string;
  strategy: string;
  summary: string;
  taskCount: number;
  peopleCount: number;
  qGoalCount: number;
  campaignCount: number;
  daysAgo: number;
}

export interface QuarterlyGoalEntry {
  id: string;
  name: string;
  status: string;
  keyResult1: string;
  keyResult2: string;
  keyResult3: string;
  progress: number | null;
  health: string;
  keyLearning: string;
  monitor: string;
  projectCount: number;
  annualGoalCount: number;
}

export interface AnnualGoalEntry {
  id: string;
  name: string;
  status: string;
  strategicIntent: string;
  epic: string;
  goalArchetype: string;
  successCondition: string;
  targetValue: string;
  strategicApproach: string;
  keyRisks: string;
  quarterlyGoalCount: number;
  yearCount: number;
}

export interface DirectiveRiskEntry {
  id: string;
  name: string;
  logType: string;
  status: string;
  likelihood: string;
  impact: string;
  threatLevel: string;
  protocolScenario: string;
  lastAssessed: string;
  projectCount: number;
  quarterlyGoalCount: number;
}

export interface OpportunityStrengthEntry {
  id: string;
  name: string;
  logType: string;
  status: string;
  leverageScore: string;
  descriptionActivation: string;
  lastAssessed: string;
  projectCount: number;
  quarterlyGoalCount: number;
}

function arrLen(arr: unknown): number {
  return Array.isArray(arr) ? arr.length : 0;
}

function strVal(v: unknown): string {
  return v != null ? String(v) : "";
}

function numVal(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

export function transformProject(row: Record<string, unknown>): ProjectEntry {
  const deadline = strVal(row.deadline);
  return {
    id: strVal(row.projectId || row.id),
    name: strVal(row.name),
    status: strVal(row.status),
    priority: strVal(row.priority),
    deadline,
    projectStart: strVal(row.projectStart),
    health: strVal(row.health),
    progress: numVal(row.progress),
    kpi: strVal(row.kpi),
    strategy: strVal(row.strategy),
    summary: strVal(row.projectSummary),
    taskCount: arrLen(row.tasks),
    peopleCount: arrLen(row.people),
    qGoalCount: 0, // quarterlyGoal relation not directly stored
    campaignCount: arrLen(row.campaigns),
    daysAgo: deadline ? daysAgo(deadline) : 999,
  };
}

export function transformQuarterlyGoal(row: Record<string, unknown>): QuarterlyGoalEntry {
  return {
    id: strVal(row.goalId || row.id),
    name: strVal(row.name),
    status: strVal(row.status),
    keyResult1: strVal(row.keyResult1),
    keyResult2: strVal(row.keyResult2),
    keyResult3: strVal(row.keyResult3),
    progress: numVal(row.progress),
    health: strVal(row.health),
    keyLearning: strVal(row.keyLearning),
    monitor: strVal(row.monitor),
    projectCount: arrLen(row.projects),
    annualGoalCount: 0, // annual_goal_id is a single ref, not array
  };
}

export function transformAnnualGoal(row: Record<string, unknown>): AnnualGoalEntry {
  return {
    id: strVal(row.goalId || row.id),
    name: strVal(row.name),
    status: strVal(row.status),
    strategicIntent: strVal(row.strategicIntent),
    epic: strVal(row.theEpic),
    goalArchetype: strVal(row.goalArchetype),
    successCondition: strVal(row.successCondition),
    targetValue: strVal(row.targetValue),
    strategicApproach: strVal(row.strategicApproach),
    keyRisks: strVal(row.keyRisks),
    quarterlyGoalCount: arrLen(row.quarterlyGoals),
    yearCount: 0, // years_id is a single ref
  };
}

export function transformDirectiveRisk(row: Record<string, unknown>): DirectiveRiskEntry {
  return {
    id: strVal(row.entryId || row.id),
    name: strVal(row.name),
    logType: strVal(row.logType),
    status: strVal(row.status),
    likelihood: strVal(row.likelihood),
    impact: strVal(row.impact),
    threatLevel: strVal(row.threatLevel),
    protocolScenario: strVal(row.protocolScenario),
    lastAssessed: strVal(row.lastAssessed),
    projectCount: arrLen(row.projects),
    quarterlyGoalCount: 0, // quarterly_goal_id is a single ref
  };
}

export function transformOpportunityStrength(row: Record<string, unknown>): OpportunityStrengthEntry {
  return {
    id: strVal(row.entryId || row.id),
    name: strVal(row.name),
    logType: strVal(row.logType),
    status: strVal(row.status),
    leverageScore: strVal(row.leverageScore),
    descriptionActivation: strVal(row.description),
    lastAssessed: strVal(row.lastAssessed),
    projectCount: arrLen(row.projects),
    quarterlyGoalCount: 0, // quarterly_goal_id is a single ref
  };
}

export function projectsToMarkdown(entries: ProjectEntry[]): string {
  if (entries.length === 0) {
    return "## Projects\n\nNo projects found.";
  }

  const lines = ["## Projects", ""];
  const active = entries.filter((e) => !["Done", "Cancelled", "Someday/Maybe", "On Hold", "Delegated"].includes(e.status));
  const done = entries.filter((e) => ["Done", "Cancelled"].includes(e.status));

  lines.push(`**Total:** ${entries.length} | **Active:** ${active.length} | **Done:** ${done.length}`);
  lines.push("");

  if (active.length > 0) {
    lines.push("### Active Projects");
    lines.push("");
    for (const p of active) {
      const priorityIcon = p.priority.includes("⭐") ? p.priority.substring(0, 2) : "";
      lines.push(`### ${priorityIcon} ${p.name}`);
      lines.push(`- **Status:** ${p.status}`);
      if (p.priority) lines.push(`- **Priority:** ${p.priority}`);
      if (p.deadline) {
        const daysUntil = p.daysAgo * -1;
        const urgency = daysUntil < 0 ? ` ⚠️ ${Math.abs(daysUntil)}d overdue` : daysUntil < 7 ? ` ⚠️ ${daysUntil}d left` : "";
        lines.push(`- **Deadline:** ${formatDateTime(p.deadline)}${urgency}`);
      }
      if (p.progress !== null) lines.push(`- **Progress:** ${p.progress}%`);
      if (p.health) lines.push(`- **Health:** ${p.health}`);
      if (p.summary) lines.push(`- **Summary:** ${p.summary.substring(0, 150)}${p.summary.length > 150 ? "..." : ""}`);
      if (p.strategy) lines.push(`- **Strategy:** ${p.strategy.substring(0, 150)}${p.strategy.length > 150 ? "..." : ""}`);
      if (p.kpi) lines.push(`- **KPI:** ${p.kpi.substring(0, 100)}${p.kpi.length > 100 ? "..." : ""}`);

      const relations = [];
      if (p.taskCount > 0) relations.push(`Tasks(${p.taskCount})`);
      if (p.peopleCount > 0) relations.push(`People(${p.peopleCount})`);
      if (p.qGoalCount > 0) relations.push(`Q Goals(${p.qGoalCount})`);
      if (p.campaignCount > 0) relations.push(`Campaigns(${p.campaignCount})`);
      if (relations.length > 0) lines.push(`- 🔗 ${relations.join(" ")}`);
      lines.push("");
    }
  }

  if (done.length > 0) {
    lines.push("### Completed/Cancelled");
    lines.push("");
    for (const p of done.slice(0, 10)) {
      lines.push(`- ~~${p.name}~~ (${p.status})`);
    }
    if (done.length > 10) {
      lines.push(`- ... and ${done.length - 10} more`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function quarterlyGoalsToMarkdown(entries: QuarterlyGoalEntry[]): string {
  if (entries.length === 0) {
    return "## Quarterly Goals\n\nNo quarterly goals found.";
  }

  const lines = ["## Quarterly Goals", ""];
  const active = entries.filter((e) => !["Done", "Off Track", "At Risk"].includes(e.status));

  lines.push(`**Total:** ${entries.length} | **Active:** ${active.length}`);
  lines.push("");

  for (const g of entries) {
    lines.push(`### ${g.name}`);
    lines.push(`- **Status:** ${g.status}`);
    if (g.progress !== null) lines.push(`- **Progress:** ${g.progress}%`);
    if (g.health) lines.push(`- **Health:** ${g.health}`);
    if (g.keyResult1) lines.push(`- **KR1:** ${g.keyResult1.substring(0, 120)}${g.keyResult1.length > 120 ? "..." : ""}`);
    if (g.keyResult2) lines.push(`- **KR2:** ${g.keyResult2.substring(0, 120)}${g.keyResult2.length > 120 ? "..." : ""}`);
    if (g.keyResult3) lines.push(`- **KR3:** ${g.keyResult3.substring(0, 120)}${g.keyResult3.length > 120 ? "..." : ""}`);
    if (g.keyLearning) lines.push(`- **Learning:** ${g.keyLearning.substring(0, 120)}${g.keyLearning.length > 120 ? "..." : ""}`);
    if (g.monitor) lines.push(`- **Monitor:** ${g.monitor}`);

    const relations = [];
    if (g.projectCount > 0) relations.push(`Projects(${g.projectCount})`);
    if (g.annualGoalCount > 0) relations.push(`Annual(${g.annualGoalCount})`);
    if (relations.length > 0) lines.push(`- 🔗 ${relations.join(" ")}`);
    lines.push("");
  }

  return lines.join("\n");
}

export function annualGoalsToMarkdown(entries: AnnualGoalEntry[]): string {
  if (entries.length === 0) {
    return "## Annual Goals\n\nNo annual goals found.";
  }

  const lines = ["## Annual Goals", ""];
  const active = entries.filter((e) => !["Achieved", "Not Achieved", "Archived"].includes(e.status));

  lines.push(`**Total:** ${entries.length} | **Active:** ${active.length}`);
  lines.push("");

  for (const g of entries) {
    lines.push(`### ${g.name}`);
    lines.push(`- **Status:** ${g.status}`);
    if (g.goalArchetype) lines.push(`- **Archetype:** ${g.goalArchetype}`);
    if (g.strategicIntent) lines.push(`- **Intent:** ${g.strategicIntent.substring(0, 150)}${g.strategicIntent.length > 150 ? "..." : ""}`);
    if (g.epic) lines.push(`- **Epic:** ${g.epic.substring(0, 150)}${g.epic.length > 150 ? "..." : ""}`);
    if (g.targetValue) lines.push(`- **Target:** ${g.targetValue}`);
    if (g.successCondition) lines.push(`- **Success:** ${g.successCondition.substring(0, 120)}${g.successCondition.length > 120 ? "..." : ""}`);
    if (g.keyRisks) lines.push(`- **Risks:** ${g.keyRisks.substring(0, 120)}${g.keyRisks.length > 120 ? "..." : ""}`);
    if (g.strategicApproach) lines.push(`- **Approach:** ${g.strategicApproach.substring(0, 120)}${g.strategicApproach.length > 120 ? "..." : ""}`);

    const relations = [];
    if (g.quarterlyGoalCount > 0) relations.push(`Quarters(${g.quarterlyGoalCount})`);
    if (g.yearCount > 0) relations.push(`Years(${g.yearCount})`);
    if (relations.length > 0) lines.push(`- 🔗 ${relations.join(" ")}`);
    lines.push("");
  }

  return lines.join("\n");
}

export function directivesRisksToMarkdown(entries: DirectiveRiskEntry[]): string {
  if (entries.length === 0) {
    return "## Directives & Risks\n\nNo entries found.";
  }

  const lines = ["## Directives & Risks", ""];
  const risks = entries.filter((e) => e.logType.includes("Risk"));
  const directives = entries.filter((e) => e.logType.includes("Directive"));

  if (risks.length > 0) {
    lines.push(`### 🔥 Risks (${risks.length})`);
    lines.push("");
    for (const r of risks) {
      lines.push(`### ${r.name}`);
      lines.push(`- **Status:** ${r.status}`);
      lines.push(`- **Threat:** ${r.threatLevel} (Likelihood: ${r.likelihood}, Impact: ${r.impact})`);
      if (r.protocolScenario) lines.push(`- **Protocol:** ${r.protocolScenario.substring(0, 150)}${r.protocolScenario.length > 150 ? "..." : ""}`);
      if (r.lastAssessed) lines.push(`- **Last Assessed:** ${r.lastAssessed.split("T")[0]}`);

      const relations = [];
      if (r.projectCount > 0) relations.push(`Projects(${r.projectCount})`);
      if (r.quarterlyGoalCount > 0) relations.push(`Q Goals(${r.quarterlyGoalCount})`);
      if (relations.length > 0) lines.push(`- 🔗 ${relations.join(" ")}`);
      lines.push("");
    }
  }

  if (directives.length > 0) {
    lines.push(`### 🛡️ Directives (${directives.length})`);
    lines.push("");
    for (const d of directives) {
      lines.push(`### ${d.name}`);
      lines.push(`- **Status:** ${d.status}`);
      if (d.protocolScenario) lines.push(`- **Protocol:** ${d.protocolScenario.substring(0, 150)}${d.protocolScenario.length > 150 ? "..." : ""}`);
      if (d.lastAssessed) lines.push(`- **Last Assessed:** ${d.lastAssessed.split("T")[0]}`);

      const relations = [];
      if (d.projectCount > 0) relations.push(`Projects(${d.projectCount})`);
      if (d.quarterlyGoalCount > 0) relations.push(`Q Goals(${d.quarterlyGoalCount})`);
      if (relations.length > 0) lines.push(`- 🔗 ${relations.join(" ")}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

export function opportunitiesStrengthsToMarkdown(entries: OpportunityStrengthEntry[]): string {
  if (entries.length === 0) {
    return "## Opportunities & Strengths\n\nNo entries found.";
  }

  const lines = ["## Opportunities & Strengths", ""];
  const opportunities = entries.filter((e) => e.logType.includes("Opportunity"));
  const strengths = entries.filter((e) => e.logType.includes("Strength"));

  if (opportunities.length > 0) {
    lines.push(`### 💡 Opportunities (${opportunities.length})`);
    lines.push("");
    for (const o of opportunities) {
      lines.push(`### ${o.name}`);
      lines.push(`- **Status:** ${o.status}`);
      lines.push(`- **Leverage:** ${o.leverageScore}`);
      if (o.descriptionActivation) lines.push(`- **Description:** ${o.descriptionActivation.substring(0, 150)}${o.descriptionActivation.length > 150 ? "..." : ""}`);
      if (o.lastAssessed) lines.push(`- **Last Assessed:** ${o.lastAssessed.split("T")[0]}`);

      const relations = [];
      if (o.projectCount > 0) relations.push(`Projects(${o.projectCount})`);
      if (o.quarterlyGoalCount > 0) relations.push(`Q Goals(${o.quarterlyGoalCount})`);
      if (relations.length > 0) lines.push(`- 🔗 ${relations.join(" ")}`);
      lines.push("");
    }
  }

  if (strengths.length > 0) {
    lines.push(`### 💪 Strengths (${strengths.length})`);
    lines.push("");
    for (const s of strengths) {
      lines.push(`### ${s.name}`);
      lines.push(`- **Status:** ${s.status}`);
      lines.push(`- **Leverage:** ${s.leverageScore}`);
      if (s.descriptionActivation) lines.push(`- **Description:** ${s.descriptionActivation.substring(0, 150)}${s.descriptionActivation.length > 150 ? "..." : ""}`);
      if (s.lastAssessed) lines.push(`- **Last Assessed:** ${s.lastAssessed.split("T")[0]}`);

      const relations = [];
      if (s.projectCount > 0) relations.push(`Projects(${s.projectCount})`);
      if (s.quarterlyGoalCount > 0) relations.push(`Q Goals(${s.quarterlyGoalCount})`);
      if (relations.length > 0) lines.push(`- 🔗 ${relations.join(" ")}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}
