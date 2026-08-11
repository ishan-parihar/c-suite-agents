# WebSocket Migration Roadmap

**Project:** Operant — Agent Communication Transport Upgrade
**From:** HTTP/SSE + SQLite polling → **WebSocket-first bidirectional transport**
**Reference Architecture:** OpenClaw Gateway WS model (`src/gateway/client.ts`, `src/gateway/server-http.ts`, `src/acp/translator.ts`)
**Date:** 2026-04-10
**Status:** Planned

---

## Executive Summary

Operant's current transport model constrains agents to HTTP request lifecycles. The MCP server uses SSE (Server-Sent Events) with 5-minute timeouts, and agents poll SQLite for messages. This creates artificial boundaries on agent autonomy — conversations die when HTTP connections drop, tool calls timeout on long-running operations, and message delivery has latency from polling intervals.

The WebSocket migration replaces this with a persistent, bidirectional channel per agent, enabling:
- **Unlimited conversation duration** — no HTTP timeout, streams live as long as WS is open
- **Instant message delivery** — push instead of poll, zero latency
- **Graceful reconnection** — queued message replay on reconnect (seq-based gap detection)
- **Native runtime streaming** — `streamMessage()` AsyncIterable piped directly to WS frames

---

## Current State (Problem)

```
Agent → LLM Provider (stream) → Native Runtime → SSE Transport → HTTP Response (5min timeout)
         ↑
Agent ← SQLite Poll (interval) ← Messaging System ← Agent
```

**Pain points:**
1. SSE is unidirectional — server pushes, client cannot send back on same channel
2. 5-minute HTTP timeout kills long-running agent conversations
3. Message polling adds latency (agents check every N seconds)
4. No reconnection recovery — dropped connections lose in-flight state
5. `streamMessage()` async iterator buffered in HTTP response lifecycle

---

## Target State

```
┌─────────────────────────────────────────────────────────────┐
│                    Operant Gateway (port 3001)               │
│                                                             │
│  ┌──────────────────┐    ┌──────────────────────────────┐   │
│  │  HTTP Server     │    │  WebSocket Server            │   │
│  │                  │    │  (upgrade on /ws)            │   │
│  │  SSE (legacy)    │    │                              │   │
│  │  ──fallback──→   │    │  Active WS Connections:      │   │
│  └──────────────────┘    │  Map<agentId, WsSession>     │   │
│                          └──────────┬───────────────────┘   │
│                                     │                       │
│  ┌──────────────────────────────────┴───────────────────┐   │
│  │              Message Bus (EventEmitter)               │   │
│  │  - publish(agentId, event) → WS send                  │   │
│  │  - subscribe(agentId, handler) → queue + deliver      │   │
│  └──────┬───────────────────────────────┬───────────────┘   │
│         │                               │                   │
│  ┌──────┴──────┐                 ┌──────┴──────────────┐   │
│  │ MCP Server  │                 │ Messaging System    │   │
│  │ (tools)     │                 │ (push + SQLite q)   │   │
│  └─────────────┘                 └─────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
         │
    ┌────┴────┐
    │ Agent   │  Each agent connects as WS client
    │ WS Conn │  - Auth: agent auth profile
    │         │  - Receives push: messages, tool results
    │         │  - Sends: tool responses, cancel, new prompts
    │         │  - Streams: LLM tokens, thinking blocks
    └─────────┘
```

---

## Phase 5A: WebSocket Transport Layer

**Duration:** 2-3 days
**Risk:** Low — additive, non-breaking

### Objectives
- Add WS server alongside existing HTTP/SSE on port 3001
- Frame protocol design and implementation
- Agent auth on WS connect
- Session registry for active WS connections

### Deliverables

#### 5A.1: Dependencies & Infrastructure
- [ ] Add `ws` package (`npm install ws @types/ws`)
- [ ] Create `src/transport/ws-server.ts`
- [ ] Create `src/transport/ws-types.ts`
- [ ] Modify `src/index.ts` to attach WS upgrade handler to existing HTTP server

#### 5A.2: Frame Protocol
Design JSON frame format modeled after openclaw's `RequestFrame`/`EventFrame`:

```typescript
// Client → Server
type ClientFrame =
  | { type: "auth"; token: string; agent_id: string }
  | { type: "tool_response"; id: string; payload: any }
  | { type: "cancel"; run_id: string }
  | { type: "ping" };

// Server → Client
type ServerFrame =
  | { type: "auth_ok"; session_id: string }
  | { type: "auth_error"; reason: string }
  | { type: "message"; payload: MessagePayload; seq: number }
  | { type: "stream_chunk"; session_id: string; payload: StreamEvent }
  | { type: "stream_end"; session_id: string; stop_reason: string }
  | { type: "tool_call"; id: string; payload: ToolCallPayload }
  | { type: "pong" }
  | { type: "reconnect_hint"; last_seq: number };
```

#### 5A.3: WS Server Implementation
- [ ] WebSocketServer attached to existing HTTP server (`server.on('upgrade', ...)`)
- [ ] Connection handler: parse auth frame, validate agent profile
- [ ] Session map: `Map<string, WsSession>` (agentId → { ws, seq, lastActivity, authProfile })
- [ ] Heartbeat: ping/pong every 30s, close idle connections after 60s
- [ ] Graceful shutdown: close all WS with code 1001 on server stop

#### 5A.4: Auth Integration
- [ ] WS connect → first frame must be `{ type: "auth", token, agent_id }`
- [ ] Validate against existing `auth-profiles.ts` system
- [ ] Reject invalid auth → close with code 1008 + reason
- [ ] On auth OK → send `{ type: "auth_ok", session_id }`

#### 5A.5: Session Registry Integration
- [ ] On WS connect: register in `src/scheduler/session-registry.ts` as active transport
- [ ] On WS disconnect: mark transport as offline (keep session state)
- [ ] Expose `getActiveTransport(agentId): 'ws' | 'sse' | 'polling'`

#### 5A.6: Testing
- [ ] Unit tests: frame serialization/deserialization
- [ ] Integration tests: WS connect → auth → message exchange
- [ ] Test: invalid auth rejection
- [ ] Test: heartbeat / idle disconnect
- [ ] Test: graceful shutdown

### Success Criteria
- WS server starts on port 3001 alongside SSE
- Agent can connect, auth, and exchange frames
- All 227 existing tests still pass
- SSE still works (backward compatibility)

---

## Phase 5B: Agent Messaging → Push

**Duration:** 2-3 days
**Risk:** Medium — modifies message delivery path

### Objectives
- Replace polling with WS push for message delivery
- Maintain SQLite queue as fallback for offline agents
- Implement queued message replay on reconnect

### Deliverables

#### 5B.1: Message Bus
- [ ] Create `src/transport/message-bus.ts` — EventEmitter-based pub/sub
- [ ] `publish(agentId, message)` → if WS connected, push immediately
- [ ] `subscribe(agentId, handler)` → register handler for offline agents
- [ ] Queue: if agent offline, queue message in memory + SQLite

#### 5B.2: Messaging System Integration
- [ ] Modify `src/organic/messaging.ts` `send()`:
  - After SQLite persist → call `messageBus.publish(to, message)`
  - If WS connected → instant push
  - If offline → queue for replay
- [ ] Modify `reply()`: same push path
- [ ] Keep existing SQLite read APIs for historical queries

#### 5B.3: Reconnect Replay
- [ ] On WS reconnect: check `last_seq` from client's auth frame
- [ ] Deliver all queued messages with `seq > last_seq`
- [ ] Mark delivered messages as sent in queue
- [ ] Gap detection: if `seq` jump > 1, log warning and request full resync

#### 5B.4: Polling Deprecation Path
- [ ] Agent native runtime checks for WS transport first
- [ ] Falls back to SQLite polling only if WS not available
- [ ] Add config flag `transport.mode: "ws" | "sse" | "polling"` (default: `"ws"`)
- [ ] Log warning when falling back to polling

#### 5B.5: Testing
- [ ] Test: message push to connected agent
- [ ] Test: message queued for offline agent
- [ ] Test: replay on reconnect
- [ ] Test: gap detection and recovery
- [ ] Test: fallback to polling when WS unavailable

### Success Criteria
- Connected agents receive messages instantly (< 10ms)
- Offline agents receive all queued messages on reconnect
- No message loss during transport transitions
- Polling fallback works for legacy clients

---

## Phase 5C: Native Runtime WS Streaming

