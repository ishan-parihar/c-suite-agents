import { NextRequest } from 'next/server';
import { eq, asc, desc, inArray, and, like, sql, SQL } from 'drizzle-orm';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import { db } from '@/lib/db';
import { getEntityConfig, isValidEntity, EntityConfig, entityRegistry } from './entities';
import { extractAgentHeaders, validateAgentAction } from '@/lib/api/factory';
import { withOutbox, type OutboxEventInput } from '@/lib/outbox-helper';
import { PermissionError } from '@/lib/agent-permissions';

// ── Response helpers ────────────────────────────────────────────────────────

function success(data: unknown, status = 200) {
  return Response.json({ success: true, data }, { status });
}

function error(message: string, status = 400, details?: unknown) {
  const body: Record<string, unknown> = { success: false, error: message };
  if (details) body.details = details;
  return Response.json(body, { status });
}

// ── Schema cache (avoid recreating Zod schemas per request) ─────────────────

const insertSchemaCache = new Map<string, z.ZodType>();
const selectSchemaCache = new Map<string, z.ZodType>();

function getInsertSchema(config: EntityConfig): z.ZodType {
  const key = config.table[Symbol.toStringTag] ?? config.table[Symbol.for('drizzle:Name')] ?? '';
  if (!insertSchemaCache.has(key)) {
    insertSchemaCache.set(key, createInsertSchema(config.table));
  }
  return insertSchemaCache.get(key)!;
}

function getSelectSchema(config: EntityConfig): z.ZodType {
  const key = `${config.table[Symbol.toStringTag] ?? config.table[Symbol.for('drizzle:Name')] ?? ''}:select`;
  if (!selectSchemaCache.has(key)) {
    selectSchemaCache.set(key, createSelectSchema(config.table));
  }
  return selectSchemaCache.get(key)!;
}

// ── Query parameter parsing ─────────────────────────────────────────────────

interface ListQuery {
  page: number;
  limit: number;
  sort?: string;
  order: 'asc' | 'desc';
  filters: Record<string, string>;
}

function parseListQuery(searchParams: URLSearchParams, config: EntityConfig): ListQuery {
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '20', 10)));
  const sort = searchParams.get('sort') ?? undefined;
  const order = (searchParams.get('order') ?? 'desc') as 'asc' | 'desc';

  // Parse filters from query params (any param not in the known set is a filter)
  const knownParams = new Set(['page', 'limit', 'sort', 'order']);
  const filters: Record<string, string> = {};
  for (const [key, value] of searchParams.entries()) {
    if (!knownParams.has(key) && config.filterableFields.includes(key)) {
      filters[key] = value;
    }
  }

  return { page, limit, sort, order, filters };
}

// ── Build WHERE clause from filters ─────────────────────────────────────────

function buildWhereClause(
  config: EntityConfig,
  filters: Record<string, string>,
): SQL | undefined {
  const conditions: SQL[] = [];

  for (const [field, value] of Object.entries(filters)) {
    const column = (config.table as Record<string, unknown>)[field];
    if (!column) continue;

    // Handle array-like values (e.g., tags=react,nextjs)
    if (value.includes(',')) {
      const values = value.split(',').map((v) => v.trim());
      conditions.push(inArray(column as never, values));
    } else {
      // Use LIKE for text fields, exact match for others
      conditions.push(like(column as never, `%${value}%`));
    }
  }

  if (conditions.length === 0) return undefined;
  if (conditions.length === 1) return conditions[0];
  return and(...conditions);
}

// ── CRUD Operations ─────────────────────────────────────────────────────────

