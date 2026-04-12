'use client';

import { useState } from 'react';
import { Send, MessageSquare, Users, Hash } from 'lucide-react';
import { useWebSocket } from '@/lib/ws-client';

const AGENTS = ['ceo', 'coo', 'cpo', 'cro', 'cfo', 'cmo', 'cio', 'physician'];

interface Thread {
  id: string;
  agentId: string;
  lastMessage: string;
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

export default function MessagesPage() {
  const [selectedThread, setSelectedThread] = useState<string | null>(null);
  const [messageInput, setMessageInput] = useState('');
  const [threads] = useState<Thread[]>([
    { id: 't1', agentId: 'ceo', lastMessage: 'Review the Q2 plan', unread: 2 },
    { id: 't2', agentId: 'coo', lastMessage: 'Tasks completed on schedule', unread: 0 },
    { id: 't3', agentId: 'cmo', lastMessage: 'Content pipeline updated', unread: 1 },
  ]);
  const [messages] = useState<ChatMessage[]>([
    { id: 'm1', threadId: 't1', agentId: 'ceo', content: 'Can you review the Q2 strategic plan?', timestamp: new Date(Date.now() - 3600000), isSelf: false },
    { id: 'm2', threadId: 't1', agentId: 'dashboard', content: 'On it — reviewing now.', timestamp: new Date(Date.now() - 3500000), isSelf: true },
    { id: 'm3', threadId: 't1', agentId: 'ceo', content: 'Thanks, focus on the growth metrics.', timestamp: new Date(Date.now() - 1800000), isSelf: false },
    { id: 'm4', threadId: 't1', agentId: 'ceo', content: 'Let me know by EOD.', timestamp: new Date(Date.now() - 900000), isSelf: false },
  ]);

  const { isConnected, isAuthed, send, subscribe } = useWebSocket({
    url: `ws://${typeof window !== 'undefined' ? window.location.host : 'localhost:3000'}/api/ws`,
    queryKeys: [['messages']],
    enabled: true,
  });

  const handleSend = () => {
    if (!messageInput.trim() || !selectedThread) return;

    send({
      type: 'chat_message',
      payload: {
        threadId: selectedThread,
        content: messageInput.trim(),
        mentions: [],
      },
    });

    setMessageInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const filteredMessages = selectedThread
    ? messages.filter((m) => m.threadId === selectedThread)
    : [];

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
          {threads.map((thread) => (
            <button
              key={thread.id}
              onClick={() => setSelectedThread(thread.id)}
              className={`w-full text-left px-4 py-3 border-b border-card-border last:border-b-0 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors ${
                selectedThread === thread.id ? 'bg-zinc-100 dark:bg-zinc-800' : ''
              }`}
            >
              <div className="flex items-center gap-2">
                <Hash className="w-3 h-3 text-zinc-400" />
                <span className="text-sm font-medium truncate">{thread.agentId.toUpperCase()}</span>
                {thread.unread > 0 && (
                  <span className="ml-auto bg-blue-500 text-white text-xs px-1.5 py-0.5 rounded-full">
                    {thread.unread}
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-500 mt-1 truncate">{thread.lastMessage}</p>
            </button>
          ))}
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
                {threads.find((t) => t.id === selectedThread)?.agentId.toUpperCase()}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {filteredMessages.map((msg) => (
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
              ))}
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
                  disabled={!messageInput.trim()}
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
