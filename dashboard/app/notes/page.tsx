'use client';

import { useState } from 'react';
import { Search, Brain, Tag, Clock } from 'lucide-react';

interface Memory {
  id: string;
  content: string;
  relevance: number;
  tags: string[];
  source: string;
  timestamp: string;
}

const SAMPLE_MEMORIES: Memory[] = [
  { id: 'm1', content: 'Q1 revenue target was $2.4M. We achieved $2.1M — 87% attainment.', relevance: 0.94, tags: ['finance', 'quarterly'], source: 'CEO Meeting', timestamp: '2026-03-15' },
  { id: 'm2', content: 'User prefers morning standups at 9:30 AM IST. Team productivity peaks 10AM-2PM.', relevance: 0.87, tags: ['productivity', 'schedule'], source: 'COO Report', timestamp: '2026-04-01' },
  { id: 'm3', content: 'Key stakeholder Sarah Chen is VP of Engineering at TechCorp. Prefers data-driven proposals.', relevance: 0.82, tags: ['relations', 'stakeholder'], source: 'CRO Notes', timestamp: '2026-03-28' },
  { id: 'm4', content: 'Content strategy: 3 posts/week on LinkedIn, 2 on Twitter. Focus on AI productivity angle.', relevance: 0.76, tags: ['marketing', 'strategy'], source: 'CMO Plan', timestamp: '2026-04-05' },
  { id: 'm5', content: 'Daily exercise routine: 30min run, 20min strength. Heart rate target: 140-160 bpm.', relevance: 0.71, tags: ['health', 'routine'], source: 'Physician Log', timestamp: '2026-04-10' },
];

export default function NotesPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Memory[]>(SAMPLE_MEMORIES);

  const handleSearch = (q: string) => {
    setQuery(q);
    if (!q.trim()) {
      setResults(SAMPLE_MEMORIES);
    } else {
      setResults(
        SAMPLE_MEMORIES.filter(
          (m) =>
            m.content.toLowerCase().includes(q.toLowerCase()) ||
            m.tags.some((t) => t.toLowerCase().includes(q.toLowerCase()))
        ).sort((a, b) => b.relevance - a.relevance)
      );
    }
  };

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Agent Memory</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Vector search across agent knowledge and memories
        </p>
      </div>

      <div className="bg-card-bg border border-card-border rounded-xl px-5 py-4 mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search memories..."
            className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <div className="space-y-4">
        {results.map((memory) => (
          <div key={memory.id} className="bg-card-bg border border-card-border rounded-xl px-5 py-4">
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2">
                <Brain className="w-4 h-4 text-purple-500" />
                <span className="text-xs text-zinc-500">{memory.source}</span>
              </div>
              <span className="text-xs font-mono text-zinc-400">{(memory.relevance * 100).toFixed(0)}% match</span>
            </div>
            <p className="text-sm text-zinc-700 dark:text-zinc-300 mb-3">{memory.content}</p>
            <div className="flex items-center gap-4">
              <div className="flex gap-1.5 flex-wrap">
                {memory.tags.map((tag) => (
                  <span key={tag} className="inline-flex items-center gap-1 text-xs bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 px-2 py-0.5 rounded-full">
                    <Tag className="w-2.5 h-2.5" />
                    {tag}
                  </span>
                ))}
              </div>
              <span className="text-xs text-zinc-400 flex items-center gap-1 ml-auto">
                <Clock className="w-3 h-3" />
                {memory.timestamp}
              </span>
            </div>
          </div>
        ))}
      </div>

      {results.length === 0 && (
        <div className="text-center py-12">
          <Brain className="w-12 h-12 text-zinc-300 dark:text-zinc-600 mx-auto mb-4" />
          <h2 className="text-lg font-medium text-zinc-700 dark:text-zinc-300">No Memories Found</h2>
          <p className="text-sm text-zinc-500 mt-1">Try a different search query</p>
        </div>
      )}
    </div>
  );
}