async function handleList(
  config: EntityConfig,
  request: NextRequest,
): Promise<Response> {
  const headers = extractAgentHeaders(request);
  if (headers.agentId && config.entityType) {
    try {
      validateAgentAction(headers, 'read', config.entityType);
    } catch (err) {
      if (err instanceof PermissionError) {
        return error(err.message, 403);
      }
      throw err;
    }
  }

  const query = parseListQuery(request.nextUrl.searchParams, config);
  const where = buildWhereClause(config, query.filters);

  // Build order by
  let orderByClause: SQL | undefined;
  if (query.sort && config.sortableFields.includes(query.sort)) {
    const column = (config.table as Record<string, unknown>)[query.sort];
    if (column) {
      orderByClause = query.order === 'asc' ? asc(column as never) : desc(column as never);
    }
  }

  // Default sort by created_at if available
  if (!orderByClause) {
    const createdAt = (config.table as Record<string, unknown>).created_at;
    if (createdAt) {
      orderByClause = desc(createdAt as never);
    }
  }

  // Fetch total count
  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(config.table)
    .where(where) as Array<{ count: number }>;
  const total = Number(countResult[0]?.count ?? 0);
  const totalPages = Math.ceil(total / query.limit);

  // Fetch paginated results
  const results = await db
    .select()
    .from(config.table)
    .where(where)
    .orderBy(orderByClause ? orderByClause : sql`1`)
    .limit(query.limit)
    .offset((query.page - 1) * query.limit) as Record<string, unknown>[];

  // Validate response against select schema
  const selectSchema = getSelectSchema(config);
  const validated = z.array(selectSchema).parse(results);

  return success({
    items: validated,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages,
    },
  });
}

async function handleGet(
  config: EntityConfig,
  id: string,
  request: NextRequest,
): Promise<Response> {
  const headers = extractAgentHeaders(request);
  if (headers.agentId && config.entityType) {
    try {
      validateAgentAction(headers, 'read', config.entityType);
    } catch (err) {
      if (err instanceof PermissionError) {
        return error(err.message, 403);
      }
      throw err;
    }
  }

  const result = await db
    .select()
    .from(config.table)
    .where(eq(config.idColumn, id as never))
    .limit(1) as Record<string, unknown>[];

  if (result.length === 0) {
    return error('Not found', 404);
  }

  const selectSchema = getSelectSchema(config);
  const validated = selectSchema.parse(result[0]);

  return success(validated);
}

async function handleCreate(config: EntityConfig, request: NextRequest): Promise<Response> {
  // Extract agent headers and authorize
  const headers = extractAgentHeaders(request);
  if (config.entityType) {
    try {
      validateAgentAction(headers, 'write', config.entityType);
    } catch (err) {
      if (err instanceof PermissionError) {
        return error(err.message, 403);
      }
      throw err;
    }
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error('Invalid JSON body', 400);
  }

  const insertSchema = getInsertSchema(config);
  const validated = insertSchema.safeParse(body);

  if (!validated.success) {
    return error('Validation failed', 422, validated.error.flatten());
  }

  const result = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(config.table)
      .values(validated.data as never)
      .returning() as Record<string, unknown>[];

    if (config.entityType && headers.agentId) {
      const entityId = String(inserted[0].id);
      await withOutbox(tx, {
        eventType: `${config.entityType}.created`,
        entityId,
        entityType: config.entityType,
        payload: { agentId: headers.agentId, userId: headers.userId },
      });
    }

    return inserted;
  });

  const selectSchema = getSelectSchema(config);
  const created = selectSchema.parse(result[0]);

  return success(created, 201);
}

async function handleUpdate(config: EntityConfig, id: string, request: NextRequest): Promise<Response> {
  // Extract agent headers and authorize
  const headers = extractAgentHeaders(request);
  if (config.entityType) {
    try {
      validateAgentAction(headers, 'write', config.entityType);
    } catch (err) {
      if (err instanceof PermissionError) {
        return error(err.message, 403);
      }
      throw err;
    }
  }

  // First check existence
  const existing = await db
    .select()
    .from(config.table)
    .where(eq(config.idColumn, id as never))
    .limit(1) as Record<string, unknown>[];

  if (existing.length === 0) {
    return error('Not found', 404);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error('Invalid JSON body', 400);
  }

  const updateSchema = createInsertSchema(config.table).partial();
  const validated = updateSchema.safeParse(body);

  if (!validated.success) {
    return error('Validation failed', 422, validated.error.flatten());
  }

  const result = await db.transaction(async (tx) => {
    const updated = await tx
      .update(config.table)
      .set(validated.data as never)
      .where(eq(config.idColumn, id as never))
      .returning() as Record<string, unknown>[];

    if (config.entityType && headers.agentId) {
      await withOutbox(tx, {
        eventType: `${config.entityType}.updated`,
        entityId: id,
        entityType: config.entityType,
        payload: { agentId: headers.agentId, userId: headers.userId },
      });
    }

    return updated;
  });

  const selectSchema = getSelectSchema(config);
  const updated = selectSchema.parse(result[0]);

  return success(updated);
}

