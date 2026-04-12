import { db } from '@/lib/db';
import { outboxEvents } from '@/drizzle/schema';
import { and, eq, lt, asc } from 'drizzle-orm';
import { getWsGateway } from '@/src/transport/ws-server';

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
  const gateway = getWsGateway();

  if (!gateway.isConnected) {
    console.warn(`[Outbox] WS not connected, skipping publish: ${event.eventType}`);
    return;
  }

  const wsEvent = {
    eventType: event.eventType,
    entityId: event.entityId,
    entityType: event.entityType,
    payload: event.payload as Record<string, unknown>,
  };

  gateway.broadcastOutboxEvent(wsEvent);
}
