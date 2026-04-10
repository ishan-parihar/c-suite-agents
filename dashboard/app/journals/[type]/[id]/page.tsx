import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight, Pen, UsersRound, Network, Apple } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { formatDate } from "@/lib/formatters";
import {
  getJournalEntryDetail,
  getAdjacentEntries,
  type JournalType,
  type SubjectiveEntry,
  type RelationalEntry,
  type SystemicEntry,
  type DietEntry,
} from "@/lib/server/journals";

const TYPE_CONFIG: Record<JournalType, { label: string; icon: LucideIcon; listPath: string }> = {
  subjective: { label: "Subjective", icon: Pen, listPath: "/journals/subjective" },
  relational: { label: "Relational", icon: UsersRound, listPath: "/journals/relational" },
  systemic: { label: "Systemic", icon: Network, listPath: "/journals/systemic" },
  diet: { label: "Diet Log", icon: Apple, listPath: "/journals/diet" },
};

function isValidJournalType(type: string): type is JournalType {
  return type in TYPE_CONFIG;
}

function SubjectiveDetail({ entry }: { entry: SubjectiveEntry }) {
  const stressColor =
    entry.stressLevel === "low"
      ? "text-healthy"
      : entry.stressLevel === "medium"
        ? "text-warning"
        : entry.stressLevel === "high"
          ? "text-critical"
          : "text-text-secondary";

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <DetailField label="Date" value={formatDate(entry.date)} />
        <DetailField label="Stress Level" value={entry.stressLevel} valueClass={stressColor} />
        <DetailField label="Energy Level" value={entry.energyLevel} />
      </div>

      {entry.moodTrigger && entry.moodTrigger.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-text-secondary uppercase tracking-wider mb-2">
            Mood Triggers
          </h3>
          <div className="flex flex-wrap gap-2">
            {entry.moodTrigger.map((t: string, i: number) => (
              <span
                key={i}
                className="inline-flex items-center rounded-md bg-elevated px-3 py-1 text-sm text-text-secondary border border-border"
              >
                {t}
              </span>
            ))}
          </div>
        </div>
      )}

      {entry.psychograph && (
        <div>
          <h3 className="text-sm font-medium text-text-secondary uppercase tracking-wider mb-2">
            Psychograph
          </h3>
          <Card>
            <CardContent className="py-4">
              <p className="text-text-primary whitespace-pre-wrap">{entry.psychograph}</p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function RelationalDetail({ entry }: { entry: RelationalEntry }) {
  const sentimentColor =
    entry.sentiment === "positive"
      ? "text-healthy"
      : entry.sentiment === "negative"
        ? "text-critical"
        : "text-warning";

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <DetailField label="Date" value={formatDate(entry.date)} />
        <DetailField label="Interaction Type" value={entry.interactionType} />
        <DetailField label="Sentiment" value={entry.sentiment} valueClass={sentimentColor} />
        <DetailField
          label="Follow-up"
          value={entry.followUpNeeded ? "Needed" : "Not needed"}
          valueClass={entry.followUpNeeded ? "text-warning" : "text-healthy"}
        />
      </div>

      {entry.relationshipStatus && entry.relationshipStatus.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-text-secondary uppercase tracking-wider mb-2">
            Relationship Status
          </h3>
          <div className="flex flex-wrap gap-2">
            {entry.relationshipStatus.map((s: string, i: number) => (
              <span
                key={i}
                className="inline-flex items-center rounded-md bg-elevated px-3 py-1 text-sm text-text-secondary border border-border"
              >
                {s}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SystemicDetail({ entry }: { entry: SystemicEntry }) {
  const impactColor =
    entry.impact === "high"
      ? "text-critical"
      : entry.impact === "medium"
        ? "text-warning"
        : "text-healthy";

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <DetailField label="Date" value={formatDate(entry.date)} />
        <DetailField label="Impact" value={entry.impact} valueClass={impactColor} />
      </div>

      {entry.aiGeneratedReport && (
        <div>
          <h3 className="text-sm font-medium text-text-secondary uppercase tracking-wider mb-2">
            AI-Generated Report
          </h3>
          <Card>
            <CardContent className="py-4">
              <p className="text-text-primary whitespace-pre-wrap">{entry.aiGeneratedReport}</p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function DietDetail({ entry }: { entry: DietEntry }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <DetailField label="Date" value={formatDate(entry.date)} />
        <DetailField label="Meal Type" value={entry.mealType} />
        <DetailField label="Log Type" value={entry.logType} />
        <DetailField label="Calories" value={entry.calories?.toString()} />
        <DetailField label="Protein (g)" value={entry.proteinG?.toString()} />
        <DetailField label="Water (ml)" value={entry.waterMl?.toString()} />
        <DetailField label="Caffeine (mg)" value={entry.caffeineMg?.toString()} />
        <DetailField label="Mood" value={entry.mood} />
        <DetailField label="Energy" value={entry.energyLevel} />
      </div>

      {entry.symptoms && entry.symptoms.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-text-secondary uppercase tracking-wider mb-2">
            Symptoms
          </h3>
          <div className="flex flex-wrap gap-2">
            {entry.symptoms.map((s: string, i: number) => (
              <span
                key={i}
                className="inline-flex items-center rounded-md bg-elevated px-3 py-1 text-sm text-text-secondary border border-border"
              >
                {s}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DetailField({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string | null | undefined;
  valueClass?: string;
}) {
  return (
    <div className="rounded-lg bg-surface border border-border px-4 py-3">
      <dt className="text-xs text-text-secondary uppercase tracking-wider">{label}</dt>
      <dd className={`mt-1 text-sm text-text-primary ${valueClass ?? ""}`}>
        {value ?? "\u2014"}
      </dd>
    </div>
  );
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

      <Card>
        <CardHeader>
          <h2 className="text-sm font-medium text-text-primary">Entry Details</h2>
        </CardHeader>
        <CardContent className="pt-4">
          {type === "subjective" && <SubjectiveDetail entry={entry as SubjectiveEntry} />}
          {type === "relational" && <RelationalDetail entry={entry as RelationalEntry} />}
          {type === "systemic" && <SystemicDetail entry={entry as SystemicEntry} />}
          {type === "diet" && <DietDetail entry={entry as DietEntry} />}
        </CardContent>
      </Card>

      {(prevId || nextId) && (
        <div className="flex items-center justify-between">
          {prevId ? (
            <Link
              href={`/journals/${type}/${prevId}`}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-4 py-2 text-sm text-text-secondary hover:bg-hover transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Link>
          ) : (
            <div />
          )}
          {nextId ? (
            <Link
              href={`/journals/${type}/${nextId}`}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-4 py-2 text-sm text-text-secondary hover:bg-hover transition-colors"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Link>
          ) : (
            <div />
          )}
        </div>
      )}
    </div>
  );
}
