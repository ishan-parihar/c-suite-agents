import { Suspense } from "react";
import { getTransactions } from "@/lib/server/transactions";
import { TransactionsTable } from "./transactions-table";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default async function TransactionsPage() {
  const data = await getTransactions();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl text-text-primary">Transactions</h1>
        <p className="text-text-secondary mt-1">Financial ledger with advanced filtering</p>
      </div>

      <Suspense fallback={<Skeleton variant="table" lines={12} />}>
        <TransactionsTable data={data} />
      </Suspense>
    </div>
  );
}
