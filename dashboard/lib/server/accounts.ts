import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export async function getAccounts() {
  try {
    const result = await db.execute(sql`
      SELECT id, name, institution, status, sub_type, type, capital_engine,
        currency, current_balance, interest_rate, balance_as_of,
        current_status, active_range, last_updated
      FROM financial_accounts
      ORDER BY current_balance DESC NULLS LAST
    `);
    return result.rows.map((r: any) => ({
      id: r.id, name: r.name, institution: r.institution,
      status: r.status, subType: r.sub_type, type: r.type,
      capitalEngine: r.capital_engine, currency: r.currency,
      currentBalance: r.current_balance, interestRate: r.interest_rate,
      balanceAsOf: r.balance_as_of, currentStatus: r.current_status,
      activeRange: r.active_range, lastUpdated: r.last_updated,
    }));
  } catch { return []; }
}

export async function getAccountDetail(id: string) {
  try {
    const result = await db.execute(sql`
      SELECT id, name, institution, status, sub_type, type, capital_engine,
        currency, current_balance, interest_rate, balance_as_of,
        current_status, active_range, last_updated, related_statements,
        related_transactions
      FROM financial_accounts WHERE id = ${id} LIMIT 1
    `);
    if (result.rows.length === 0) return null;
    const r = result.rows[0] as any;
    return {
      id: r.id, name: r.name, institution: r.institution,
      status: r.status, subType: r.sub_type, type: r.type,
      capitalEngine: r.capital_engine, currency: r.currency,
      currentBalance: r.current_balance, interestRate: r.interest_rate,
      balanceAsOf: r.balance_as_of, currentStatus: r.current_status,
      activeRange: r.active_range, lastUpdated: r.last_updated,
      relatedStatements: r.related_statements,
      relatedTransactions: r.related_transactions,
    };
  } catch { return null; }
}

export async function getAccountTransactions(accountId: string) {
  try {
    const result = await db.execute(sql`
      SELECT id, name, signed_amount, category, date, notes, transaction_type
      FROM financial_log
      WHERE account_id = ${accountId}
      ORDER BY date DESC NULLS LAST
      LIMIT 100
    `);
    return result.rows.map((r: any) => ({
      id: r.id, name: r.name, signedAmount: r.signed_amount,
      category: r.category, date: r.date, notes: r.notes,
      transactionType: r.transaction_type,
    }));
  } catch { return []; }
}

export async function getAccountBalanceTrend(accountId: string) {
  try {
    const result = await db.execute(sql`
      SELECT
        TO_CHAR(date, 'YYYY-MM') as month,
        COALESCE(SUM(signed_amount), 0) as net
      FROM financial_log
      WHERE account_id = ${accountId} AND date IS NOT NULL
      GROUP BY TO_CHAR(date, 'YYYY-MM')
      ORDER BY month ASC
    `);
    return result.rows.map((r: any) => ({
      month: r.month,
      net: parseFloat(r.net) || 0,
    }));
  } catch { return []; }
}
