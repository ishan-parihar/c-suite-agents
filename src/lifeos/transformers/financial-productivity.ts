import { ActivityEntry } from "./activity-pg.js";

export interface FinancialEntry {
  id: string;
  name: string;
  date: string;
  amount: number | null;
  category: string;
  capitalEngine: string;
  notes: string;
}

export interface FinancialProductivityReport {
  periodLabel: string;
  days: number;
  totalRevenue: number;
  totalExpenses: number;
  netIncome: number;
  revenueByCategory: Map<string, number>;
  expensesByCategory: Map<string, number>;
  revenueByCapitalEngine: Map<string, number>;
  revenuePerHour: number;
  totalWorkHours: number;
  transactionCount: number;
  topTransactions: FinancialEntry[];
  byProject?: Map<string, ProjectFinancials>;
}

export interface ProjectFinancials {
  revenue: number;
  expenses: number;
  net: number;
  transactionCount: number;
}

export function computeFinancialProductivity(
  financialEntries: FinancialEntry[],
  activities: ActivityEntry[],
  dateFrom: string,
  dateTo: string,
  byProject = false,
  includeExpenses = true
): FinancialProductivityReport {
  const startMs = new Date(dateFrom).getTime();
  const endMs = new Date(dateTo).getTime();
  const days = Math.max(1, Math.ceil((endMs - startMs) / (1000 * 60 * 60 * 24)) + 1);

  const revenueCategories = new Map<string, number>();
  const expenseCategories = new Map<string, number>();
  const revenueByEngine = new Map<string, number>();
  let totalRevenue = 0;
  let totalExpenses = 0;
  const topTransactions: FinancialEntry[] = [];

  const revenueCategoryNames = ["Business Revenue", "Client Payment", "Investment Income", "Income"];

  for (const entry of financialEntries) {
    const amount = entry.amount ?? 0;
    const isRevenue = revenueCategoryNames.includes(entry.category);

    if (isRevenue) {
      totalRevenue += amount;
      revenueCategories.set(entry.category, (revenueCategories.get(entry.category) || 0) + amount);
      revenueByEngine.set(entry.capitalEngine, (revenueByEngine.get(entry.capitalEngine) || 0) + amount);
      topTransactions.push(entry);
    } else if (includeExpenses) {
      totalExpenses += amount;
      expenseCategories.set(entry.category, (expenseCategories.get(entry.category) || 0) + amount);
      topTransactions.push(entry);
    }
  }

  // Sort by amount descending for top transactions
  topTransactions.sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));

  // Calculate work hours from activity log
  let totalWorkHours = 0;
  for (const a of activities) {
    const type = a.activityType.toLowerCase();
    if (type.includes("work") || type.includes("business") || type.includes("client") || type.includes("project")) {
      totalWorkHours += a.durationHours ?? 0;
    }
  }

  const revenuePerHour = totalWorkHours > 0 ? totalRevenue / totalWorkHours : 0;

  const report: FinancialProductivityReport = {
    periodLabel: `${dateFrom} → ${dateTo}`,
    days,
    totalRevenue,
    totalExpenses,
    netIncome: totalRevenue - totalExpenses,
    revenueByCategory: revenueCategories,
    expensesByCategory: expenseCategories,
    revenueByCapitalEngine: revenueByEngine,
    revenuePerHour,
    totalWorkHours,
    transactionCount: topTransactions.length,
    topTransactions: topTransactions.slice(0, 10),
  };

  return report;
}

export function financialProductivityToMarkdown(report: FinancialProductivityReport): string {
  const lines: string[] = [];

  lines.push(`# Financial Productivity — ${report.periodLabel}`);
  lines.push("");

  // Summary
  lines.push("## Summary");
  lines.push("");
  lines.push(`- **Revenue:** ₹${report.totalRevenue.toLocaleString()}`);
  lines.push(`- **Expenses:** ₹${report.totalExpenses.toLocaleString()}`);
  lines.push(`- **Net Income:** ₹${report.netIncome.toLocaleString()}`);
  lines.push(`- **Revenue/Work Hour:** ₹${report.revenuePerHour.toFixed(2)}`);
  lines.push(`- **Work Hours:** ${report.totalWorkHours.toFixed(1)}h`);
  lines.push(`- **Transactions:** ${report.transactionCount}`);
  lines.push("");

  // Revenue by category
  if (report.revenueByCategory.size > 0) {
    lines.push("## Revenue by Category");
    lines.push("");
    lines.push("| Category | Amount | % of Total |");
    lines.push("|----------|--------|------------|");
    const sorted = [...report.revenueByCategory.entries()].sort((a, b) => b[1] - a[1]);
    for (const [cat, amount] of sorted) {
      const pct = report.totalRevenue > 0 ? ((amount / report.totalRevenue) * 100).toFixed(0) : "0";
      lines.push(`| ${cat} | ₹${amount.toLocaleString()} | ${pct}% |`);
    }
    lines.push("");
  }

  // Revenue by capital engine
  if (report.revenueByCapitalEngine.size > 0) {
    lines.push("## Revenue by Capital Engine");
    lines.push("");
    lines.push("| Engine | Amount | % of Total |");
    lines.push("|--------|--------|------------|");
    const engineNames: Record<string, string> = {
      "E": "Employment",
      "S": "Self-employment",
      "B": "Business",
      "I": "Investment",
    };
    const sorted = [...report.revenueByCapitalEngine.entries()].sort((a, b) => b[1] - a[1]);
    for (const [engine, amount] of sorted) {
      const pct = report.totalRevenue > 0 ? ((amount / report.totalRevenue) * 100).toFixed(0) : "0";
      const name = engineNames[engine] || engine;
      lines.push(`| ${name} (${engine}) | ₹${amount.toLocaleString()} | ${pct}% |`);
    }
    lines.push("");
  }

  // Expenses by category
  if (report.expensesByCategory.size > 0) {
    lines.push("## Expenses by Category");
    lines.push("");
    lines.push("| Category | Amount | % of Total |");
    lines.push("|----------|--------|------------|");
    const sorted = [...report.expensesByCategory.entries()].sort((a, b) => b[1] - a[1]);
    for (const [cat, amount] of sorted) {
      const pct = report.totalExpenses > 0 ? ((amount / report.totalExpenses) * 100).toFixed(0) : "0";
      lines.push(`| ${cat} | ₹${amount.toLocaleString()} | ${pct}% |`);
    }
    lines.push("");
  }

  // Top transactions
  if (report.topTransactions.length > 0) {
    lines.push("## Top Transactions");
    lines.push("");
    lines.push("| Date | Name | Category | Amount |");
    lines.push("|------|------|----------|--------|");
    for (const t of report.topTransactions) {
      const date = t.date ? t.date.split("T")[0] : "No date";
      lines.push(`| ${date} | ${t.name} | ${t.category} | ₹${(t.amount ?? 0).toLocaleString()} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
