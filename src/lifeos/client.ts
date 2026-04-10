// Operant MCP Client — Full Suite Integration
// All Operant databases and tools accessible to all core staff agents

import { logger } from "../logger.js";

export type OperantQuery = {
  database: string;
  filter_property?: string;
  filter_value?: string;
  filter_type?: "select" | "status" | "rich_text" | "title" | "formula" | "number" | "date" | "checkbox" | "relation";
  limit?: number;
  sort_property?: string;
  sort_direction?: "ascending" | "descending";
  return_properties?: string[];
};

export type OperantCreate = {
  database: string;
  name: string;
  properties: Record<string, unknown>;
};

export type OperantUpdate = {
  database: string;
  page_id: string;
  properties: Record<string, unknown>;
};

export type OperantFind = {
  database: string;
  search: string;
  limit?: number;
  return_properties?: string[];
};

export type OperantArchive = {
  database: string;
  page_id: string;
};

// All Operant databases
export const OPERANT_DATABASES = [
  // Strategic
  "annual_goals", "quarterly_goals", "projects", "campaigns", "content_pipeline",
  "directives_risk_log", "opportunities_strengths", "people", "quarters", "years",
  // Productivity
  "activity_log", "activity_types", "days", "weeks", "months", "tasks", "reports",
  // Journaling
  "subjective_journal", "relational_journal", "systemic_journal",
  // Health
  "diet_log",
  // Financial
  "financial_log"
] as const;

export type OperantDatabase = typeof OPERANT_DATABASES[number];

// Simulated Operant tool calls (will integrate with actual Operant MCP server)
export class OperantClient {
  async query(params: OperantQuery): Promise<any[]> {
    logger.debug({ database: params.database, filter: params.filter_property }, "Operant query");
    // Placeholder — integrates with actual Operant MCP server
    return [];
  }

  async create(params: OperantCreate): Promise<{ page_id: string }> {
    logger.debug({ database: params.database, name: params.name }, "Operant create");
    return { page_id: `new-${Date.now()}` };
  }

  async update(params: OperantUpdate): Promise<void> {
    logger.debug({ database: params.database, page_id: params.page_id }, "Operant update");
  }

  async find(params: OperantFind): Promise<any[]> {
    logger.debug({ database: params.database, search: params.search }, "Operant find");
    return [];
  }

  async archive(params: OperantArchive): Promise<void> {
    logger.debug({ database: params.database, page_id: params.page_id }, "Operant archive");
  }

  // === STRATEGIC DATABASES ===
  
  async getAnnualGoals(status?: string) {
    return status ? this.query({ database: "annual_goals", filter_property: "Status", filter_value: status }) : this.query({ database: "annual_goals" });
  }
  
  async getQuarterlyGoals(status?: string) {
    return status ? this.query({ database: "quarterly_goals", filter_property: "Status", filter_value: status }) : this.query({ database: "quarterly_goals" });
  }
  
  async getProjects(status?: string) {
    return status ? this.query({ database: "projects", filter_property: "Status", filter_value: status }) : this.query({ database: "projects" });
  }
  
  async getCampaigns(status?: string) {
    return status ? this.query({ database: "campaigns", filter_property: "Status", filter_value: status }) : this.query({ database: "campaigns" });
  }
  
  async getContentPipeline(status?: string) {
    return status ? this.query({ database: "content_pipeline", filter_property: "Status", filter_value: status }) : this.query({ database: "content_pipeline" });
  }
  
  async getDirectivesRisks(status?: string) {
    return status ? this.query({ database: "directives_risk_log", filter_property: "Status", filter_value: status }) : this.query({ database: "directives_risk_log" });
  }
  
  async getOpportunitiesStrengths(status?: string) {
    return status ? this.query({ database: "opportunities_strengths", filter_property: "Status", filter_value: status }) : this.query({ database: "opportunities_strengths" });
  }
  
  async getPeople(search?: string) {
    return search ? this.find({ database: "people", search }) : this.query({ database: "people" });
  }
  
