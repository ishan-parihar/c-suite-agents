/// <reference types="vitest/globals" />

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import http from 'http';
import { getWsGateway, resetWsGateway, WsGateway } from '../../src/transport/ws-server';
import { resetMessageBus } from '../../src/transport/message-bus';

async function makeGateway(): Promise<{ gateway: WsGateway; server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const gateway = new WsGateway();
    const server = http.createServer();
    const port = 3100 + Math.floor(Math.random() * 100);
    server.listen(port, () => {
      gateway.listen(server);
      resolve({ gateway, server, port });
    });
  });
}

async function closeAll(gateway: WsGateway, server: http.Server): Promise<void> {
  gateway.close();
  await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
}

function makeWs(port: number): { ws: WebSocket; msgs: string[] } {
  const msgs: string[] = [];
  const ws = new WebSocket(`ws://localhost:${port}/api/ws`);
  ws.on('message', (d) => msgs.push(d.toString()));
  return { ws, msgs };
}

async function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe('WsGateway (Phase 1.1)', () => {
  beforeEach(() => {
    resetMessageBus();
    resetWsGateway();
  });

  afterEach(() => {
    resetMessageBus();
    resetWsGateway();
  });

  it('returns the same singleton instance', () => {
    const g1 = getWsGateway();
    const g2 = getWsGateway();
    expect(g1).toBe(g2);
  });

  it('sends auth challenge and accepts agentId auth', async () => {
    const { gateway, server, port } = await makeGateway();
    const { ws, msgs } = makeWs(port);

    await wait(100);
    expect(msgs[0]).toContain('"auth"');

    ws.send(JSON.stringify({ type: 'auth', payload: { agentId: 'agent-coo' } }));
    await wait(50);
    expect(msgs[1]).toContain('"auth_ok"');
    expect(msgs[1]).toContain('"agent-coo"');
    expect(gateway.clientCount).toBe(1);

    ws.terminate();
    await closeAll(gateway, server);
  });

  it('rejects auth with no credentials', async () => {
    const { gateway, server, port } = await makeGateway();
    const { ws, msgs } = makeWs(port);

    await wait(100);
    ws.send(JSON.stringify({ type: 'auth', payload: {} }));
    await wait(50);
    expect(msgs[1]).toContain('"auth_fail"');

    ws.terminate();
    await closeAll(gateway, server);
  });

  it('broadcasts only to authenticated clients with matching subscriptions', async () => {
    const { gateway, server, port } = await makeGateway();
    const sub = makeWs(port);
    const unsub = makeWs(port);

    await wait(100);

    sub.ws.send(JSON.stringify({ type: 'auth', payload: { agentId: 'a1' } }));
    unsub.ws.send(JSON.stringify({ type: 'auth', payload: { agentId: 'a2' } }));
    await wait(50);

    sub.ws.send(JSON.stringify({ type: 'subscribe', payload: { eventTypes: ['task.created'] } }));
    unsub.ws.send(JSON.stringify({ type: 'subscribe', payload: { eventTypes: ['meeting.scheduled'] } }));
    await wait(50);

    gateway.publish('task.created', { entityId: 't1', entityType: 'task', data: 'hello' });
    await wait(100);

    expect(sub.msgs.some((m) => m.includes('"event"'))).toBe(true);
    expect(unsub.msgs.some((m) => m.includes('"event"'))).toBe(false);

    sub.ws.terminate();
    unsub.ws.terminate();
    await closeAll(gateway, server);
  });

  it('resetWsGateway cleans up singleton state', async () => {
    const g1 = getWsGateway();
    const server = http.createServer();
    const port = 3100 + Math.floor(Math.random() * 100);
    await new Promise<void>((resolve) => server.listen(port, resolve));
    g1.listen(server);

    const { ws, msgs } = makeWs(port);
    await wait(100);
    expect(g1.clientCount).toBe(1);
    ws.terminate();

    resetWsGateway();
    expect(g1.clientCount).toBe(0);

    await closeAll(g1, server);
  });
});
