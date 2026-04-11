"use client";

import { useEffect, useRef, useCallback } from "react";

/**
 * Options for the useNoteShortcuts hook.
 * Each callback is optional — only register what you need.
 */
interface NoteShortcutsOptions {
  /** Cmd/Ctrl+N — Create a new root-level note */
  onNewNote?: () => void;
  /** Cmd/Ctrl+K — Focus the notes search input */
  onFocusSearch?: () => void;
  /** Cmd/Ctrl+P — Quick nav / command palette (placeholder) */
  onQuickNav?: () => void;
}

/**
 * Keyboard shortcuts hook for the Notes feature.
 *
 * Usage:
 * ```tsx
 * const searchRef = useRef<HTMLInputElement>(null);
 *
 * useNoteShortcuts({
 *   onNewNote: () => createNote(),
 *   onFocusSearch: () => searchRef.current?.focus(),
 * });
 * ```
 */
export function useNoteShortcuts(options: NoteShortcutsOptions) {
  const optionsRef = useRef(options);

  // Always use the latest callbacks without re-registering the listener
  optionsRef.current = options;

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const isMac = navigator.platform.toUpperCase().includes("MAC");
    const modifier = isMac ? e.metaKey : e.ctrlKey;

    if (!modifier) return;

    const key = e.key.toLowerCase();

    switch (key) {
      case "n": {
        const { onNewNote } = optionsRef.current;
        if (onNewNote) {
          e.preventDefault();
          onNewNote();
        }
        break;
      }
      case "k": {
        const { onFocusSearch } = optionsRef.current;
        if (onFocusSearch) {
          e.preventDefault();
          onFocusSearch();
        }
        break;
      }
      case "p": {
        const { onQuickNav } = optionsRef.current;
        if (onQuickNav) {
          e.preventDefault();
          onQuickNav();
        }
        break;
      }
    }
  }, []);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleKeyDown]);
}