async function handleDelete(config: EntityConfig, id: string, request: NextRequest): Promise<Response> {
  // Extract agent headers and authorize
  const headers = extractAgentHeaders(request);
  if (config.entityType) {
    try {
      validateAgentAction(headers, 'delete', config.entityType);
    } catch (err) {
      if (err instanceof PermissionError) {
        return error(err.message, 403);
      }
      throw err;
    }
  }

  // First check existence
  const existing = await db
    .select()
    .from(config.table)
    .where(eq(config.idColumn, id as never))
    .limit(1) as Record<string, unknown>[];

  if (existing.length === 0) {
    return error('Not found', 404);
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(config.table)
      .where(eq(config.idColumn, id as never));

    if (config.entityType && headers.agentId) {
      await withOutbox(tx, {
        eventType: `${config.entityType}.deleted`,
        entityId: id,
        entityType: config.entityType,
        payload: { agentId: headers.agentId, userId: headers.userId },
      });
    }
  });

  return success({ deleted: id });
}

// ── Main handler ────────────────────────────────────────────────────────────

/**
 * Parse path segments and delegate to the appropriate CRUD operation.
 *
 * Path conventions:
 *   GET    /api/crud/{entity}        → list
 *   POST   /api/crud/{entity}        → create
 *   GET    /api/crud/{entity}/{id}   → get single
 *   PATCH  /api/crud/{entity}/{id}   → update
 *   DELETE /api/crud/{entity}/{id}   → delete
 *
 * @param segments Path segments from the catch-all route (e.g., ['tasks'] or ['kanban-cards', 'uuid'])
 * @param request The Next.js request object
 */
export async function handleCrudRequest(
  segments: string[],
  request: NextRequest,
): Promise<Response> {
  if (segments.length === 0) {
    return error('Missing entity slug. Use: /api/crud/{entity}', 400);
  }

  const entitySlug = segments[0];

  if (!isValidEntity(entitySlug)) {
    const available = Object.keys(entityRegistry).join(', ');
    return error(
      `Unknown entity: "${entitySlug}". Available: ${available}`,
      404,
    );
  }

  const config = getEntityConfig(entitySlug)!;
  const method = request.method.toUpperCase();
  const id = segments[1];

  try {
    switch (method) {
      case 'GET':
        if (id) {
          return handleGet(config, id, request);
        }
        return handleList(config, request);

      case 'POST':
        return handleCreate(config, request);

      case 'PATCH':
      case 'PUT':
        if (!id) {
          return error('Missing ID for update. Use: /api/crud/{entity}/{id}', 400);
        }
        return handleUpdate(config, id, request);

      case 'DELETE':
        if (!id) {
          return error('Missing ID for delete. Use: /api/crud/{entity}/{id}', 400);
        }
        return handleDelete(config, id, request);

      default:
        return error(`Method ${method} not allowed`, 405);
    }
  } catch (err: unknown) {
    if (err instanceof PermissionError) {
      return error(err.message, 403);
    }

    console.error(`CRUD error [${method} /${entitySlug}${id ? `/${id}` : ''}]:`, err);

    // Drizzle constraint violations
    if (err instanceof Error) {
      if (err.message.includes('violates not-null constraint')) {
        return error('Database constraint violation: not-null', 400);
      }
      if (err.message.includes('violates foreign key constraint')) {
        return error('Database constraint violation: foreign key', 400);
      }
      if (err.message.includes('duplicate key')) {
        return error('Database constraint violation: duplicate key', 409);
      }
    }

    return error('Internal server error', 500);
  }
}
