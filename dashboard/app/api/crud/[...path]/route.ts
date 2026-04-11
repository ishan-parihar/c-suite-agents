import { NextRequest } from 'next/server';
import { handleCrudRequest } from '@/lib/crud/handler';

/**
 * Generic CRUD catch-all route.
 *
 * Maps URL patterns to CRUD operations:
 *   GET    /api/crud/{entity}          → list (with pagination, filtering, sorting)
 *   POST   /api/crud/{entity}          → create
 *   GET    /api/crud/{entity}/{id}     → get single
 *   PATCH  /api/crud/{entity}/{id}     → update
 *   PUT    /api/crud/{entity}/{id}     → update (alias)
 *   DELETE /api/crud/{entity}/{id}     → delete
 *
 * Query params for list:
 *   ?page=1&limit=20&sort=created_at&order=desc
 *   ?status=active&priority=high        (filterable fields)
 *
 * Supported entities: see `@/lib/crud/entities.ts`
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return handleCrudRequest(path ?? [], request);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return handleCrudRequest(path ?? [], request);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return handleCrudRequest(path ?? [], request);
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return handleCrudRequest(path ?? [], request);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return handleCrudRequest(path ?? [], request);
}