  async getQuarters(status?: string) {
    return status ? this.query({ database: "quarters", filter_property: "Status", filter_value: status }) : this.query({ database: "quarters" });
  }
  
  async getYears(status?: string) {
    return status ? this.query({ database: "years", filter_property: "Status", filter_value: status }) : this.query({ database: "years" });
  }

  // === PRODUCTIVITY DATABASES ===
  
  async getActivityLog(date_from?: string, date_to?: string, category?: string) {
    const params: OperantQuery = { database: "activity_log", limit: 100 };
    if (category) params.filter_property = "Activity Type";
    if (category) params.filter_value = category;
    return this.query(params);
  }
  
  async getActivityTypes() {
    return this.query({ database: "activity_types" });
  }
  
  async getDays(date_from?: string, date_to?: string, status?: string) {
    const params: OperantQuery = { database: "days", limit: 100 };
    if (status) { params.filter_property = "Status"; params.filter_value = status; }
    return this.query(params);
  }
  
  async getWeeks(status?: string) {
    return status ? this.query({ database: "weeks", filter_property: "Status", filter_value: status }) : this.query({ database: "weeks" });
  }
  
  async getMonths(status?: string) {
    return status ? this.query({ database: "months", filter_property: "Status", filter_value: status }) : this.query({ database: "months" });
  }
  
  async getTasks(status?: string, overdue_only?: boolean) {
    const params: OperantQuery = { database: "tasks", limit: 100 };
    if (status) { params.filter_property = "Status"; params.filter_value = status; }
    if (overdue_only) { params.filter_property = "Overdue"; params.filter_value = "true"; }
    return this.query(params);
  }
  
  async getReports(agent?: string) {
    const params: OperantQuery = { database: "reports", limit: 50 };
    if (agent) params.filter_property = "Agent";
    return this.query(params);
  }

  // === JOURNALING DATABASES ===
  
  async getSubjectiveJournal(date_from?: string, date_to?: string, limit?: number) {
    return this.query({ database: "subjective_journal", limit: limit || 20 });
  }
  
  async getRelationalJournal(date_from?: string, date_to?: string, limit?: number) {
    return this.query({ database: "relational_journal", limit: limit || 20 });
  }
  
  async getSystemicJournal(date_from?: string, date_to?: string, limit?: number) {
    return this.query({ database: "systemic_journal", limit: limit || 20 });
  }

  // === HEALTH DATABASES ===
  
  async getDietLog(date_from?: string, date_to?: string, limit?: number) {
    return this.query({ database: "diet_log", limit: limit || 20 });
  }

  // === FINANCIAL DATABASES ===
  
  async getFinancialLog(date_from?: string, date_to?: string, category?: string) {
    const params: OperantQuery = { database: "financial_log", limit: 100 };
    if (category) { params.filter_property = "Category"; params.filter_value = category; }
    return this.query(params);
  }

  // === CONVENIENCE METHODS ===
  
  async getActiveProjects() { return this.getProjects("Active"); }
  async getActiveTasks() { return this.getTasks("Active"); }
  async getOverdueTasks() { return this.getTasks(undefined, true); }
  async getActiveCampaigns() { return this.getCampaigns("Active"); }
  async getActiveQuarterlyGoals() { return this.getQuarterlyGoals("Active"); }
  async getActiveAnnualGoals() { return this.getAnnualGoals("Active"); }
  async getPeopleToReconnect() { return this.query({ database: "people", filter_property: "Reconnect By" }); }
  async getHighImpactRisks() { return this.query({ database: "directives_risk_log", filter_property: "Threat Level", filter_value: "P1: Critical" }); }
  async getHighLeverageOpportunities() { return this.query({ database: "opportunities_strengths", filter_property: "Leverage Score", filter_value: "High" }); }
}

// Singleton instance
export const operant = new OperantClient();

// Export all database names for tool generation
export function getAllDatabases(): string[] {
  return [...OPERANT_DATABASES];
}
