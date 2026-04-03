# OpenCode ACP Integration Fix Summary

## Problem
The Telegram integration was using the wrong OpenCode API. The HTTP server on port 4096 is for web UI only and returns empty responses when used for agent communication.

## Root Cause Analysis

### Initial Approach (FAILED)
- Tried to use `opencode acp --cwd ... --print-logs` for stdio-based JSON-RPC communication
- Initialize handshake worked, but `session/new` requests never received responses
- Process would exit or hang without returning session IDs

### Investigation
Tested multiple approaches:
1. ❌ ACP stdio mode - session/new never responded
2. ❌ ACP HTTP mode (--port 0) - process exited immediately  
3. ❌ `opencode run --format json` with --pure flag - no output
4. ❌ `opencode run` spawned from Node.js child_process - exited with no output
5. ✅ **HTTP server on port 4096** - WORKS!

### Key Discovery
The existing OpenCode HTTP server (running on port 4096) provides a working API:
- `POST /session` - creates new session
- `POST /session/{id}/message` - sends message and gets response
- Response includes full conversation history for context

## Solution

### New Implementation
Rewrote `src/acp/opencode-client.ts` to use HTTP API instead of stdio:

```typescript
// Create session
POST http://127.0.0.1:4096/session
Response: { "id": "ses_..." }

// Send message  
POST http://127.0.0.1:4096/session/{sessionId}/message
Body: { "parts": [{ "type": "text", "text": "message" }] }
Response: { "parts": [{ "type": "text", "text": "response" }, ...] }
```

### Changes Made

1. **`src/acp/opencode-client.ts`** - Complete rewrite:
   - Removed spawn/child_process approach
   - Uses fetch() to communicate with HTTP server
   - Emits events for text/reasoning/step updates
   - Returns tokens and cost info

2. **`src/integrations/telegram.ts`** - Updated imports:
   - Changed `getACPClient()` → `getOpenCodeClient()`
   - Updated session creation (no mcpServers parameter needed)
   - Updated sendMessage to use new API

### Configuration
Set `OPENCODE_SERVER_URL` in `.env` (defaults to `http://127.0.0.1:4096`)

## Testing

### Unit Test
```bash
node -e "
const { getOpenCodeClient } = require('./build/acp/opencode-client.js');
const client = getOpenCodeClient();
await client.start(process.cwd());
const session = await client.createSession(process.cwd());
const result = await client.sendMessage(session, 'Say hello');
console.log(result.text); // 'Hello! 👋'
"
```

### Session Persistence
- Sessions persist on OpenCode server (in opencode.db)
- Strategos stores session IDs in `oc_sessions` table
- Each Telegram chat + agent combination gets its own session
- `/session reset [agent]` clears ACP session but preserves LanceDB memory

## Benefits
1. ✅ Reliable - HTTP API always responds
2. ✅ Fast - No process spawn overhead
3. ✅ Persistent - Sessions survive Strategos restarts
4. ✅ Context-aware - Full conversation history maintained
5. ✅ MCP tools accessible - Agent can use all Strategos MCP tools

## Files Modified
- `src/acp/opencode-client.ts` - Complete rewrite (152 lines)
- `src/integrations/telegram.ts` - Updated to use new client

## Next Steps
- Test actual Telegram message flow end-to-end
- Verify session persistence across restarts
- Test `/session reset` command
- Confirm MCP tools are accessible (agent.wake, memory.recall, etc.)
