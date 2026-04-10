"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Wrench } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { MeetingTurn } from "@/lib/server/meetings";

function formatTimestamp(date: Date | null): string {
  if (!date) return "";
  return new Date(date).toLocaleString();
}

function TurnItem({ turn }: { turn: MeetingTurn }) {
  const [isOpen, setIsOpen] = useState(false);
  const panelId = `turn-panel-${turn.id}`;

  return (
    <Card className="bg-surface border-border">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full text-left px-4 py-3 flex items-center justify-between hover:bg-hover/50 transition-colors"
        aria-expanded={isOpen}
        aria-controls={panelId}
      >
        <div className="flex items-center gap-3">
          {isOpen ? (
            <ChevronDown className="h-4 w-4 text-text-muted flex-shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-text-muted flex-shrink-0" />
          )}
          <span className="text-sm font-medium text-text-primary">
            Turn {turn.turnNumber}
          </span>
        </div>
        <span className="text-xs text-text-muted">
          {turn.responses.length} response{turn.responses.length !== 1 ? "s" : ""}
        </span>
      </button>

      <div
        id={panelId}
        role="region"
        className={cn("px-4 pb-4 space-y-4 border-t border-border", !isOpen && "hidden")}
      >
          {turn.ceoDirective && (
            <div>
              <h4 className="text-xs font-medium text-text-secondary uppercase tracking-wider mb-1">
                CEO Directive
              </h4>
              <p className="text-sm text-text-primary whitespace-pre-wrap">{turn.ceoDirective}</p>
            </div>
          )}
          {turn.ceoResponse && (
            <div>
              <h4 className="text-xs font-medium text-text-secondary uppercase tracking-wider mb-1">
                CEO Response
              </h4>
              <p className="text-sm text-text-primary whitespace-pre-wrap">{turn.ceoResponse}</p>
            </div>
          )}
          {turn.synthesis && (
            <div>
              <h4 className="text-xs font-medium text-text-secondary uppercase tracking-wider mb-1">
                Synthesis
              </h4>
              <p className="text-sm text-text-secondary whitespace-pre-wrap">{turn.synthesis}</p>
            </div>
          )}

          {turn.responses.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-text-secondary uppercase tracking-wider mb-2">
                Agent Responses
              </h4>
              <div className="space-y-3">
                {turn.responses.map((resp) => (
                  <Card key={resp.id} variant="default" className="bg-elevated border-border">
                    <CardContent className="py-3">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <span className="text-sm font-medium text-text-primary">
                          {resp.agentId}
                        </span>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {resp.toolCallsMade != null && resp.toolCallsMade > 0 && (
                            <span className="inline-flex items-center gap-1 text-xs text-text-muted">
                              <Wrench className="h-3 w-3" />
                              {resp.toolCallsMade}
                            </span>
                          )}
                          <span className="text-xs text-text-muted">
                            {formatTimestamp(resp.timestamp)}
                          </span>
                        </div>
                      </div>
                      <p className="text-sm text-text-secondary whitespace-pre-wrap">
                        {resp.content}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
      </div>
    </Card>
  );
}

export default function TurnsAccordion({ turns }: { turns: MeetingTurn[] }) {
  if (turns.length === 0) {
    return (
      <div className="text-center text-text-muted text-sm py-8">
        No turns recorded for this meeting.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {turns.map((turn) => (
        <TurnItem key={turn.id} turn={turn} />
      ))}
    </div>
  );
}
