import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export async function getTransactions() {
  try {
    const result = await db.execute(sql`
      SELECT
        fl.id, fl.name, fl.signed_amount, fl.category, fl.capital_engine,
        fl.date, fl.notes, fl.transaction_type, fl.is_recurring,
        fl.receipt_url, fl.financial_json,
        fl.week_id, fl.month_id, fl.project_id, fl.account_id,
        p.name as project_name,
        fa.name as account_name
      FROM financial_log fl
      LEFT JOIN projects p ON fl.project_id = p.id
      LEFT JOIN financial_accounts fa ON fl.account_id = fa.id
      ORDER BY fl.date DESC NULLS LAST
      LIMIT 2000
    `);
    return result.rows.map((r: any) => ({
      id: r.id, name: r.name, signedAmount: r.signed_amount,
      category: r.category, capitalEngine: r.capital_engine,
      date: r.date, notes: r.notes, transactionType: r.transaction_type,
      isRecurring: r.is_recurring, receiptUrl: r.receipt_url,
      weekId: r.week_id, monthId: r.month_id, projectId: r.project_id,
      accountId: r.account_id, projectName: r.project_name,
      accountName: r.account_name,
    }));
  } catch { return []; }
}
