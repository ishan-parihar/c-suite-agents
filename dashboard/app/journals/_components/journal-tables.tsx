"use client";

import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { DataTable } from "@/components/ui/data-table";
import { formatDate } from "@/lib/formatters";
import { truncate } from "@/lib/utils";
import type {
  SubjectiveEntry,
  RelationalEntry,
  SystemicEntry,
  DietEntry,
} from "@/lib/server/journals";

const subjectColumns: ColumnDef<SubjectiveEntry>[] = [
  {
    accessorKey: "date",
    header: "Date",
    cell: ({ row }) => <span className="tabular">{formatDate(row.original.date)}</span>,
  },
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => (
      <Link href={`/journals/subjective/${row.original.id}`} className="text-accent-secondary hover:underline">
        {row.original.name}
      </Link>
    ),
  },
  {
    accessorKey: "stressLevel",
    header: "Stress Level",
    cell: ({ row }) => {
      const v = row.original.stressLevel;
      if (!v) return "\u2014";
      const color = v === "low" ? "text-healthy" : v === "medium" ? "text-warning" : "text-critical";
      return <span className={`font-medium ${color}`}>{v}</span>;
    },
  },
  {
    accessorKey: "energyLevel",
    header: "Energy",
    cell: ({ row }) => row.original.energyLevel ?? "\u2014",
  },
  {
    accessorKey: "moodTrigger",
    header: "Mood Triggers",
    cell: ({ row }) => {
      const triggers = row.original.moodTrigger;
      if (!triggers || triggers.length === 0) return "\u2014";
      return (
        <div className="flex flex-wrap gap-1">
          {triggers.slice(0, 3).map((t: string, i: number) => (
            <span key={i} className="inline-flex items-center rounded-md bg-elevated px-2 py-0.5 text-xs text-text-secondary border border-border">
              {t}
            </span>
          ))}
          {triggers.length > 3 && <span className="text-xs text-text-muted">+{triggers.length - 3}</span>}
        </div>
      );
    },
  },
];

const relationalColumns: ColumnDef<RelationalEntry>[] = [
  {
    accessorKey: "date",
    header: "Date",
    cell: ({ row }) => <span className="tabular">{formatDate(row.original.date)}</span>,
  },
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => (
      <Link href={`/journals/relational/${row.original.id}`} className="text-accent-secondary hover:underline">
        {row.original.name}
      </Link>
    ),
  },
  {
    accessorKey: "interactionType",
    header: "Type",
    cell: ({ row }) => row.original.interactionType ?? "\u2014",
  },
  {
    accessorKey: "sentiment",
    header: "Sentiment",
    cell: ({ row }) => {
      const v = row.original.sentiment;
      if (!v) return "\u2014";
      const color = v === "positive" ? "text-healthy" : v === "negative" ? "text-critical" : "text-warning";
      return <span className={`font-medium ${color}`}>{v}</span>;
    },
  },
  {
    accessorKey: "followUpNeeded",
    header: "Follow Up",
    cell: ({ row }) => (row.original.followUpNeeded ? <span className="text-warning">Needed</span> : <span className="text-text-muted">Not needed</span>),
  },
];

const systemicColumns: ColumnDef<SystemicEntry>[] = [
  {
    accessorKey: "date",
    header: "Date",
    cell: ({ row }) => <span className="tabular">{formatDate(row.original.date)}</span>,
  },
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => (
      <Link href={`/journals/systemic/${row.original.id}`} className="text-accent-secondary hover:underline">
        {row.original.name}
      </Link>
    ),
  },
  {
    accessorKey: "impact",
    header: "Impact",
    cell: ({ row }) => {
      const v = row.original.impact;
      if (!v) return "\u2014";
      const color = v === "high" ? "text-critical" : v === "medium" ? "text-warning" : "text-healthy";
      return <span className={`font-medium ${color}`}>{v}</span>;
    },
  },
  {
    accessorKey: "aiGeneratedReport",
    header: "AI Report",
    cell: ({ row }) => {
      const report = row.original.aiGeneratedReport;
      if (!report) return "\u2014";
      return <span className="text-text-secondary">{truncate(report, 80)}</span>;
    },
  },
];

const dietColumns: ColumnDef<DietEntry>[] = [
  {
    accessorKey: "date",
    header: "Date",
    cell: ({ row }) => <span className="tabular">{formatDate(row.original.date)}</span>,
  },
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => (
      <Link href={`/journals/diet/${row.original.id}`} className="text-accent-secondary hover:underline">
        {row.original.name}
      </Link>
    ),
  },
  {
    accessorKey: "mealType",
    header: "Meal",
    cell: ({ row }) => row.original.mealType ?? "\u2014",
  },
  {
    accessorKey: "calories",
    header: "Calories",
    cell: ({ row }) => (row.original.calories != null ? <span className="tabular">{row.original.calories}</span> : "\u2014"),
  },
  {
    accessorKey: "proteinG",
    header: "Protein (g)",
    cell: ({ row }) => (row.original.proteinG != null ? <span className="tabular">{row.original.proteinG}</span> : "\u2014"),
  },
  {
    accessorKey: "waterMl",
    header: "Water (ml)",
    cell: ({ row }) => (row.original.waterMl != null ? <span className="tabular">{row.original.waterMl}</span> : "\u2014"),
  },
  {
    accessorKey: "caffeineMg",
    header: "Caffeine (mg)",
    cell: ({ row }) => (row.original.caffeineMg != null ? <span className="tabular">{row.original.caffeineMg}</span> : "\u2014"),
  },
  {
    accessorKey: "mood",
    header: "Mood",
    cell: ({ row }) => row.original.mood ?? "\u2014",
  },
];

export function SubjectiveTable({ data }: { data: SubjectiveEntry[] }) {
  return (
    <DataTable
      columns={subjectColumns}
      data={data}
      searchKey="name"
      searchPlaceholder="Search entries..."
      emptyTitle="No subjective entries found"
      emptyDescription="Start tracking your inner experience — mood, stress, and energy."
    />
  );
}

export function RelationalTable({ data }: { data: RelationalEntry[] }) {
  return (
    <DataTable
      columns={relationalColumns}
      data={data}
      searchKey="name"
      searchPlaceholder="Search entries..."
      emptyTitle="No relational entries found"
      emptyDescription="Track your interactions, relationships, and social patterns."
    />
  );
}

export function SystemicTable({ data }: { data: SystemicEntry[] }) {
  return (
    <DataTable
      columns={systemicColumns}
      data={data}
      searchKey="name"
      searchPlaceholder="Search entries..."
      emptyTitle="No systemic entries found"
      emptyDescription="System-level observations and AI-generated insights will appear here."
    />
  );
}

export function DietTable({ data }: { data: DietEntry[] }) {
  return (
    <DataTable
      columns={dietColumns}
      data={data}
      searchKey="name"
      searchPlaceholder="Search entries..."
      emptyTitle="No diet entries found"
      emptyDescription="Track your meals, weight, and nutritional patterns."
    />
  );
}
