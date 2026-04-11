import { db } from '@/lib/db';
import { outboxEvents } from '@/drizzle/schema';
import { and, eq, lt, asc } from 'drizzle-orm';

export interface RelayResult {
  relayed: number;
  failed: number;
}

export async function relayOutbox(): Promise<RelayResult> {
  const unpublished = await db
    .select()
    .from(outboxEvents)
    .where(
      and(
        eq(outboxEvents.published, false),
        lt(outboxEvents.attempts, 5),
      ),
    )
    .orderBy(asc(outboxEvents.createdAt))
    .limit(50);

  let relayed = 0;
  let failed = 0;

  for (const event of unpublished) {
    try {
      await publishEvent(event);
      await db
        .update(outboxEvents)
        .set({ published: true, publishedAt: new Date() })
        .where(eq(outboxEvents.id, event.id));
      relayed++;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await db
        .update(outboxEvents)
        .set({ attempts: event.attempts + 1, lastError: message })
        .where(eq(outboxEvents.id, event.id));
      failed++;
    }
  }

  return { relayed, failed };
}

async function publishEvent(event: typeof outboxEvents.$inferSelect): Promise<void> {
  try {
    const { getWsGateway } = await import('../../src/transport/ws-server');
    const gateway = getWsGateway();
    if (gateway) {
      gateway.broadcastOutboxEvent(
        event.eventType,
        event.entityType,
        event.entityId,
        event.payload as Record<string, unknown>,
      );
    }
  } catch {
    // WS gateway may not be available in dashboard context — skip gracefully
  }

  if (event.payload && typeof event.payload === 'object' && 'agentId' in event.payload) {
    const targetAgent = (event.payload as Record<string, unknown>).agentId as string;
    try {
      const { getWsGateway } = await import('../../src/transport/ws-server');
      const gateway = getWsGateway();
      if (gateway && gateway.isConnected(targetAgent)) {
        gateway.publish(targetAgent, {
          message_id: `outbox-${event.id}`,
          thread_id: `outbox:${event.entityType}`,
          from: 'system',
          to: targetAgent,
          content: JSON.stringify({
            event: event.eventType,
            entity: event.entityId,
            data: event.payload,
          }),
          priority: 'P3',
          requires_response: false,
          created_at: Date.now(),
        });
      }
    } catch {
      // Agent may not be connected — skip gracefully
    }
  }
}
