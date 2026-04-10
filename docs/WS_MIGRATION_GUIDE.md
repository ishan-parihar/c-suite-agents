# WebSocket Migration Guide: SSE → WS

**Version:** v0.5.0  
**Date:** April 2026  
**Status:** SSE deprecated, backward-compatible fallback active

## Why Migrate?

| Feature | SSE (Old) | WebSocket (New) |
|---|---|---|
| Connection | Unidirectional (server→client only) | Bidirectional |
| Message delivery | Polling via POST /mcp | Instant push |
| Conversation duration | Limited by HTTP timeout | Unlimited |
| Reconnection | Manual, no state recovery | Automatic with seq-based replay |
| Streaming | SSE events | Native WS frames |
| Tool calls | HTTP round-trip | Direct WS frames |
| Heartbeat | None | 30s ping/pong, 60s idle detection |
| Offline messages | Lost | Queued (10k max) + replay on reconnect |

## Quick Start

### 1. Connect to WebSocket

```typescript
import { WsClient } from './src/transport/ws-client';

// Replace your SSE connection:
// OLD: const evtSource = new EventSource(`http://127.0.0.1:3001/mcp?agentId=my-agent`);

// NEW:
const client = new WsClient('ws://127.0.0.1:3001/ws', 'my-agent');
```

### 2. Handle Events

```typescript
// OLD (SSE):
// evtSource.addEventListener('message', (e) => { ... });

// NEW (WS):
client.on('message', (msg) => {
  console.log('New message:', msg);
});

client.on('stream_chunk', (chunk) => {
  process.stdout.write(chunk.content);
});

client.on('stream_end', () => {
  console.log('\n[Stream complete]');
});

client.on('tool_call', async (toolCall) => {
  const result = await executeTool(toolCall.name, toolCall.args);
  client.sendToolResponse(toolCall.id, result);
});
```

### 3. Connect and Auto-Reconnect

```typescript
client.connect(); // Auto-reconnects with exponential backoff on disconnect

// Optional: listen for connection events
client.on('connected', () => console.log('Connected to WS'));
client.on('disconnected', () => console.log('Disconnected, reconnecting...'));
client.on('error', (err) => console.error('WS error:', err));
```

### 4. Send Messages

```typescript
// Send a message to another agent
client.sendMessage({
  to: 'ceo-strategic',
  from: 'coo-productivity',
  content: 'Q3 report is ready for review',
  priority: 'P2',
});

// Respond to a tool call
client.sendToolResponse(toolCallId, { success: true, data: result });

// Cancel an in-progress stream
client.cancelStream(sessionId);
```

## Frame Protocol Reference

### Client → Server

#### `auth`
```json
{
  "type": "auth",
  "agentId": "coo-productivity"
}
```

#### `tool_response`
```json
{
  "type": "tool_response",
  "toolCallId": "tc_abc123",
  "result": { "success": true, "data": "..." }
}
```

#### `cancel`
```json
{
  "type": "cancel",
  "sessionId": "session_xyz"
}
```

#### `ping`
```json
{
  "type": "ping",
  "timestamp": 1712345678000
}
```

### Server → Client

#### `auth_ok`
```json
{
  "type": "auth_ok",
  "agentId": "coo-productivity",
  "message": "authenticated"
}
```

#### `message`
```json
{
  "type": "message",
  "data": {
    "messageId": "msg_123",
    "from": "ceo-strategic",
    "to": "coo-productivity",
    "content": "Please review Q3 projections",
    "priority": "P2",
    "timestamp": "2026-04-10T12:00:00Z"
  }
}
```

#### `stream_chunk`
```json
{
  "type": "stream_chunk",
  "sessionId": "session_xyz",
  "content": "The quarterly report shows",
  "index": 42
}
```

#### `stream_end`
```json
{
  "type": "stream_end",
  "sessionId": "session_xyz",
  "usage": { "promptTokens": 1024, "completionTokens": 512 }
}
```

#### `tool_call`
```json
{
  "type": "tool_call",
  "id": "tc_abc123",
  "name": "kanban_list_tasks",
  "args": { "board": "ceo-strategic", "status": "in_progress" }
}
```

#### `reconnect_hint`
```json
{
  "type": "reconnect_hint",
  "lastSeq": 150,
  "offlineCount": 5
}
```

## Migration Checklist

- [ ] Replace `EventSource` with `WsClient` import
- [ ] Replace SSE event listeners with WS event handlers
- [ ] Replace POST /mcp message sends with `client.sendMessage()`
- [ ] Handle `tool_call` events (previously handled via MCP tool calls)
- [ ] Handle `stream_chunk` / `stream_end` for LLM streaming
- [ ] Test reconnection behavior (disconnect/reconnect)
- [ ] Verify offline message delivery after reconnect
- [ ] Remove SSE-specific error handling (HTTP 503, session limits)
- [ ] Update deployment config (no changes needed — WS runs on same port)

## Backward Compatibility

SSE transport remains fully functional during the transition:

- `GET /mcp?agentId=xxx` — Still creates SSE sessions (max 20)
- `POST /mcp?sessionId=xxx` — Still routes messages to SSE sessions
- Deprecation warning logged on each SSE connection

**SSE limitations:**
- Max 20 concurrent sessions
- No offline message queue
- No automatic reconnection
- No streaming cancel support
- Server logs deprecation warnings

## Health Monitoring

Check transport health:

```bash
curl http://127.0.0.1:3001/health/transport
```

Response:
```json
{
  "ws": {
    "status": "healthy",
    "activeSessions": 8,
    "uptime": 3600
  },
  "sse": {
    "status": "deprecated",
    "activeSessions": 2,
    "maxSessions": 20
  },
  "messageBus": {
    "status": "healthy",
    "queuedMessages": 0,
    "totalDelivered": 15420
  }
}
```

## Troubleshooting

### Connection refused
Ensure the server is running and WS is enabled on port 3001.

### Authentication failure
Verify `agentId` matches a registered core staff ID or hired auxiliary agent.

### Messages not delivered
Check `GET /health/transport` — if `queuedMessages` > 0, the agent may be disconnected. Reconnect to replay.

### Stream stops mid-way
Check for `stream_end` frame. If connection dropped, reconnect — offline queue will replay missed chunks.

### SSE still showing in logs
This is expected — deprecation warnings are logged on every SSE connection. Migrate agents to WS to eliminate warnings.
