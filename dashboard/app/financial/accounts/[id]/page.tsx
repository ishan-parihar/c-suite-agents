import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft, Wallet, Percent, Calendar, FileText } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/ui/stat-card";
import { formatCurrency, formatDate, formatNumber, formatPercent } from "@/lib/formatters";
import type { StatusKey } from "@/lib/constants";
import { getAccountDetail, getAccountTransactions, getAccountBalanceTrend } from "@/lib/server/accounts";
import { BalanceChartWrapper } from "./_components/balance-chart-wrapper";

const statusToBadge: Record<string, StatusKey> = {
  Active: "healthy",
  Inactive: "neutral",
};

interface DetailPageProps {
  params: Promise<{ id: string }>;
}

function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton variant="text" lines={2} className="mb-8" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} variant="stat" />
        ))}
      </div>
      <Skeleton variant="chart" />
      <Skeleton variant="table" lines={10} />
    </div>
  );
}

async function AccountDetail({ id }: { id: string }) {
  const account = await getAccountDetail(id);

  if (!account) {
    return (
      <div className="bg-surface border border-border rounded-lg px-5 py-12 text-center text-sm text-text-muted">
        Account not found
      </div>
    );
  }

  const [transactions, balanceTrend] = await Promise.all([
    getAccountTransactions(id),
    getAccountBalanceTrend(id),
  ]);

  const badgeKey = statusToBadge[account.status ?? ""] ?? "warning";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link
          href="/financial/accounts"
          className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Accounts
        </Link>
      </div>

      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-lg bg-elevated flex items-center justify-center flex-shrink-0">
          <Wallet className="w-5 h-5 text-text-secondary" />
        </div>
        <div>
          <h1 className="font-heading text-2xl font-semibold text-text-primary">
            {account.name ?? "Unnamed"}
          </h1>
          <div className="flex items-center gap-3 mt-1">
            {account.institution && (
              <span className="text-sm text-text-secondary">{account.institution}</span>
            )}
            <Badge status={badgeKey} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Current Balance"
          value={formatCurrency(account.currentBalance)}
          icon={Wallet}
        />
        <StatCard
          title="Interest Rate"
          value={formatPercent(account.interestRate)}
          icon={Percent}
        />
        <StatCard
          title="Last Updated"
          value={formatDate(account.lastUpdated)}
          icon={Calendar}
        />
        <StatCard
          title="Transactions"
          value={formatNumber(transactions.length)}
          icon={FileText}
        />
      </div>

      <BalanceChartWrapper data={balanceTrend} />

      <Card>
        <CardHeader>
          <h2 className="font-heading text-sm font-medium text-text-primary">Recent Transactions</h2>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-elevated">
                  <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Date</th>
                  <th className="text-right text-xs font-medium text-text-muted px-5 py-3">Amount</th>
                  <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Category</th>
                  <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {transactions.slice(0, 20).map((tx) => {
                  const amount = tx.signedAmount ?? 0;
                  const isPositive = amount >= 0;
                  return (
                    <tr key={tx.id} className="hover:bg-hover/50 transition-colors">
                      <td className="px-5 py-3 tabular text-text-secondary">
                        {formatDate(tx.date)}
                      </td>
                      <td className={`px-5 py-3 tabular text-right font-medium ${isPositive ? "text-healthy" : "text-critical"}`}>
                        {formatCurrency(amount)}
                      </td>
                      <td className="px-5 py-3 text-text-secondary">
                        {tx.category ?? "\u2014"}
                      </td>
                      <td className="px-5 py-3 text-text-primary">
                        {tx.name ?? tx.notes ?? "\u2014"}
                      </td>
                    </tr>
                  );
                })}
                {transactions.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-5 py-12 text-center text-sm text-text-muted">
                      No transactions found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default async function AccountDetailPage({ params }: DetailPageProps) {
  const { id } = await params;

  return (
    <Suspense fallback={<DetailSkeleton />}>
      <AccountDetail id={id} />
    </Suspense>
  );
}
