import { Suspense } from "react";
import Link from "next/link";
import { Wallet, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/formatters";
import type { StatusKey } from "@/lib/constants";
import { getAccounts } from "@/lib/server/accounts";

const statusToBadge: Record<string, StatusKey> = {
  Active: "healthy",
  Inactive: "neutral",
};

function AccountCardSkeleton() {
  return <Skeleton variant="card" lines={4} />;
}

async function AccountsContent() {
  const accounts = await getAccounts();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-text-primary">Accounts</h1>
        <p className="text-sm text-text-secondary mt-1">Account management and balances</p>
      </div>

      {accounts.length === 0 ? (
        <Card>
          <CardContent>
            <div className="flex flex-col items-center gap-2 py-12 text-sm text-text-muted">
              <Search className="w-8 h-8" />
              <p>No accounts found</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {accounts.map((account) => {
            const badgeKey = statusToBadge[account.status ?? ""] ?? "warning";
            return (
              <Link key={account.id} href={`/financial/accounts/${account.id}`}>
                <Card className="h-full hover:border-border-strong transition-colors">
                  <CardContent className="p-5 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Wallet className="w-4 h-4 text-text-muted flex-shrink-0" />
                          <h3 className="font-heading text-sm font-medium text-text-primary truncate">
                            {account.name ?? "Unnamed"}
                          </h3>
                        </div>
                        {account.institution && (
                          <p className="text-xs text-text-secondary">{account.institution}</p>
                        )}
                      </div>
                      <Badge status={badgeKey} />
                    </div>

                    <div>
                      <p className="text-2xl font-heading font-semibold tabular-nums text-text-primary">
                        {formatCurrency(account.currentBalance)}
                      </p>
                      {account.currency && (
                        <p className="text-xs text-text-muted mt-0.5">{account.currency}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-3 text-xs text-text-muted">
                      {account.type && (
                        <span className="px-2 py-0.5 rounded bg-elevated">{account.type}</span>
                      )}
                      {account.subType && (
                        <span className="px-2 py-0.5 rounded bg-elevated">{account.subType}</span>
                      )}
                    </div>

                    {account.interestRate != null && (
                      <div className="flex items-center gap-2 text-xs text-text-secondary">
                        <span>Interest</span>
                        <span className="tabular-nums text-healthy">{account.interestRate}%</span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function AccountsPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-6">
          <div>
            <Skeleton variant="text" lines={1} className="w-32" />
            <Skeleton variant="text" lines={1} className="w-48 mt-1" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <AccountCardSkeleton key={i} />
            ))}
          </div>
        </div>
      }
    >
      <AccountsContent />
    </Suspense>
  );
}
