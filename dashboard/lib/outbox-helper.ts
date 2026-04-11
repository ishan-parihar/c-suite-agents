import { outboxEvents } from '@/drizzle/schema/operations/outbox';
import { db } from '@/lib/db';

export interface OutboxEventInput {
  eventType: string;
  entityId: string;
  entityType: string;
  payload: Record<string, unknown>;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function withOutbox(tx: Tx, event: OutboxEventInput): Promise<void> {
  await tx.insert(outboxEvents).values({
    ...event,
    published: false,
    attempts: 0,
  });
}
