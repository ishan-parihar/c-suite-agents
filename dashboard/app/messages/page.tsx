'use client';

import { useState, useMemo } from 'react';
import { Send, MessageSquare, Users, Hash } from 'lucide-react';
import { useWebSocket, getWsUrl } from '@/lib/ws-client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

interface Thread {
  id: string;
  agentId: string;
  subject: string | null;
  summary: string | null;
  status: string | null;
  unread: number;
}

interface ChatMessage {
  id: string;
  threadId: string;
  agentId: string;
  content: string;
  timestamp: Date;
  isSelf: boolean;
}

interface CrudThreadRaw {
  id: string;
  subject: string | null;
  status: string | null;
  summary: string | null;
  participants: string[];
  created_at: string;
  updated_at: string;
}

interface CrudMessageRaw {
  id: string;
  thread_id: string;
  from_agent: string;
  to_agent: string;
  content: string;
  priority: string | null;
  read: boolean | null;
  created_at: string;
}

interface CrudListResponse<T> {
  success: boolean;
  data: {
    items: T[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  };
}

function mapThread(raw: CrudThreadRaw): Thread {
  const otherAgents = (raw.participants ?? []).filter((p: string) => p !== 'dashboard');
  return {
    id: raw.id,
    agentId: otherAgents[0] ?? 'unknown',
    subject: raw.subject,
    summary: raw.summary,
    status: raw.status,
    unread: 0,
  };
}

function mapMessage(raw: CrudMessageRaw): ChatMessage {
  return {
    id: raw.id,
    threadId: raw.thread_id,
    agentId: raw.from_agent,
    content: raw.content,
    timestamp: new Date(raw.created_at),
    isSelf: raw.from_agent === 'dashboard',
  };
}

export default function MessagesPage() {
  const [selectedThread, setSelectedThread] = useState<string | null>(null);
  const [messageInput, setMessageInput] = useState('');
  const queryClient = useQueryClient();

  const { data: threads, isLoading: threadsLoading } = useQuery<CrudListResponse<CrudThreadRaw>>({
    queryKey: ['threads'],
    queryFn: async () => {
      const res = await fetch('/api/crud/message-threads?sort=updated_at&order=desc&limit=100');
      if (!res.ok) throw new Error('Failed to fetch threads');
      return res.json();
    },
  });

  const mappedThreads = useMemo(() => {
    if (!threads?.data?.items) return [];
    return threads.data.items.map(mapThread);
  }, [threads]);

  const { data: messagesData, isLoading: messagesLoading } = useQuery<CrudListResponse<CrudMessageRaw>>({
    queryKey: ['messages', selectedThread],
    queryFn: async () => {
      const res = await fetch(`/api/crud/messages?thread_id=${selectedThread}&sort=created_at&order=asc&limit=200`);
      if (!res.ok) throw new Error('Failed to fetch messages');
      return res.json();
    },
    enabled: !!selectedThread,
  });

  const mappedMessages = useMemo(() => {
    if (!messagesData?.data?.items) return [];
    return messagesData.data.items.map(mapMessage);
  }, [messagesData]);

  const { isConnected, isAuthed } = useWebSocket({
    url: getWsUrl('/api/ws'),
    queryKeys: [['threads'], ['messages']],
    enabled: true,
  });

  const sendMessageMutation = useMutation({
    mutationFn: async ({ threadId, content }: { threadId: string; content: string }) => {
      const thread = mappedThreads.find((t) => t.id === threadId);
      const res = await fetch('/api/crud/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-agent-id': 'dashboard',
        },
        body: JSON.stringify({
          thread_id: threadId,
          from_agent: 'dashboard',
          to_agent: thread?.agentId ?? '',
          content,
          priority: 'P3',
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? 'Failed to send message');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages', selectedThread] });
      queryClient.invalidateQueries({ queryKey: ['threads'] });
    },
  });

  const handleSend = async () => {
    if (!messageInput.trim() || !selectedThread) return;

    await sendMessageMutation.mutateAsync({
      threadId: selectedThread,
      content: messageInput.trim(),
    });

    setMessageInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-4">
      <div className="w-72 bg-card-bg border border-card-border rounded-xl flex flex-col">
        <div className="px-4 py-3 border-b border-card-border">
          <h2 className="text-sm font-medium flex items-center gap-2">
            <MessageSquare className="w-4 h-4" />
            Threads
          </h2>
        </div>

        <div className="flex-1 overflow-y-auto">
          {threadsLoading ? (
            <div className="px-4 py-3 space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="animate-pulse">
                  <div className="h-4 bg-zinc-200 dark:bg-zinc-700 rounded w-3/4 mb-1" />
                  <div className="h-3 bg-zinc-100 dark:bg-zinc-800 rounded w-1/2" />
                </div>
              ))}
            </div>
          ) : (
            mappedThreads.map((thread) => (
              <button
                key={thread.id}
                onClick={() => setSelectedThread(thread.id)}
                className={`w-full text-left px-4 py-3 border-b border-card-border last:border-b-0 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors ${
                  selectedThread === thread.id ? 'bg-zinc-100 dark:bg-zinc-800' : ''
                }`}
              >
                <div className="flex items-center gap-2">
                  <Hash className="w-3 h-3 text-zinc-400" />
                  <span className="text-sm font-medium truncate">
                    {thread.subject ?? thread.agentId.toUpperCase()}
                  </span>
                </div>
                {thread.summary && (
                  <p className="text-xs text-zinc-500 mt-1 truncate">{thread.summary}</p>
                )}
              </button>
            ))
          )}
          {!threadsLoading && mappedThreads.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-zinc-500">No threads yet</div>
          )}
        </div>

        <div className="px-4 py-2 border-t border-card-border">
          <div className="flex items-center gap-2 text-xs">
            {isConnected ? (
              <span className="text-green-500">●</span>
            ) : (
              <span className="text-red-500">●</span>
            )}
            <span className="text-zinc-500">
              {isConnected ? (isAuthed ? 'Connected' : 'Authenticating...') : 'Disconnected'}
            </span>
          </div>
        </div>
      </div>

      <div className="flex-1 bg-card-bg border border-card-border rounded-xl flex flex-col">
        {selectedThread ? (
          <>
            <div className="px-5 py-3 border-b border-card-border flex items-center gap-2">
              <Users className="w-4 h-4" />
              <span className="text-sm font-medium">
                {mappedThreads.find((t) => t.id === selectedThread)?.agentId.toUpperCase()}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {messagesLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className={`flex ${i % 2 === 0 ? 'justify-end' : 'justify-start'}`}>
                      <div className="animate-pulse max-w-[70%] rounded-2xl px-4 py-2 bg-zinc-100 dark:bg-zinc-800">
                        <div className="h-4 bg-zinc-200 dark:bg-zinc-700 rounded w-32" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                mappedMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.isSelf ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[70%] rounded-2xl px-4 py-2 ${
                        msg.isSelf
                          ? 'bg-blue-500 text-white rounded-br-sm'
                          : 'bg-zinc-100 dark:bg-zinc-800 rounded-bl-sm'
                      }`}
                    >
                      <p className="text-sm">{msg.content}</p>
                      <p className={`text-xs mt-1 ${msg.isSelf ? 'text-blue-100' : 'text-zinc-400'}`}>
                        {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="px-4 py-3 border-t border-card-border">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type a message..."
                  className="flex-1 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={handleSend}
                  disabled={!messageInput.trim() || sendMessageMutation.isPending}
                  className="px-3 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <MessageSquare className="w-12 h-12 text-zinc-300 dark:text-zinc-600 mx-auto mb-4" />
              <h2 className="text-lg font-medium text-zinc-700 dark:text-zinc-300">Select a Thread</h2>
              <p className="text-sm text-zinc-500 mt-1">Choose a conversation from the sidebar</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
