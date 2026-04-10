"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/formatters";

interface MessageData {
  id: string;
  messageIndex: number;
  role: string;
  content: string;
  tokenEstimate: number | null;
  isSummary: boolean | null;
  compacted: boolean | null;
  timestamp: Date;
}

const roleColors: Record<string, string> = {
  user: "bg-accent-secondary/20 text-accent-secondary",
  assistant: "bg-elevated text-text-primary",
  system: "bg-warning/20 text-warning",
};

const MAX_CONTENT_LENGTH = 300;

function MessageCard({ message }: { message: MessageData }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = message.content.length > MAX_CONTENT_LENGTH;
  const displayContent = isLong && !expanded
    ? message.content.slice(0, MAX_CONTENT_LENGTH)
    : message.content;

  return (
    <div
      className={cn(
        "rounded-lg border p-4 space-y-2",
        message.isSummary
          ? "border-accent/30 bg-accent/10"
          : "border-border bg-surface"
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center px-2 py-0.5 rounded-md text-xs font-mono font-medium",
              roleColors[message.role] ?? "bg-hover text-text-muted"
            )}
          >
            {message.role}
          </span>
          <span className="text-xs text-text-muted">#{message.messageIndex}</span>
          {message.isSummary && (
            <span className="text-xs text-accent-secondary font-medium">summary</span>
          )}
          {message.compacted && (
            <span className="text-xs text-text-muted">compacted</span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-text-muted">
          {message.tokenEstimate != null && (
            <span className="tabular-nums font-mono">~{message.tokenEstimate} tokens</span>
          )}
          <span>{formatDate(message.timestamp, "HH:mm:ss")}</span>
        </div>
      </div>
      <div className="text-sm text-text-primary whitespace-pre-wrap font-sans">
        {displayContent}
        {isLong && !expanded && (
          <span className="text-text-muted">...</span>
        )}
      </div>
      {isLong && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-accent-secondary hover:underline font-medium"
        >
          {expanded ? "Show less" : "Expand"}
        </button>
      )}
    </div>
  );
}

export function MessagesTimeline({ messages }: { messages: MessageData[] }) {
  if (messages.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-text-muted">
        No messages found for this session
      </div>
    );
  }

  return (
    <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-2">
      {messages.map((msg) => (
        <MessageCard key={msg.id} message={msg} />
      ))}
    </div>
  );
}
