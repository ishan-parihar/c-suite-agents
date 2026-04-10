import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export async function getFinancialOverview() {
  try {
    const result = await db.execute(sql`
      SELECT
        COALESCE(SUM(CASE WHEN signed_amount > 0 THEN signed_amount ELSE 0 END), 0) as total_income,
        COALESCE(SUM(CASE WHEN signed_amount < 0 THEN ABS(signed_amount) ELSE 0 END), 0) as total_expenses,
        COALESCE(SUM(signed_amount), 0) as net_cashflow,
        COUNT(*) as transaction_count
      FROM financial_log
    `);
    const r = result.rows[0] as any;
    return {
      totalIncome: parseFloat(r.total_income) || 0,
      totalExpenses: parseFloat(r.total_expenses) || 0,
      netCashflow: parseFloat(r.net_cashflow) || 0,
      transactionCount: parseInt(r.transaction_count) || 0,
    };
  } catch { return { totalIncome: 0, totalExpenses: 0, netCashflow: 0, transactionCount: 0 }; }
}

export async function getMonthlyTrend() {
  try {
    const result = await db.execute(sql`
      SELECT
        TO_CHAR(date, 'YYYY-MM') as month,
        COALESCE(SUM(CASE WHEN signed_amount > 0 THEN signed_amount ELSE 0 END), 0) as income,
        COALESCE(SUM(CASE WHEN signed_amount < 0 THEN ABS(signed_amount) ELSE 0 END), 0) as expenses,
        COALESCE(SUM(signed_amount), 0) as net
      FROM financial_log
      WHERE date IS NOT NULL
      GROUP BY TO_CHAR(date, 'YYYY-MM')
      ORDER BY month ASC
    `);
    return result.rows.map((r: any) => ({
      month: r.month,
      income: parseFloat(r.income) || 0,
      expenses: parseFloat(r.expenses) || 0,
      net: parseFloat(r.net) || 0,
    }));
  } catch { return []; }
}

export async function getCategoryBreakdown() {
  try {
    const result = await db.execute(sql`
      SELECT
        category,
        COALESCE(SUM(ABS(signed_amount)), 0) as total,
        COUNT(*) as count
      FROM financial_log
      WHERE signed_amount < 0 AND category IS NOT NULL
      GROUP BY category
      ORDER BY total DESC
      LIMIT 10
    `);
    return result.rows.map((r: any) => ({
      category: r.category,
      total: parseFloat(r.total) || 0,
      count: parseInt(r.count) || 0,
    }));
  } catch { return []; }
}

export async function getRecentTransactions() {
  try {
    const result = await db.execute(sql`
      SELECT id, name, signed_amount, category, account_id, date, notes
      FROM financial_log
      ORDER BY date DESC NULLS LAST
      LIMIT 10
    `);
    return result.rows.map((r: any) => ({
      id: r.id, name: r.name, signedAmount: r.signed_amount,
      category: r.category, accountId: r.account_id,
      date: r.date, notes: r.notes,
    }));
  } catch { return []; }
}

export async function getAccountBalances() {
  try {
    const result = await db.execute(sql`
      SELECT id, name, sub_type, status, current_balance, currency, capital_engine
      FROM financial_accounts
      ORDER BY current_balance DESC NULLS LAST
    `);
    return result.rows.map((r: any) => ({
      id: r.id, name: r.name, subType: r.sub_type, status: r.status,
      currentBalance: r.current_balance, currency: r.currency,
      capitalEngine: r.capital_engine,
    }));
  } catch { return []; }
}

export async function getQuarterlyReport() {
  try {
    const result = await db.execute(sql`
      SELECT
        TO_CHAR(date, 'YYYY-Q') as quarter,
        COALESCE(SUM(CASE WHEN signed_amount > 0 THEN signed_amount ELSE 0 END), 0) as income,
        COALESCE(SUM(CASE WHEN signed_amount < 0 THEN ABS(signed_amount) ELSE 0 END), 0) as expenses,
        COALESCE(SUM(signed_amount), 0) as net
      FROM financial_log
      WHERE date IS NOT NULL
      GROUP BY TO_CHAR(date, 'YYYY-Q')
      ORDER BY quarter DESC
    `);
    return result.rows.map((r: any) => ({
      quarter: r.quarter,
      income: parseFloat(r.income) || 0,
      expenses: parseFloat(r.expenses) || 0,
      net: parseFloat(r.net) || 0,
    }));
  } catch { return []; }
}
