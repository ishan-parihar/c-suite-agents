import { z } from 'zod';
import { NextResponse } from 'next/server';
import { assertAgentCan, PermissionError, type EntityType } from '@/lib/agent-permissions';
import { sanitizeInput, isValidTitle } from '@/lib/sanitize';

export interface CrudContext {
  entityType: EntityType;
}

export interface AgentHeaders {
  agentId?: string;
  userId?: string;
}

export function extractAgentHeaders(request: Request): AgentHeaders {
  return {
    agentId: request.headers.get('x-agent-id') ?? undefined,
    userId: request.headers.get('x-user-id') ?? undefined,
  };
}

export function validateAgentAction(
  headers: AgentHeaders,
  action: 'read' | 'write' | 'delete',
  entityType: EntityType,
) {
  if (headers.agentId) {
    assertAgentCan(headers.agentId, action, entityType);
  } else {
    throw new PermissionError('Missing x-agent-id header');
  }
}

export function sanitizePayload(body: Record<string, unknown>) {
  const sanitized = { ...body };
  if ('title' in sanitized && typeof sanitized.title === 'string') {
    const check = isValidTitle(sanitized.title);
    if (!check.ok) return { ok: false as const, error: `title: ${check.error}` };
    sanitized.title = check.value;
  }
  if ('name' in sanitized && typeof sanitized.name === 'string') {
    sanitized.name = sanitizeInput(sanitized.name, 200);
  }
  if ('description' in sanitized && typeof sanitized.description === 'string') {
    sanitized.description = sanitizeInput(sanitized.description, 2000);
  }
  return { ok: true as const, data: sanitized };
}

export function validateBody<T extends z.ZodTypeAny>(body: unknown, schema: T) {
  const result = schema.safeParse(body);
  if (!result.success) {
    return {
      ok: false as const,
      errors: result.error.issues.map((e: z.ZodIssue) => `${e.path.join('.')}: ${e.message}`),
    };
  }
  return { ok: true as const, data: result.data };
}

export function successResponse(data: unknown, status = 200) {
  return NextResponse.json({ data }, { status });
}

export function errorResponse(error: string | string[], status = 400) {
  const message = Array.isArray(error) ? error.join('; ') : error;
  return NextResponse.json({ error: message }, { status });
}
