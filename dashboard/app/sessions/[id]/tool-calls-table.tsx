"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/formatters";

interface ToolCallData {
  id: string;
  toolIndex: number;
  callId: string | null;
  name: string;
  arguments: unknown;
  result: unknown;
  tokenEstimate: number | null;
  compacted: boolean | null;
  timestamp: Date;
}

function JsonView({ data, label }: { data: unknown; label?: string }) {
  const [collapsed, setCollapsed] = useState(true);
  const str = JSON.stringify(data, null, 2);
  const isLong = str.length > 150;
  const display = collapsed && isLong ? str.slice(0, 150) + "..." : str;

  return (
    <div>
      {label && (
        <button
          onClick={() => isLong && setCollapsed(!collapsed)}
          className="flex items-center gap-1 text-xs text-text-muted hover:text-text-secondary mb-1"
        >
          {isLong ? (
            collapsed ? (
              <ChevronRight className="w-3 h-3" />
            ) : (
              <ChevronDown className="w-3 h-3" />
            )
          ) : null}
          {label}
        </button>
      )}
      <pre className="text-xs font-mono text-text-secondary bg-elevated rounded-md p-2 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap break-all">
        {display}
      </pre>
    </div>
  );
}

export function ToolCallsTable({ toolCalls }: { toolCalls: ToolCallData[] }) {
  if (toolCalls.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-text-muted">
        No tool calls found for this session
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="px-4 py-3 text-left font-medium text-text-secondary uppercase tracking-wider text-xs">
              #
            </th>
            <th className="px-4 py-3 text-left font-medium text-text-secondary uppercase tracking-wider text-xs">
              Tool
            </th>
            <th className="px-4 py-3 text-left font-medium text-text-secondary uppercase tracking-wider text-xs">
              Arguments
            </th>
            <th className="px-4 py-3 text-left font-medium text-text-secondary uppercase tracking-wider text-xs">
              Result
            </th>
            <th className="px-4 py-3 text-left font-medium text-text-secondary uppercase tracking-wider text-xs">
              Tokens
            </th>
            <th className="px-4 py-3 text-left font-medium text-text-secondary uppercase tracking-wider text-xs">
              Status
            </th>
            <th className="px-4 py-3 text-left font-medium text-text-secondary uppercase tracking-wider text-xs">
              Time
            </th>
          </tr>
        </thead>
        <tbody>
          {toolCalls.map((tc) => (
            <tr
              key={tc.id}
              className="border-b border-border last:border-b-0 hover:bg-hover/50 transition-colors"
            >
              <td className="px-4 py-3 font-mono text-text-muted text-xs">
                {tc.toolIndex}
              </td>
              <td className="px-4 py-3">
                <span className="font-mono text-xs text-accent-secondary font-medium">
                  {tc.name}
                </span>
              </td>
              <td className="px-4 py-3 max-w-[200px]">
                <JsonView data={tc.arguments} label="args" />
              </td>
              <td className="px-4 py-3 max-w-[200px]">
                <JsonView data={tc.result} label="result" />
              </td>
              <td className="px-4 py-3">
                {tc.tokenEstimate != null ? (
                  <span className="tabular-nums font-mono text-xs text-text-secondary">
                    ~{tc.tokenEstimate}
                  </span>
                ) : (
                  <span className="text-text-muted text-xs">--</span>
                )}
              </td>
              <td className="px-4 py-3">
                {tc.compacted ? (
                  <span className="text-xs text-text-muted">compacted</span>
                ) : (
                  <span className="text-xs text-healthy">active</span>
                )}
              </td>
              <td className="px-4 py-3 text-xs text-text-muted tabular-nums">
                {formatDate(tc.timestamp, "HH:mm:ss")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
