import { notFound } from 'next/navigation';
import { getNoteDetail } from '@/lib/server/notes';
import { NoteEditorClient } from './note-editor-client';

interface NoteDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function NoteDetailPage({ params }: NoteDetailPageProps) {
  const { id } = await params;
  const note = await getNoteDetail(id);

  if (!note) {
    notFound();
  }

  // Fetch parent note name for breadcrumb
  let parentName: string | null = null;
  if (note.parentId) {
    const parent = await getNoteDetail(note.parentId);
    parentName = parent?.name ?? null;
  }

  return (
    <NoteEditorClient
      note={{
        id: note.id,
        name: note.name,
        status: note.status,
        agent: note.agent,
        agentSecondary: note.agentSecondary,
        report: note.report,
        reportExtra: note.reportExtra,
        projectId: note.projectId,
        projectStatus: note.projectStatus,
        knowledgeCategories: note.knowledgeCategories,
        createdTime: note.createdTime,
        lastEditedAt: note.lastEditedAt,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
        parentId: note.parentId,
        parentName,
        icon: note.icon,
        coverImage: note.coverImage,
        tags: note.tags,
        ord: note.ord,
        isFavorite: note.isFavorite,
        isArchived: note.isArchived,
      }}
      initialContent={note.content}
    />
  );
}
