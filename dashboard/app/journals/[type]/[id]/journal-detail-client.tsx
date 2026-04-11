"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Pen, Loader2, Save, X } from "lucide-react";
import { toast } from "sonner";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { BlockNoteEditor } from "@/components/crud/blocknote-editor";
import { formatDate } from "@/lib/formatters";
import type {
  JournalType,
  SubjectiveDetail,
  RelationalDetail,
  SystemicDetail,
  DietDetail,
} from "@/lib/server/journals";

const ENTITY_TYPE_MAP: Record<JournalType, string> = {
  subjective: "journal-subjective",
  relational: "journal-relational",
  systemic: "journal-systemic",
  diet: "journal-diet",
};

const TYPE_LABELS: Record<JournalType, string> = {
  subjective: "Subjective",
  relational: "Relational",
  systemic: "Systemic",
  diet: "Diet Log",
};

type AnyEntry = SubjectiveDetail | RelationalDetail | SystemicDetail | DietDetail;

interface JournalDetailClientProps {
  type: JournalType;
  entry: AnyEntry;
  prevId: string | null;
  nextId: string | null;
  initialContent: string | null;
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

function SubjectiveDetail({ entry }: { entry: SubjectiveDetail }) {
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

function RelationalDetail({ entry }: { entry: RelationalDetail }) {
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

function SystemicDetail({ entry }: { entry: SystemicDetail }) {
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

function DietDetail({ entry }: { entry: DietDetail }) {
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

function ReadOnlyDetail({ type, entry }: { type: JournalType; entry: AnyEntry }) {
  switch (type) {
    case "subjective":
      return <SubjectiveDetail entry={entry as SubjectiveDetail} />;
    case "relational":
      return <RelationalDetail entry={entry as RelationalDetail} />;
    case "systemic":
      return <SystemicDetail entry={entry as SystemicDetail} />;
    case "diet":
      return <DietDetail entry={entry as DietDetail} />;
  }
}

export default function JournalDetailClient({
  type,
  entry,
  prevId,
  nextId,
  initialContent,
}: JournalDetailClientProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [savedContent, setSavedContent] = useState<string | null>(initialContent);
  const [editorContent, setEditorContent] = useState<string>("");
  const [isSaving, setIsSaving] = useState(false);

  const handleEdit = useCallback(() => {
    setEditorContent(savedContent ?? "");
    setIsEditing(true);
  }, [savedContent]);

  const handleCancel = useCallback(() => {
    setIsEditing(false);
    setEditorContent("");
  }, []);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      const entityType = ENTITY_TYPE_MAP[type];
      const response = await fetch(`/api/crud/${entityType}/${entry.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editorContent }),
      });

      if (!response.ok) {
        throw new Error(`Save failed: ${response.statusText}`);
      }

      setSavedContent(editorContent);
      setIsEditing(false);
      toast.success(`${TYPE_LABELS[type]} entry updated`);
    } catch (err) {
      toast.error(`Failed to save: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setIsSaving(false);
    }
  }, [type, entry.id, editorContent]);

  return (
    <div className="space-y-6">
      {/* Card with edit mode support */}
      <Card className="relative">
        {/* Edit button — floating top-right, only show in read-only mode */}
        {!isEditing && (
          <button
            onClick={handleEdit}
            className="absolute top-3 right-3 z-10 rounded-full bg-elevated border border-border p-2 hover:bg-hover transition-colors"
            title="Edit entry"
          >
            <Pen className="h-4 w-4 text-text-secondary" />
          </button>
        )}

        <CardHeader>
          {isEditing ? (
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-text-primary">
                Editing {entry.name}
              </h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="inline-flex items-center gap-1.5 rounded-md bg-healthy/10 border border-healthy/30 px-3 py-1.5 text-sm text-healthy hover:bg-healthy/20 transition-colors disabled:opacity-50"
                >
                  {isSaving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  {isSaving ? "Saving..." : "Save"}
                </button>
                <button
                  onClick={handleCancel}
                  disabled={isSaving}
                  className="inline-flex items-center gap-1.5 rounded-md bg-elevated border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-hover transition-colors disabled:opacity-50"
                >
                  <X className="h-3.5 w-3.5" />
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <h2 className="text-sm font-medium text-text-primary">Entry Details</h2>
          )}
        </CardHeader>

        <CardContent className="pt-4">
          {isEditing ? (
            <BlockNoteEditor
              initialContent={savedContent ?? undefined}
              onChange={setEditorContent}
              minHeight="300px"
            />
          ) : (
            <ReadOnlyDetail type={type} entry={entry} />
          )}
        </CardContent>
      </Card>

      {/* Prev/Next navigation */}
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