**Duration:** 2-3 days
**Risk:** Medium — core agent execution path

### Objectives
- Pipe `streamMessage()` AsyncIterable directly to WS frames
- Eliminate HTTP timeout constraints on agent execution
- Support tool call request/response over WS

### Deliverables

#### 5C.1: Stream Piping
- [ ] Modify `src/runtime/native-agent-runtime.ts`:
  - Detect WS transport for agent session
  - Pipe `streamMessage()` output as `{ type: "stream_chunk", payload }` frames
  - On stream end → `{ type: "stream_end", stop_reason }`
- [ ] Each chunk sent immediately — no buffering
- [ ] Backpressure: check `ws.bufferedAmount`, pause if > 1MB

#### 5C.2: Tool Call over WS
- [ ] Server sends `{ type: "tool_call", id, payload: { name, args } }` to agent WS
- [ ] Agent responds with `{ type: "tool_response", id, payload: { result } }`
- [ ] Timeout: 48h default (from Phase 2 timeout resolver)
- [ ] Idempotent: duplicate tool_response ignored by id

#### 5C.3: Cancel Support
- [ ] Client sends `{ type: "cancel", run_id }` over WS
- [ ] Runtime aborts current stream via AbortController
- [ ] Server sends `{ type: "stream_end", stop_reason: "cancelled" }`

#### 5C.4: Timeout Removal (Final)
- [ ] Remove SSE 5-minute timeout entirely for WS-connected agents
- [ ] Keep SSE timeout for backward compatibility
- [ ] Agent execution bounded only by Phase 2 timeout resolver (48h default, 0=unlimited)

#### 5C.5: Testing
- [ ] Test: stream chunk delivery over WS
- [ ] Test: tool call request/response cycle
- [ ] Test: cancel mid-stream
- [ ] Test: backpressure handling
- [ ] Test: no timeout on long-running streams (60s+ test)

### Success Criteria
- Agent streams run without timeout as long as WS is open
- Tool calls execute over WS with proper request/response
- Cancel works mid-stream
- Backpressure prevents memory exhaustion

---

## Phase 5D: Reconnection & Resilience

**Duration:** 1-2 days
**Risk:** Low — enhancement layer

### Objectives
- Implement openclaw-style reconnection with exponential backoff
- State recovery after reconnect
- Connection health monitoring

### Deliverables

#### 5D.1: Client-Side Reconnection
- [ ] Agent WS client implements reconnect with exponential backoff: 1s → 2s → 4s → ... → 30s max
- [ ] On reconnect: send `last_seq` in auth frame
- [ ] Max reconnect attempts: configurable (default: unlimited)
- [ ] Reconnect log: log each attempt for debugging

#### 5D.2: Server-Side State Recovery
- [ ] On WS reconnect: match agent to existing session
- [ ] Replay missed messages (seq-based)
- [ ] Resume interrupted streams (if still running)
- [ ] Clean up stale WS connections (same agent, old socket)

#### 5D.3: Health Monitoring
- [ ] Tick-based keepalive: server sends `{ type: "ping" }` every 30s
- [ ] Agent must respond with `{ type: "pong" }` within 60s
- [ ] Missing 2 consecutive pongs → close connection
- [ ] Health endpoint: `/health/transport` shows WS connection counts

#### 5D.4: Disconnect Grace
- [ ] Grace period: 5s after disconnect before rejecting pending prompts
- [ ] Use `agent.wait` pattern (openclaw) to check if agent recovered
- [ ] If agent reconnects within grace → resume
- [ ] If not → reject pending with "transport disconnected"

#### 5D.5: Testing
- [ ] Test: reconnect with backoff
- [ ] Test: state recovery after reconnect
- [ ] Test: health monitoring / pong timeout
- [ ] Test: disconnect grace period

### Success Criteria
- Agents automatically reconnect after network blips
- No message loss during reconnect
- Health monitoring detects dead connections
- Grace period prevents premature rejection

---

## Phase 5E: SSE Deprecation & Migration

**Duration:** 1 day
**Risk:** Low — cleanup phase

### Objectives
- Mark SSE as deprecated
- Default transport to WS
- Migration guide for any external MCP consumers

### Deliverables

#### 5E.1: Default Transport Switch
- [ ] Change default `transport.mode` to `"ws"`
- [ ] SSE still available via config override
- [ ] Log deprecation warning when SSE is used

