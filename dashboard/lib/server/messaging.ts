"use server";

import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export interface MessageThread {
  id: string;
  participants: unknown;
  subject: string | null;
  status: string | null;
  tags: unknown;
  summary: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  lastMessagePreview: string | null;
  lastMessageAt: Date | null;
  unreadCount: number;
}

export interface ThreadMessage {
  id: string;
  threadId: string;
  fromAgent: string;
  toAgent: string;
  content: string;
  priority: string | null;
  requiresResponse: boolean | null;
  responded: boolean | null;
  createdAt: Date | null;
  read: boolean | null;
  tags: unknown;
}

export interface ThreadEscalation {
  id: string;
  threadId: string;
  fromAgent: string;
  toAgent: string;
  reason: string;
  createdAt: Date | null;
  status: string | null;
}

export async function getMessageThreads(): Promise<MessageThread[]> {
  try {
    const result = await db.execute(sql`
      SELECT
        t.id,
        t.participants,
        t.subject,
        t.status,
        t.tags,
        t.summary,
        t.created_at,
        t.updated_at,
        COALESCE(
          (SELECT m.content FROM messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1),
          NULL
        ) AS last_message_preview,
        COALESCE(
          (SELECT m.created_at FROM messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1),
          t.created_at
        ) AS last_message_at,
        COALESCE(
          (SELECT COUNT(*) FROM messages m WHERE m.thread_id = t.id AND m.read = false),
          0
        ) AS unread_count
      FROM message_threads t
      ORDER BY last_message_at DESC NULLS LAST
    `);

    return result.rows.map((r: any) => ({
      id: r.id,
      participants: r.participants,
      subject: r.subject,
      status: r.status,
      tags: r.tags,
      summary: r.summary,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      lastMessagePreview: r.last_message_preview,
      lastMessageAt: r.last_message_at,
      unreadCount: Number(r.unread_count),
    }));
  } catch {
    return [];
  }
}

export async function getThreadMessages(threadId: string): Promise<ThreadMessage[]> {
  try {
    const result = await db.execute(sql`
      SELECT
        id,
        thread_id,
        from_agent,
        to_agent,
        content,
        priority,
        requires_response,
        responded,
        created_at,
        read,
        tags
      FROM messages
      WHERE thread_id = ${threadId}
      ORDER BY created_at ASC
    `);

    return result.rows.map((r: any) => ({
      id: r.id,
      threadId: r.thread_id,
      fromAgent: r.from_agent,
      toAgent: r.to_agent,
      content: r.content,
      priority: r.priority,
      requiresResponse: r.requires_response,
      responded: r.responded,
      createdAt: r.created_at,
      read: r.read,
      tags: r.tags,
    }));
  } catch {
    return [];
  }
}

export async function getThreadEscalations(threadId: string): Promise<ThreadEscalation[]> {
  try {
    const result = await db.execute(sql`
      SELECT
        id,
        thread_id,
        from_agent,
        to_agent,
        reason,
        created_at,
        status
      FROM message_escalations
      WHERE thread_id = ${threadId}
      ORDER BY created_at ASC
    `);

    return result.rows.map((r: any) => ({
      id: r.id,
      threadId: r.thread_id,
      fromAgent: r.from_agent,
      toAgent: r.to_agent,
      reason: r.reason,
      createdAt: r.created_at,
      status: r.status,
    }));
  } catch {
    return [];
  }
}
