import { NextResponse } from 'next/server';
import { relayOutbox } from '@/lib/outbox';

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(request: Request) {
  if (!CRON_SECRET) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 401 });
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const result = await relayOutbox();
    return NextResponse.json({ ok: true, ...result });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'Outbox relay failed', details: message }, { status: 500 });
  }
}