#### 5E.2: Documentation
- [ ] Update README with WS transport documentation
- [ ] Add migration guide: SSE → WS
- [ ] Document frame protocol for external consumers

#### 5E.3: Cleanup (Optional)
- [ ] Remove SSE transport code (or keep for backward compat)
- [ ] Remove polling fallback code (or keep as emergency fallback)
- [ ] Remove SSE-specific timeout configs

---

## File Inventory

### New Files
| File | Phase | Purpose |
|------|-------|---------|
| `src/transport/ws-server.ts` | 5A | WebSocket server with upgrade handler |
| `src/transport/ws-types.ts` | 5A | Frame type definitions |
| `src/transport/message-bus.ts` | 5B | Pub/sub message bus |
| `src/transport/ws-client.ts` | 5A | Agent WS client (for native runtime) |
| `test/transport/ws-server.test.ts` | 5A | WS server tests |
| `test/transport/message-bus.test.ts` | 5B | Message bus tests |
| `test/transport/integration.test.ts` | 5C | End-to-end WS streaming tests |

### Modified Files
| File | Phase | Change |
|------|-------|--------|
| `src/index.ts` | 5A | Attach WS upgrade handler to HTTP server |
| `src/organic/messaging.ts` | 5B | Push to WS instead of just SQLite |
| `src/runtime/native-agent-runtime.ts` | 5C | Pipe streams to WS, tool calls over WS |
| `src/scheduler/session-registry.ts` | 5A | Track WS transport state |
| `src/agents/timeout.ts` | 5C | WS-connected agents skip HTTP timeout |
| `src/mcp/server.ts` | 5A | Share HTTP server with WS |
| `package.json` | 5A | Add `ws` dependency |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| WS connection drops cause message loss | Low | High | SQLite queue + seq-based replay |
| Memory leak from buffered WS frames | Medium | Medium | Backpressure check, bufferedAmount cap |
| Breaking existing SSE clients | Low | Medium | SSE kept as fallback during transition |
| Auth bypass on WS connect | Low | Critical | Same auth profile validation as SSE |
| Reconnect storm after outage | Medium | Low | Exponential backoff + jitter |
| Long-running streams consume memory | Low | Medium | Backpressure, idle timeout, 48h cap |

---

## Dependencies & Order

```
5A (WS Transport) ──→ 5B (Message Push) ──→ 5C (Runtime Streaming)
      │                      │                      │
      └──────────────────────┴──────────────────────┘
                               ↓
                        5D (Reconnection)
                               ↓
                        5E (SSE Deprecation)
```

**Strict ordering:** 5A must complete before 5B. 5B and 5C can proceed in parallel after 5A. 5D depends on 5B+5C. 5E is last.

---

## Estimated Timeline

| Phase | Duration | Effort |
|-------|----------|--------|
| 5A: WS Transport Layer | 2-3 days | ~16 hours |
| 5B: Agent Messaging → Push | 2-3 days | ~16 hours |
| 5C: Native Runtime WS Streaming | 2-3 days | ~16 hours |
| 5D: Reconnection & Resilience | 1-2 days | ~8 hours |
| 5E: SSE Deprecation | 1 day | ~4 hours |
| **Total** | **8-12 days** | **~60 hours** |

---

## Success Metrics

1. **Zero message loss** during normal operation and reconnect
2. **< 10ms** message delivery latency for connected agents (was: polling interval)
3. **No timeout** on agent streams with active WS connection
4. **Automatic reconnect** within 5s of network recovery
5. **All 227 existing tests pass** — zero regressions
6. **Backward compatible** — SSE still works for external consumers

---

## Open Questions

1. **Should WS run on same port (3001) or separate port?** → Recommendation: same port via HTTP upgrade
2. **Should we keep SSE indefinitely or remove after migration?** → Recommendation: keep for 1 release cycle, then remove
3. **Do external MCP consumers (OpenCode) need WS support?** → Investigate: does `@modelcontextprotocol/sdk` support WS transport?
4. **Should agent WS client be bundled in operant or separate package?** → Recommendation: bundled in operant, agents import from `operant/transport`
5. **What about rate limiting on WS connections?** → Implement per-agent message rate limit (1000 msg/min) to prevent abuse
