import { Suspense } from "react";
import { TrendingUp, TrendingDown, BarChart3, Receipt, ArrowRight } from "lucide-react";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { ChartCard } from "@/components/ui/chart-card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatDate, formatNumber } from "@/lib/formatters";
import { FinancialChartClient, FinancialChartSkeleton } from "./_components/financial-chart";
import {
  getFinancialOverview,
  getMonthlyTrend,
  getCategoryBreakdown,
  getRecentTransactions,
  getAccountBalances,
  getQuarterlyReport,
} from "@/lib/server/financial";

function FinancialSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} variant="stat" />
        ))}
      </div>
      <FinancialChartSkeleton />
      <Skeleton variant="table" />
    </div>
  );
}

async function FinancialContent() {
  const [
    overview,
    monthlyTrend,
    categoryBreakdown,
    recentTransactions,
    accountBalances,
    quarterlyReport,
  ] = await Promise.all([
    getFinancialOverview(),
    getMonthlyTrend(),
    getCategoryBreakdown(),
    getRecentTransactions(),
    getAccountBalances(),
    getQuarterlyReport(),
  ]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Income"
          value={formatCurrency(overview.totalIncome)}
          icon={TrendingUp}
          subtitle={formatNumber(overview.transactionCount)}
        />
        <StatCard
          title="Total Expenses"
          value={formatCurrency(overview.totalExpenses)}
          icon={TrendingDown}
        />
        <StatCard
          title="Net Cashflow"
          value={formatCurrency(overview.netCashflow)}
          icon={BarChart3}
          trend={{
            value: overview.netCashflow > 0 ? 10 : -5,
            direction: overview.netCashflow > 0 ? "up" : "down",
          }}
        />
        <StatCard
          title="Transactions"
          value={formatNumber(overview.transactionCount)}
          icon={Receipt}
        />
      </div>

      <Suspense fallback={<FinancialChartSkeleton />}>
        <ChartCard
          title="Income vs Expenses"
          subtitle="Last 12 months"
        >
          <FinancialChartClient
            monthlyTrend={monthlyTrend}
            categoryBreakdown={categoryBreakdown}
          />
        </ChartCard>
      </Suspense>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-0 overflow-hidden">
          <CardHeader>
            <h3 className="font-mono text-sm font-medium text-text-primary">Recent Transactions</h3>
            <a href="/financial/transactions" className="text-xs text-accent-secondary hover:text-accent-hover transition-colors">
              View all
              <ArrowRight className="inline h-3 w-3 ml-1" />
            </a>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-4 py-2 text-left text-xs uppercase tracking-wider text-text-muted font-medium">Date</th>
                    <th className="px-4 py-2 text-left text-xs uppercase tracking-wider text-text-muted font-medium">Name</th>
                    <th className="px-4 py-2 text-right text-xs uppercase tracking-wider text-text-muted font-medium">Amount</th>
                    <th className="px-4 py-2 text-left text-xs uppercase tracking-wider text-text-muted font-medium">Category</th>
                  </tr>
                </thead>
                <tbody>
                  {recentTransactions.map((tx) => (
                    <tr key={tx.id} className="border-b border-border/50 hover:bg-hover/30 transition-colors">
                      <td className="px-4 py-2 font-mono text-xs tabular-nums text-text-secondary">
                        {formatDate(tx.date, "MMM d, yyyy")}
                      </td>
                      <td className="px-4 py-2 text-text-primary">{tx.name}</td>
                      <td className={`px-4 py-2 text-right font-mono text-xs tabular-nums ${tx.signedAmount >= 0 ? "text-healthy" : "text-critical"}`}>
                        {formatCurrency(tx.signedAmount)}
                      </td>
                      <td className="px-4 py-2 text-text-secondary">{tx.category}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card className="p-0 overflow-hidden">
          <CardHeader>
            <h3 className="font-mono text-sm font-medium text-text-primary">Account Balances</h3>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {accountBalances.map((acct) => (
                <a
                  key={acct.id}
                  href={`/financial/accounts/${acct.id}`}
                  className="block rounded-md border border-border bg-elevated p-3 hover:border-border-strong transition-colors"
                >
                  <p className="text-sm font-medium text-text-primary truncate">{acct.name}</p>
                  <p className="font-mono text-lg tabular-nums text-text-primary mt-1">
                    {formatCurrency(acct.currentBalance ?? 0)}
                  </p>
                  <p className="text-xs text-text-muted mt-1">{acct.subType}</p>
                </a>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="p-0 overflow-hidden">
        <CardHeader>
          <h3 className="font-mono text-sm font-medium text-text-primary">Quarterly Summary</h3>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-2 text-left text-xs uppercase tracking-wider text-text-muted font-medium">Quarter</th>
                  <th className="px-4 py-2 text-right text-xs uppercase tracking-wider text-text-muted font-medium">Income</th>
                  <th className="px-4 py-2 text-right text-xs uppercase tracking-wider text-text-muted font-medium">Expenses</th>
                  <th className="px-4 py-2 text-right text-xs uppercase tracking-wider text-text-muted font-medium">Net</th>
                </tr>
              </thead>
              <tbody>
                {quarterlyReport.map((q) => (
                  <tr key={q.quarter} className="border-b border-border/50 hover:bg-hover/30 transition-colors">
                    <td className="px-4 py-2 font-mono text-xs tabular-nums text-text-secondary">Q{q.quarter.split("-")[1]} {q.quarter.split("-")[0]}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs tabular-nums text-healthy">
                      {formatCurrency(q.income)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs tabular-nums text-critical">
                      {formatCurrency(q.expenses)}
                    </td>
                    <td className={`px-4 py-2 text-right font-mono text-xs tabular-nums ${q.net >= 0 ? "text-healthy" : "text-critical"}`}>
                      {formatCurrency(q.net)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default async function FinancialPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Financial Dashboard</h1>
        <p className="mt-1 text-sm text-text-muted">Executive financial overview</p>
      </div>

      <Suspense fallback={<FinancialSkeleton />}>
        <FinancialContent />
      </Suspense>
    </div>
  );
}
