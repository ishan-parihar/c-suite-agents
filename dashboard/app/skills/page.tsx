'use client';

import { useState } from 'react';
import { Puzzle, Power, BarChart3 } from 'lucide-react';

interface Skill {
  id: string;
  name: string;
  description: string;
  category: string;
  enabled: boolean;
  usageCount: number;
  lastUsed: string;
}

const SKILLS: Skill[] = [
  { id: 's1', name: 'Web Search', description: 'Search the internet for real-time information', category: 'Research', enabled: true, usageCount: 342, lastUsed: '2m ago' },
  { id: 's2', name: 'Code Execution', description: 'Run Python, JavaScript, and shell commands', category: 'Development', enabled: true, usageCount: 189, lastUsed: '15m ago' },
  { id: 's3', name: 'File Management', description: 'Read, write, and organize files', category: 'Productivity', enabled: true, usageCount: 567, lastUsed: '1h ago' },
  { id: 's4', name: 'Notion Integration', description: 'Read and write to Notion databases', category: 'Integration', enabled: false, usageCount: 45, lastUsed: '3d ago' },
  { id: 's5', name: 'Slack Messaging', description: 'Send messages to Slack channels', category: 'Communication', enabled: true, usageCount: 128, lastUsed: '30m ago' },
  { id: 's6', name: 'Data Analysis', description: 'Analyze CSV and spreadsheet data', category: 'Analytics', enabled: false, usageCount: 23, lastUsed: '1w ago' },
];

export default function SkillsPage() {
  const [skills, setSkills] = useState(SKILLS);

  const toggleSkill = (id: string) => {
    setSkills((prev) =>
      prev.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s))
    );
  };

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Agent Skills</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Manage agent capabilities and tool integrations
        </p>
      </div>

      {/* Summary */}
      <div className="grid gap-4 md:grid-cols-3 mb-8">
        <div className="bg-card-bg border border-card-border rounded-xl px-5 py-4">
          <div className="flex items-center gap-3">
            <Puzzle className="w-5 h-5 text-blue-500" />
            <div>
              <p className="text-2xl font-semibold">{skills.length}</p>
              <p className="text-xs text-zinc-500">Total Skills</p>
            </div>
          </div>
        </div>
        <div className="bg-card-bg border border-card-border rounded-xl px-5 py-4">
          <div className="flex items-center gap-3">
            <Power className="w-5 h-5 text-green-500" />
            <div>
              <p className="text-2xl font-semibold">{skills.filter((s) => s.enabled).length}</p>
              <p className="text-xs text-zinc-500">Active</p>
            </div>
          </div>
        </div>
        <div className="bg-card-bg border border-card-border rounded-xl px-5 py-4">
          <div className="flex items-center gap-3">
            <BarChart3 className="w-5 h-5 text-purple-500" />
            <div>
              <p className="text-2xl font-semibold">{skills.reduce((sum, s) => sum + s.usageCount, 0)}</p>
              <p className="text-xs text-zinc-500">Total Uses</p>
            </div>
          </div>
        </div>
      </div>

      {/* Skills List */}
      <div className="space-y-4">
        {skills.map((skill) => (
          <div key={skill.id} className="bg-card-bg border border-card-border rounded-xl px-5 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                  skill.enabled ? 'bg-blue-50 dark:bg-blue-950' : 'bg-zinc-100 dark:bg-zinc-800'
                }`}>
                  <Puzzle className={`w-5 h-5 ${skill.enabled ? 'text-blue-500' : 'text-zinc-400'}`} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium">{skill.name}</h3>
                    <span className="text-xs bg-zinc-100 dark:bg-zinc-800 text-zinc-500 px-2 py-0.5 rounded-full">
                      {skill.category}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-500 mt-0.5">{skill.description}</p>
                </div>
              </div>

              <div className="flex items-center gap-6">
                <div className="text-right">
                  <p className="text-xs text-zinc-500">{skill.usageCount} uses</p>
                  <p className="text-xs text-zinc-400">{skill.lastUsed}</p>
                </div>
                <button
                  onClick={() => toggleSkill(skill.id)}
                  className={`relative w-10 h-5 rounded-full transition-colors ${
                    skill.enabled ? 'bg-blue-500' : 'bg-zinc-300 dark:bg-zinc-600'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                      skill.enabled ? 'translate-x-5' : ''
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
