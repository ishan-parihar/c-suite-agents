"use client";

import { useState, useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import {
  useCreateBlockNote,
  SuggestionMenuController,
  BlockNoteViewRaw,
} from "@blocknote/react";
import "@blocknote/react/style.css";
import { entityRefSchema, filterCustomSlashMenuItems } from "@/components/rich-text/blocks";

interface BlockNoteEditorProps {
  initialContent?: string;
  onChange: (content: string) => void;
  minHeight?: string;
}

function BlockNoteEditorInner({
  initialContent,
  onChange,
  minHeight = "200px",
}: BlockNoteEditorProps) {
  const editor = useCreateBlockNote({
    schema: entityRefSchema,
  });
  const initialized = useRef(false);

  useEffect(() => {
    if (!editor || initialized.current) return;
    initialized.current = true;

    if (initialContent) {
      try {
        const parsed = JSON.parse(initialContent);
        if (Array.isArray(parsed)) {
          editor.replaceBlocks(editor.document, parsed);
        }
      } catch {
        editor.replaceBlocks(editor.document, [
          {
            type: "paragraph",
            content: initialContent,
          },
        ]);
      }
    }
  }, [editor, initialContent]);

  useEffect(() => {
    if (!editor) return;
    const unsubscribe = editor.onEditorContentChange(() => {
      onChange(JSON.stringify(editor.document, null, 0));
    });
    return unsubscribe;
  }, [editor, onChange]);

  if (!editor) return null;

  return (
    <div style={{ minHeight }} className="border border-border rounded-md overflow-hidden">
      <BlockNoteViewRaw
        editor={editor}
        slashMenu={false}
      >
        <SuggestionMenuController
          triggerCharacter="/"
          getItems={async (query) => filterCustomSlashMenuItems(editor, query)}
        />
      </BlockNoteViewRaw>
    </div>
  );
}

export function BlockNoteEditor(props: BlockNoteEditorProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div
        className="flex items-center justify-center border border-border rounded-md bg-surface"
        style={{ minHeight: props.minHeight || "200px" }}
      >
        <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
      </div>
    );
  }

  return <BlockNoteEditorInner {...props} />;
}
