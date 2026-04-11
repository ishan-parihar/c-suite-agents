import { NextResponse } from 'next/server';
import { getNotesTree } from '@/lib/server/notes';

export async function GET() {
  try {
    const notes = await getNotesTree();
    return NextResponse.json({ data: notes, total: notes.length });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch notes tree' },
      { status: 500 }
    );
  }
}
