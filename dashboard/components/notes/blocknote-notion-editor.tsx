'use client';

import { useEffect, useRef, useCallback } from 'react';
import { CheckCircle2, CircleDashed, PencilLine } from 'lucide-react';
import { useCreateBlockNote, SuggestionMenuController } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/shadcn';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/shadcn/style.css';
import { entityRefSchema, filterCustomSlashMenuItems, createMentionItems } from '@/components/rich-text/blocks';

export type SaveStatus = 'saved' | 'saving' | 'unsaved';

export interface BlockNoteNotionEditorProps {
  id: string;
  initialContent?: unknown;
  onSave?: (status: SaveStatus) => void;
}

const AUTO_SAVE_DELAY_MS = 2000;

export function BlockNoteNotionEditor({
  id,
  initialContent,
  onSave,
}: BlockNoteNotionEditorProps) {
  const uploadFile = useCallback(async (file: File) => {
    return new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(file);
    });
  }, []);

  const editor = useCreateBlockNote({
    schema: entityRefSchema,
    uploadFile,
  });

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingContentRef = useRef<unknown>(null);
  const lastSaveStatusRef = useRef<SaveStatus>('saved');

  const initializedRef = useRef(false);
  useEffect(() => {
    if (!editor || initializedRef.current) return;
    initializedRef.current = true;

    if (initialContent) {
      try {
        const blocks = Array.isArray(initialContent)
          ? initialContent
          : JSON.parse(String(initialContent));
        if (Array.isArray(blocks) && blocks.length > 0) {
          editor.replaceBlocks(editor.document, blocks);
        }
      } catch {
        editor.replaceBlocks(editor.document, [
          { type: 'paragraph', content: String(initialContent) },
        ]);
      }
    }
  }, [editor, initialContent]);

  const scheduleSave = useCallback(
    (content: unknown) => {
      pendingContentRef.current = content;

      if (lastSaveStatusRef.current !== 'unsaved') {
        onSave?.('unsaved');
        lastSaveStatusRef.current = 'unsaved';
      }

      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }

      saveTimerRef.current = setTimeout(async () => {
        const contentToSave = pendingContentRef.current;
        if (!contentToSave) return;

        onSave?.('saving');

        try {
          const res = await fetch(`/api/crud/notes/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: contentToSave }),
            credentials: 'include',
          });

          if (!res.ok) {
            throw new Error(`Save failed: ${res.status}`);
          }

          onSave?.('saved');
          lastSaveStatusRef.current = 'saved';
        } catch (err) {
          console.error('[BlockNoteNotionEditor] Auto-save error:', err);
          onSave?.('unsaved');
          lastSaveStatusRef.current = 'unsaved';
        }
      }, AUTO_SAVE_DELAY_MS);
    },
    [id, onSave],
  );

  useEffect(() => {
    if (!editor) return;

    const unsubscribe = editor.onChange(() => {
      scheduleSave(editor.document);
    });

    return () => {
      unsubscribe();
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, [editor, scheduleSave]);

  if (!editor) {
    return (
      <div className="flex h-full items-center justify-center">
        <CircleDashed className="h-6 w-6 animate-spin text-text-muted" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-hidden">
        <BlockNoteView
          editor={editor}
          theme="dark"
          slashMenu={false}
          className="h-full border-0"
        >
          <SuggestionMenuController
            triggerCharacter="/"
            getItems={async (query) =>
              filterCustomSlashMenuItems(editor, query)
            }
          />
          <SuggestionMenuController
            triggerCharacter="@"
            getItems={async (query) =>
              createMentionItems(editor, query)
            }
          />
        </BlockNoteView>
      </div>
    </div>
  );
}

export function SaveStatusIndicator({ status }: { status: SaveStatus }) {
  const config: Record<SaveStatus, { icon: React.ReactNode; label: string; className: string }> = {
    saved: {
      icon: <CheckCircle2 className="h-3.5 w-3.5" />,
      label: 'Saved',
      className: 'text-emerald-400',
    },
    saving: {
      icon: <CircleDashed className="h-3.5 w-3.5 animate-spin" />,
      label: 'Saving...',
      className: 'text-text-muted',
    },
    unsaved: {
      icon: <PencilLine className="h-3.5 w-3.5" />,
      label: 'Unsaved changes',
      className: 'text-amber-400',
    },
  };

  const { icon, label, className } = config[status];

  return (
    <div
      className={`flex items-center gap-1.5 text-xs ${className}`}
      role="status"
      aria-live="polite"
    >
      {icon}
      <span>{label}</span>
    </div>
  );
}

export default BlockNoteNotionEditor;
