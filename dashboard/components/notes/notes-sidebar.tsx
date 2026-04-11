'use client';

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Plus,
  Search,
  Star,
  Trash2,
  PlusCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export interface NoteTreeItem {
  id: string;
  name: string;
  parentId: string | null;
  icon: string | null;
  isFavorite: boolean;
  ord: number;
  status: string;
  isArchived: boolean;
  createdAt: string;
}

export interface TreeNode extends NoteTreeItem {
  children: TreeNode[];
}

function buildTree(items: NoteTreeItem[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  for (const item of items) {
    map.set(item.id, { ...item, children: [] });
  }

  for (const node of map.values()) {
    if (node.parentId && map.has(node.parentId)) {
      map.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

function filterTree(roots: TreeNode[], query: string): TreeNode[] {
  if (!query.trim()) return roots;
  const q = query.toLowerCase();

  function filterNode(node: TreeNode): TreeNode | null {
    const selfMatch = node.name.toLowerCase().includes(q);
    const filteredChildren = node.children
      .map(filterNode)
      .filter((n): n is TreeNode => n !== null);

    if (selfMatch || filteredChildren.length > 0) {
      return { ...node, children: filteredChildren };
    }
    return null;
  }

  return roots.map(filterNode).filter((n): n is TreeNode => n !== null);
}

function collectAllIds(nodes: TreeNode[]): Set<string> {
  const ids = new Set<string>();
  function walk(ns: TreeNode[]) {
    for (const n of ns) {
      ids.add(n.id);
      walk(n.children);
    }
  }
  walk(nodes);
  return ids;
}

async function fetchNotesTree(): Promise<NoteTreeItem[]> {
  const res = await fetch('/api/notes/tree');
  if (!res.ok) throw new Error('Failed to fetch notes tree');
  const json = await res.json();
  return json.data as NoteTreeItem[];
}

async function createNote({ name, parentId }: { name: string; parentId?: string | null }) {
  const res = await fetch('/api/crud/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, parent_id: parentId ?? null, status: 'New Note' }),
  });
  if (!res.ok) throw new Error('Failed to create note');
  return res.json();
}

async function toggleFavoriteNote({ id, isFavorite }: { id: string; isFavorite: boolean }) {
  const res = await fetch(`/api/crud/notes/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_favorite: isFavorite }),
  });
  if (!res.ok) throw new Error('Failed to update note');
  return res.json();
}

async function deleteNote({ id }: { id: string }) {
  const res = await fetch(`/api/crud/notes/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete note');
  return res.json();
}

interface TreeNodeProps {
  node: TreeNode;
  depth: number;
  selectedId: string | null;
  expandedIds: Set<string>;
  onToggleExpand: (id: string) => void;
  onSelect: (id: string) => void;
  onToggleFavorite: (id: string, current: boolean) => void;
  onDelete: (id: string) => void;
  onAddSubPage: (parentId: string) => void;
}

function TreeNodeItem({
  node,
  depth,
  selectedId,
  expandedIds,
  onToggleExpand,
  onSelect,
  onToggleFavorite,
  onDelete,
  onAddSubPage,
}: TreeNodeProps) {
  const [hovered, setHovered] = useState(false);
  const hasChildren = node.children.length > 0;
  const isExpanded = expandedIds.has(node.id);
  const isActive = selectedId === node.id;

  return (
    <div>
      <div
        className={cn(
          'group flex items-center gap-1 py-1 pr-2 rounded-md text-sm cursor-pointer transition-colors',
          isActive
            ? 'bg-accent/10 text-accent-secondary'
            : 'text-text-secondary hover:text-text-primary hover:bg-hover',
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => onSelect(node.id)}
        role="treeitem"
        aria-expanded={hasChildren ? isExpanded : undefined}
        aria-level={depth + 1}
      >
        <button
          type="button"
          className={cn(
            'shrink-0 p-0.5 rounded transition-colors',
            hasChildren
              ? 'text-text-muted hover:text-text-primary'
              : 'text-transparent',
          )}
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) onToggleExpand(node.id);
          }}
          aria-label={isExpanded ? 'Collapse' : 'Expand'}
        >
          {isExpanded ? (
            <ChevronDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" />
          )}
        </button>

        <span className="shrink-0 text-base leading-none" role="img">
          {node.icon || <FileText className="w-4 h-4 text-text-muted" />}
        </span>

        <span className="truncate flex-1 text-sm">{node.name}</span>

        <div
          className={cn(
            'flex items-center gap-0.5 shrink-0 transition-opacity',
            hovered ? 'opacity-100' : 'opacity-0',
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className={cn(
              'p-1 rounded hover:bg-hover transition-colors',
              node.isFavorite
                ? 'text-yellow-400'
                : 'text-text-muted hover:text-yellow-400',
            )}
            title={node.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            onClick={() => onToggleFavorite(node.id, node.isFavorite)}
          >
            <Star className="w-3.5 h-3.5" fill={node.isFavorite ? 'currentColor' : 'none'} />
          </button>
          <button
            type="button"
            className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-hover transition-colors"
            title="Add sub-page"
            onClick={() => onAddSubPage(node.id)}
          >
            <PlusCircle className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            className="p-1 rounded text-text-muted hover:text-destructive hover:bg-hover transition-colors"
            title="Delete page"
            onClick={() => onDelete(node.id)}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {hasChildren && isExpanded && (
        <div role="group">
          {node.children.map((child) => (
            <TreeNodeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              expandedIds={expandedIds}
              onToggleExpand={onToggleExpand}
              onSelect={onSelect}
              onToggleFavorite={onToggleFavorite}
              onDelete={onDelete}
              onAddSubPage={onAddSubPage}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function NotesSidebar({
  selectedId,
  onSelect,
}: {
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const prevQuery = useRef('');

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['notes-tree'],
    queryFn: fetchNotesTree,
  });

  const tree = useMemo(() => buildTree(items), [items]);

  const filteredTree = useMemo(
    () => filterTree(tree, searchQuery),
    [tree, searchQuery],
  );

  const favorites = useMemo(
    () => items.filter((item) => item.isFavorite),
    [items],
  );

  const createMutation = useMutation({
    mutationFn: createNote,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['notes-tree'] });
      const newId = data?.id ?? data?.data?.id;
      if (newId) router.push(`/notes/${newId}`);
    },
  });

  const toggleFavoriteMutation = useMutation({
    mutationFn: toggleFavoriteNote,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes-tree'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteNote,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes-tree'] });
    },
  });

  const handleToggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSelect = useCallback(
    (id: string) => {
      onSelect?.(id);
      router.push(`/notes/${id}`);
    },
    [onSelect, router],
  );

  const handleToggleFavorite = useCallback(
    (id: string, current: boolean) => {
      toggleFavoriteMutation.mutate({ id, isFavorite: !current });
    },
    [toggleFavoriteMutation],
  );

  const handleDelete = useCallback(
    (id: string) => {
      if (confirm('Delete this page? This action cannot be undone.')) {
        deleteMutation.mutate({ id });
      }
    },
    [deleteMutation],
  );

  const handleAddSubPage = useCallback(
    (parentId: string) => {
      const name = prompt('Page name:');
      if (name?.trim()) {
        createMutation.mutate({ name: name.trim(), parentId });
      }
    },
    [createMutation],
  );

  const handleNewPage = useCallback(() => {
    const name = prompt('Page name:');
    if (name?.trim()) {
      createMutation.mutate({ name: name.trim(), parentId: null });
    }
  }, [createMutation]);

  useEffect(() => {
    const isSearching = searchQuery.trim().length > 0;
    const wasSearching = prevQuery.current.trim().length > 0;

    if (isSearching && !wasSearching) {
      setExpandedIds(collectAllIds(tree));
    } else if (!isSearching && wasSearching) {
      setExpandedIds(new Set());
    }

    prevQuery.current = searchQuery;
  }, [searchQuery, tree]);

  return (
    <aside className="w-72 h-full bg-muted/30 border-r border-border-default flex flex-col shrink-0">
      <div className="p-3 border-b border-border-default">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-text-primary">Notes</h2>
          <button
            type="button"
            className="flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-accent/10 text-accent-secondary hover:bg-accent/20 transition-colors"
            onClick={handleNewPage}
            disabled={createMutation.isPending}
          >
            <Plus className="w-3.5 h-3.5" />
            New page
          </button>
        </div>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            placeholder="Search pages..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-sm rounded-md bg-elevated border border-border-default text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/50 transition-all"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden py-2 scrollbar-thin" role="tree" aria-label="Notes tree">
        {isLoading ? (
          <div className="px-4 py-8 text-center text-text-muted text-sm">Loading...</div>
        ) : items.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-text-muted text-sm mb-3">No pages yet</p>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-accent/10 text-accent-secondary hover:bg-accent/20 transition-colors"
              onClick={handleNewPage}
            >
              <Plus className="w-3.5 h-3.5" />
              Create your first page
            </button>
          </div>
        ) : (
          <>
            {favorites.length > 0 && !searchQuery && (
              <div className="mb-2">
                <div className="px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-text-muted flex items-center gap-1.5">
                  <Star className="w-3 h-3 text-yellow-400" />
                  Favorites
                </div>
                {favorites.map((fav) => (
                  <TreeNodeItem
                    key={fav.id}
                    node={{ ...fav, children: [] }}
                    depth={1}
                    selectedId={selectedId ?? null}
                    expandedIds={expandedIds}
                    onToggleExpand={handleToggleExpand}
                    onSelect={handleSelect}
                    onToggleFavorite={handleToggleFavorite}
                    onDelete={handleDelete}
                    onAddSubPage={handleAddSubPage}
                  />
                ))}
                <div className="mx-3 my-2 border-t border-border-default" />
              </div>
            )}

            <div className="px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-text-muted">
              {searchQuery ? 'Search results' : 'All pages'}
            </div>
            {filteredTree.length === 0 && searchQuery ? (
              <div className="px-4 py-4 text-center text-text-muted text-sm">
                No pages matching &quot;{searchQuery}&quot;
              </div>
            ) : (
              filteredTree.map((root) => (
                <TreeNodeItem
                  key={root.id}
                  node={root}
                  depth={0}
                  selectedId={selectedId ?? null}
                  expandedIds={expandedIds}
                  onToggleExpand={handleToggleExpand}
                  onSelect={handleSelect}
                  onToggleFavorite={handleToggleFavorite}
                  onDelete={handleDelete}
                  onAddSubPage={handleAddSubPage}
                />
              ))
            )}
          </>
        )}
      </div>
    </aside>
  );
}

export default NotesSidebar;
