"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

const BalanceChart = dynamic(
  () => import("./balance-chart").then((m) => ({ default: m.BalanceChart })),
  {
    ssr: false,
    loading: () => <Skeleton variant="chart" />,
  }
);

export function BalanceChartWrapper({ data }: { data: Array<{ month: string; net: number }> }) {
  return <BalanceChart data={data} />;
}
