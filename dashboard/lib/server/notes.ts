import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export async function getNotesTree() {
  try {
    const result = await db.execute(sql`
      SELECT id, name, parent_id, icon, is_favorite, ord, status, is_archived, created_at
      FROM notes_management
      WHERE is_archived = false
      ORDER BY ord ASC, created_at DESC
    `);
    return result.rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      parentId: r.parent_id,
      icon: r.icon,
      isFavorite: r.is_favorite,
      ord: r.ord,
      status: r.status,
      isArchived: r.is_archived,
      createdAt: r.created_at,
    }));
  } catch {
    return [];
  }
}

export async function getNoteDetail(id: string) {
  try {
    const result = await db.execute(sql`
      SELECT id, data_source_id, name, status, agent, agent_secondary,
        report, report_extra, project_id, project_status, knowledge_categories,
        created_time, last_edited_at, created_at, updated_at,
        parent_id, icon, cover_image, tags, content, ord, is_favorite, is_archived
      FROM notes_management
      WHERE id = ${id}
      LIMIT 1
    `);
    if (result.rows.length === 0) return null;
    const r = result.rows[0] as any;
    return {
      id: r.id,
      dataSourceId: r.data_source_id,
      name: r.name,
      status: r.status,
      agent: r.agent,
      agentSecondary: r.agent_secondary,
      report: r.report,
      reportExtra: r.report_extra,
      projectId: r.project_id,
      projectStatus: r.project_status,
      knowledgeCategories: r.knowledge_categories,
      createdTime: r.created_time,
      lastEditedAt: r.last_edited_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      parentId: r.parent_id,
      icon: r.icon,
      coverImage: r.cover_image,
      tags: r.tags,
      content: r.content,
      ord: r.ord,
      isFavorite: r.is_favorite,
      isArchived: r.is_archived,
    };
  } catch {
    return null;
  }
}

export async function getAdjacentNotes(parentId: string | null, currentId: string) {
  try {
    const parentCondition = parentId === null
      ? sql`parent_id IS NULL`
      : sql`parent_id = ${parentId}`;

    const result = await db.execute(sql`
      SELECT id, name, icon, ord
      FROM notes_management
      WHERE ${parentCondition} AND is_archived = false
      ORDER BY ord ASC, created_at ASC
    `);
    const siblings = result.rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      icon: r.icon,
      ord: r.ord,
    }));

    const currentIndex = siblings.findIndex((s) => s.id === currentId);
    if (currentIndex === -1) return { prev: null, next: null };

    const prev = currentIndex > 0 ? siblings[currentIndex - 1] : null;
    const next = currentIndex < siblings.length - 1 ? siblings[currentIndex + 1] : null;

    return { prev, next };
  } catch {
    return { prev: null, next: null };
  }
}

export async function getFavoriteNotes() {
  try {
    const result = await db.execute(sql`
      SELECT id, name, icon, parent_id, ord, created_at
      FROM notes_management
      WHERE is_favorite = true AND is_archived = false
      ORDER BY ord ASC
    `);
    return result.rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      icon: r.icon,
      parentId: r.parent_id,
      ord: r.ord,
      createdAt: r.created_at,
    }));
  } catch {
    return [];
  }
}

export async function searchNotes(query: string) {
  try {
    const result = await db.execute(sql`
      SELECT id, name, icon, parent_id, status
      FROM notes_management
      WHERE name ILIKE ${`%${query}%`}
      ORDER BY name ASC
    `);
    return result.rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      icon: r.icon,
      parentId: r.parent_id,
      status: r.status,
    }));
  } catch {
    return [];
  }
}

export async function getRecentlyViewed() {
  return [];
}
