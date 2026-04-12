'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Command, Search, ArrowRight } from 'lucide-react';
import { allNavItems } from '@/lib/navigation';

export function CommandPalette() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filteredItems = query
    ? allNavItems.filter(
        (item) =>
          item.label.toLowerCase().includes(query.toLowerCase()) ||
          item.href.toLowerCase().includes(query.toLowerCase())
      )
    : allNavItems;

  const handleOpen = useCallback(() => setIsOpen(true), []);
  const handleClose = useCallback(() => {
    setIsOpen(false);
    setQuery('');
    setSelectedIndex(0);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleClose]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleNavigate = (href: string) => {
    router.push(href);
    handleClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filteredItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && filteredItems[selectedIndex]) {
      handleNavigate(filteredItems[selectedIndex].href);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]" onClick={handleClose}>
      <div className="fixed inset-0 bg-black/50" />
      <div
        className="relative w-full max-w-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 border-b border-zinc-200 dark:border-zinc-700">
          <Search className="w-4 h-4 text-zinc-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search pages..."
            className="flex-1 bg-transparent py-3 text-sm focus:outline-none placeholder:text-zinc-400"
            autoFocus
          />
          <kbd className="text-xs text-zinc-400 border border-zinc-200 dark:border-zinc-700 rounded px-1.5 py-0.5">
            ESC
          </kbd>
        </div>

        <div className="max-h-80 overflow-y-auto">
          {filteredItems.length > 0 ? (
            filteredItems.map((item, i) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.href}
                  onClick={() => handleNavigate(item.href)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                    i === selectedIndex
                      ? 'bg-zinc-100 dark:bg-zinc-800'
                      : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                  }`}
                >
                  <Icon className="w-4 h-4 text-zinc-400" />
                  <span className="flex-1 text-left">{item.label}</span>
                  <span className="text-xs text-zinc-400 font-mono">{item.href}</span>
                  <ArrowRight className="w-3 h-3 text-zinc-300" />
                </button>
              );
            })
          ) : (
            <div className="px-4 py-8 text-center text-sm text-zinc-500">
              No results for "{query}"
            </div>
          )}
        </div>

        <div className="px-4 py-2 border-t border-zinc-200 dark:border-zinc-700 flex items-center gap-4 text-xs text-zinc-400">
          <span className="flex items-center gap-1">
            <kbd className="border border-zinc-200 dark:border-zinc-700 rounded px-1">↑</kbd>
            <kbd className="border border-zinc-200 dark:border-zinc-700 rounded px-1">↓</kbd>
            navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="border border-zinc-200 dark:border-zinc-700 rounded px-1">↵</kbd>
            open
          </span>
        </div>
      </div>
    </div>
  );
}
