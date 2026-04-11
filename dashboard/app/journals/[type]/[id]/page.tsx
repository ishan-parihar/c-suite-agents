import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Pen, UsersRound, Network, Apple } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  getJournalEntryDetail,
  getAdjacentEntries,
  type JournalType,
  type JournalDetailEntry,
} from "@/lib/server/journals";
import JournalDetailClient from "./journal-detail-client";

const TYPE_CONFIG: Record<JournalType, { label: string; icon: LucideIcon; listPath: string }> = {
  subjective: { label: "Subjective", icon: Pen, listPath: "/journals/subjective" },
  relational: { label: "Relational", icon: UsersRound, listPath: "/journals/relational" },
  systemic: { label: "Systemic", icon: Network, listPath: "/journals/systemic" },
  diet: { label: "Diet Log", icon: Apple, listPath: "/journals/diet" },
};

function isValidJournalType(type: string): type is JournalType {
  return type in TYPE_CONFIG;
}

export default async function JournalEntryPage({
  params,
}: {
  params: Promise<{ type: string; id: string }>;
}) {
  const { type, id } = await params;

  if (!isValidJournalType(type)) {
    notFound();
  }

  const entry = await getJournalEntryDetail(type, id);
  if (!entry) {
    notFound();
  }

  const config = TYPE_CONFIG[type];
  const { prevId, nextId } = await getAdjacentEntries(type, id);
  const Icon = config.icon;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href={config.listPath}
            className="rounded-lg bg-elevated border border-border p-2 hover:bg-hover transition-colors"
          >
            <ArrowLeft className="h-5 w-5 text-text-secondary" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <Icon className="h-4 w-4 text-text-muted" />
              <span className="text-xs text-text-muted uppercase tracking-wider">
                {config.label}
              </span>
            </div>
            <h1 className="font-heading text-2xl text-text-primary mt-0.5">
              {entry.name}
            </h1>
          </div>
        </div>
      </div>

      <JournalDetailClient
        type={type}
        entry={entry as JournalDetailEntry}
        prevId={prevId}
        nextId={nextId}
        initialContent={entry.content ?? null}
      />
    </div>
  );
}
