"use client";

import { useState, useMemo, useCallback } from "react";
import {
  Search,
  Send,
  Plus,
  MessageSquare,
  Clock,
  User,
  ChevronDown,
  Tag,
  AlertCircle,
  CheckCircle,
  X,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { cn, truncate } from "@/lib/utils";
import { getThreadMessages, getThreadEscalations, type MessageThread } from "@/lib/server/messaging";

function statusToBadge(status: string | null): { color: string; label: string } {
  if (status === "active") return { color: "var(--status-healthy)", label: "Active" };
  if (status === "archived") return { color: "var(--status-neutral)", label: "Archived" };
  return { color: "var(--status-neutral)", label: status ?? "Unknown" };
}

function priorityToBadge(priority: string | null): { color: string; label: string } {
  switch (priority) {
    case "P1":
      return { color: "var(--status-critical)", label: "P1" };
    case "P2":
      return { color: "var(--status-warning)", label: "P2" };
    case "P3":
      return { color: "var(--status-neutral)", label: "P3" };
    case "P4":
      return { color: "var(--text-muted)", label: "P4" };
    default:
      return { color: "var(--status-neutral)", label: priority ?? "P3" };
  }
}

function InlineBadge({
  color,
  label,
  className,
}: {
  color: string;
  label: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium",
        className
      )}
      style={{ backgroundColor: `${color}20`, color }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

function formatParticipants(participants: unknown): string {
  if (Array.isArray(participants)) {
    return participants.slice(0, 3).join(", ");
  }
  if (typeof participants === "string") {
    try {
      const parsed = JSON.parse(participants);
      if (Array.isArray(parsed)) return parsed.slice(0, 3).join(", ");
    } catch {
      return participants;
    }
  }
  return "Unknown";
}

function formatTags(tags: unknown): string[] {
  if (Array.isArray(tags)) return tags;
  if (typeof tags === "string") {
    try {
      return JSON.parse(tags);
    } catch {
      return [];
    }
  }
  return [];
}

function formatRelativeDate(date: Date | null): string {
  if (!date) return "Never";
  const now = new Date();
  const then = new Date(date);
  const diffMs = now.getTime() - then.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return then.toLocaleDateString();
}

function formatTimestamp(date: Date | null): string {
  if (!date) return "";
  return new Date(date).toLocaleString();
}

interface ComposeModalProps {
  onClose: () => void;
  onSend: (data: ComposeData) => void;
}

interface ComposeData {
  toAgent: string;
  subject: string;
  content: string;
  priority: string;
  requiresResponse: boolean;
}

function ComposeModal({ onClose, onSend }: ComposeModalProps) {
  const [toAgent, setToAgent] = useState("");
  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");
  const [priority, setPriority] = useState("P3");
  const [requiresResponse, setRequiresResponse] = useState(false);

  const handleSend = () => {
    if (!toAgent || !subject || !content) return;
    onSend({ toAgent, subject, content, priority, requiresResponse });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60">
      <Card className="w-full max-w-lg bg-elevated border-border">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-lg font-semibold text-text-primary">New Message</h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-hover transition-colors text-text-secondary"
            aria-label="Close compose modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-4 py-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">To Agent</label>
            <input
              type="text"
              value={toAgent}
              onChange={(e) => setToAgent(e.target.value)}
              placeholder="e.g. CEO-Strategic"
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-border-strong focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Subject</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Thread subject"
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-border-strong focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Content</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Message content..."
              rows={5}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-border-strong focus:outline-none resize-none"
            />
          </div>
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-sm font-medium text-text-secondary mb-1">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:border-border-strong focus:outline-none"
              >
                <option value="P1">P1 — Critical</option>
                <option value="P2">P2 — High</option>
                <option value="P3">P3 — Normal</option>
                <option value="P4">P4 — Low</option>
              </select>
            </div>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={requiresResponse}
                  onChange={(e) => setRequiresResponse(e.target.checked)}
                  className="rounded border-border bg-surface text-accent focus:ring-border-strong"
                />
                <span className="text-sm text-text-secondary">Requires response</span>
              </label>
            </div>
          </div>
        </div>
        <div className="px-4 py-3 border-t border-border flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-text-secondary rounded-md border border-border hover:bg-hover transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={!toAgent || !subject || !content}
            className="px-4 py-2 text-sm bg-accent text-text-primary rounded-md hover:bg-accent-hover transition-colors disabled:opacity-40 disabled:pointer-events-none flex items-center gap-2"
          >
            <Send className="h-4 w-4" />
            Send
          </button>
        </div>
      </Card>
    </div>
  );
}

export interface ThreadMessage {
  id: string;
  threadId: string;
  fromAgent: string;
  toAgent: string;
  content: string;
  priority: string | null;
  requiresResponse: boolean | null;
  responded: boolean | null;
  createdAt: Date | null;
  read: boolean | null;
  tags: unknown;
}

export interface ThreadEscalation {
  id: string;
  threadId: string;
  fromAgent: string;
  toAgent: string;
  reason: string;
  createdAt: Date | null;
  status: string | null;
}

export function MessagesClient({ initialThreads }: { initialThreads: MessageThread[] }) {
  const [threads, setThreads] = useState<MessageThread[]>(initialThreads);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [escalations, setEscalations] = useState<ThreadEscalation[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [showCompose, setShowCompose] = useState(false);
  const [replyContent, setReplyContent] = useState("");

  const loadThread = useCallback(async (threadId: string) => {
    try {
      const [msgs, escs] = await Promise.all([
        getThreadMessages(threadId),
        getThreadEscalations(threadId),
      ]);
      setMessages(msgs);
      setEscalations(escs);
    } catch {
      setMessages([]);
    }
  }, []);

  const filteredThreads = useMemo(() => {
    return threads.filter((thread) => {
      const subjectMatch =
        thread.subject?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false;
      const participantMatch = formatParticipants(thread.participants)
        .toLowerCase()
        .includes(searchQuery.toLowerCase());
      const matchesSearch = !searchQuery || subjectMatch || participantMatch;
      const matchesStatus = statusFilter === "all" || thread.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [threads, searchQuery, statusFilter]);

  const selectedThread = threads.find((t) => t.id === selectedThreadId) || null;

  const handleThreadSelect = useCallback(
    async (threadId: string) => {
      setSelectedThreadId(threadId);
      await loadThread(threadId);
    },
    [loadThread]
  );

  const handleComposeSend = (_data: ComposeData) => {
    window.location.reload();
  };

  const handleReplySend = () => {
    if (replyContent.trim()) {
      setReplyContent("");
    }
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-mono text-2xl font-semibold tracking-tight text-text-primary">Messages</h1>
          <p className="text-text-secondary mt-1">Async communication center</p>
        </div>
        <button
          onClick={() => setShowCompose(true)}
          className="px-4 py-2 bg-accent text-text-primary rounded-md hover:bg-accent-hover transition-colors flex items-center gap-2 text-sm font-medium"
          aria-label="Compose new message"
        >
          <Plus className="h-4 w-4" />
          New Message
        </button>
      </div>

      <div className="flex gap-4 h-[calc(100vh-12rem)] min-h-[500px]">
        {/* Thread List Panel */}
        <Card className="w-80 flex-shrink-0 flex flex-col bg-surface border-border" role="complementary" aria-label="Message threads">
          <div className="p-3 space-y-3 border-b border-border">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden="true" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search threads..."
                aria-label="Search threads"
                className="w-full rounded-md border border-border bg-elevated pl-9 pr-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-border-strong focus:outline-none"
              />
            </div>
            <div className="relative">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                aria-label="Filter by status"
                className="w-full appearance-none rounded-md border border-border bg-elevated px-3 py-2 pr-8 text-sm text-text-primary focus:border-border-strong focus:outline-none"
              >
                <option value="all">All Status</option>
                <option value="active">Active</option>
                <option value="archived">Archived</option>
              </select>
              <ChevronDown className="absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted pointer-events-none" aria-hidden="true" />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto" role="list" aria-label="Thread list">
            {filteredThreads.length === 0 ? (
              <div className="p-6 text-center text-text-muted text-sm">No threads found</div>
            ) : (
              filteredThreads.map((thread) => {
                const statusConfig = statusToBadge(thread.status);
                return (
                  <button
                    key={thread.id}
                    onClick={() => handleThreadSelect(thread.id)}
                    role="listitem"
                    aria-selected={selectedThreadId === thread.id}
                    aria-label={`Thread: ${thread.subject ?? "No subject"}`}
                    className={cn(
                      "w-full text-left px-3 py-3 border-b border-border hover:bg-hover/50 transition-colors",
                      selectedThreadId === thread.id && "bg-accent/10"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-text-primary truncate">
                          {thread.subject ?? "No subject"}
                        </p>
                        <p className="text-xs text-text-secondary mt-0.5 truncate">
                          {formatParticipants(thread.participants)}
                        </p>
                        {thread.lastMessagePreview && (
                          <p className="text-xs text-text-muted mt-1 truncate">
                            {truncate(thread.lastMessagePreview, 60)}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        {thread.unreadCount > 0 && (
                          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-accent text-xs font-bold text-text-primary">
                            {thread.unreadCount}
                          </span>
                        )}
                        <InlineBadge
                          color={statusConfig.color}
                          label={statusConfig.label}
                          className="text-[10px] px-1.5 py-0"
                        />
                        <span className="text-[10px] text-text-muted">
                          {formatRelativeDate(thread.lastMessageAt)}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </Card>

        {/* Message Detail Panel */}
        <Card className="flex-1 flex flex-col bg-surface border-border" role="main" aria-label="Message detail">
          {!selectedThread ? (
            <div className="flex-1 flex items-center justify-center">
              <EmptyState
                icon={MessageSquare}
                title="Select a conversation"
                description="Choose a thread from the left panel to view messages."
              />
            </div>
          ) : (
            <>
              <div className="px-4 py-3 border-b border-border">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <h2 className="text-lg font-semibold text-text-primary">
                      {selectedThread.subject ?? "No subject"}
                    </h2>
                    <div className="flex items-center gap-3 mt-1 text-sm text-text-secondary">
                      <span className="flex items-center gap-1">
                        <User className="h-3.5 w-3.5" aria-hidden="true" />
                        {formatParticipants(selectedThread.participants)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                        {formatTimestamp(selectedThread.createdAt)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <InlineBadge
                        color={statusToBadge(selectedThread.status).color}
                        label={statusToBadge(selectedThread.status).label}
                      />
                      {formatTags(selectedThread.tags).map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-hover text-text-secondary"
                        >
                          <Tag className="h-3 w-3" aria-hidden="true" />
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
                {messages.length === 0 ? (
                  <div className="text-center text-text-muted text-sm py-8">
                    No messages in this thread yet.
                  </div>
                ) : (
                  messages.map((msg) => {
                    const priorityConfig = priorityToBadge(msg.priority);
                    return (
                      <Card key={msg.id} variant="default" className="bg-elevated border-border">
                        <CardContent className="py-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-sm font-medium text-text-primary">
                                  {msg.fromAgent}
                                </span>
                                <span className="text-xs text-text-muted">→ {msg.toAgent}</span>
                                <span className="text-xs text-text-muted">
                                  {formatTimestamp(msg.createdAt)}
                                </span>
                              </div>
                              <p className="text-sm text-text-secondary whitespace-pre-wrap break-words">
                                {msg.content}
                              </p>
                            </div>
                            <div className="flex flex-col items-end gap-1 flex-shrink-0">
                              <InlineBadge
                                color={priorityConfig.color}
                                label={priorityConfig.label}
                              />
                              {msg.requiresResponse && (
                                <span className="inline-flex items-center gap-1 text-xs text-warning">
                                  <AlertCircle className="h-3 w-3" aria-hidden="true" />
                                  Needs response
                                </span>
                              )}
                              {msg.responded && (
                                <span className="inline-flex items-center gap-1 text-xs text-healthy">
                                  <CheckCircle className="h-3 w-3" aria-hidden="true" />
                                  Responded
                                </span>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })
                )}
              </div>

              <div className="px-4 py-3 border-t border-border">
                <div className="flex gap-2">
                  <textarea
                    value={replyContent}
                    onChange={(e) => setReplyContent(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        handleReplySend();
                      }
                    }}
                    placeholder="Type a reply... (Cmd+Enter to send)"
                    rows={2}
                    aria-label="Reply message"
                    className="flex-1 rounded-md border border-border bg-elevated px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-border-strong focus:outline-none resize-none"
                  />
                  <button
                    onClick={handleReplySend}
                    disabled={!replyContent.trim()}
                    aria-label="Send reply"
                    className="self-end px-4 py-2 bg-accent text-text-primary rounded-md hover:bg-accent-hover transition-colors disabled:opacity-40 disabled:pointer-events-none flex items-center gap-2 text-sm h-fit"
                  >
                    <Send className="h-4 w-4" />
                    Send
                  </button>
                </div>
              </div>
            </>
          )}
        </Card>
      </div>

      {showCompose && <ComposeModal onClose={() => setShowCompose(false)} onSend={handleComposeSend} />}
    </div>
  );
}
