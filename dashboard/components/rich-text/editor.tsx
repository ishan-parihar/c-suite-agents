'use client';

import type { PartialBlock } from '@blocknote/core';
import { BlockNoteViewRaw, useCreateBlockNote, SuggestionMenuController } from '@blocknote/react';
import '@blocknote/react/style.css';
import { entityRefSchema, filterCustomSlashMenuItems } from './blocks';

interface RichTextEditorProps {
  initialContent?: PartialBlock[];
  onChange: (content: unknown) => void;
  editable?: boolean;
}

export function RichTextEditor({
  initialContent,
  onChange,
  editable = true,
}: RichTextEditorProps) {
  const editor = useCreateBlockNote({
    schema: entityRefSchema,
    initialContent,
  });

  return (
    <BlockNoteViewRaw
      editor={editor}
      theme="dark"
      editable={editable}
      slashMenu={false}
      onChange={() => onChange(editor.document)}
      className="min-h-[300px] rounded-lg border border-border"
    >
      <SuggestionMenuController
        triggerCharacter="/"
        getItems={async (query) => filterCustomSlashMenuItems(editor, query)}
      />
    </BlockNoteViewRaw>
  );
}
