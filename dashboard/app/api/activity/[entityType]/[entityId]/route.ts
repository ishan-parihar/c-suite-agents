import { NextRequest } from 'next/server';
import { getEntityActivity } from '@/lib/activity-stream';
import { EntityType } from '@/lib/agent-permissions';
import { PermissionError } from '@/lib/agent-permissions';
import {
  extractAgentHeaders,
  validateAgentAction,
  successResponse,
  errorResponse,
} from '@/lib/api/factory';

const VALID_ENTITY_TYPES: EntityType[] = [
  'task',
  'goal',
  'project',
  'campaign',
  'person',
  'kanban',
  'message',
  'meeting',
  'journal',
  'financial',
  'content',
  'account',
  'report',
  'session',
];

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ entityType: string; entityId: string }> },
) {
  const headers = extractAgentHeaders(request);

  const { entityType, entityId } = await params;

  if (!entityType || !entityId) {
    return errorResponse('Missing entityType or entityId', 400);
  }

  if (!VALID_ENTITY_TYPES.includes(entityType as EntityType)) {
    return errorResponse(
      `Unknown entity type: ${entityType}. Valid types: ${VALID_ENTITY_TYPES.join(', ')}`,
      400,
    );
  }

  try {
    validateAgentAction(headers, 'read', entityType as EntityType);

    const activities = await getEntityActivity(entityId, entityType as EntityType);

    return successResponse({
      activities,
      total: activities.length,
    });
  } catch (error: unknown) {
    if (error instanceof PermissionError) {
      return errorResponse('Forbidden', 403);
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('GET /api/activity/[entityType]/[entityId] error:', message);
    return errorResponse('Failed to fetch activity', 500);
  }
}
