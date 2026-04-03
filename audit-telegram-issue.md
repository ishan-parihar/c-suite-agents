# Telegram Response Issue Audit

## Problem
Sending messages to Strategos via Telegram does not generate replies. Only shows "(no reply)".

## Root Cause

### 1. **Incorrect OpenCode API Usage** (Critical)
**Location:** `src/integrations/telegram.ts:350-380`

**Current Implementation:**
```typescript
const msgRes = await fetch(`${openCodeUrl}/session/${ocSessionId}/message`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ 
    parts: [{ type: "text", text: prompt }], 
    agent: agentId === "strategos" ? "default" : agentId 
  })
});
```

**Problem:** 
- OpenCode HTTP server (port 4096) is for **web UI only**
- POST to `/session/{id}/message` returns HTTP 200 with **empty body** (Content-Length: 0)
- OpenCode does **not** support conversational HTTP REST API

**Evidence:**
```bash
curl -v POST http://localhost:4096/session/{id}/message
# Returns: HTTP/1.1 200 OK, Content-Length: 0
```

### 2. **Model Configuration Error** (Critical)
**Location:** `~/.config/opencode/opencode.json`

**Current Config:**
```json
{
  "model": "qwen-proxy/coder-model"
}
```

**Problem:**
- Model `qwen-proxy/coder-model` does not exist
- `opencode models` shows available models but not this one
- All `opencode run` commands fail with `ProviderModelNotFoundError`

**Available Models:**
- opencode/claude-sonnet-4
- opencode/gpt-5
- opencode/gemini-3-flash
- etc.

### 3. **No Error Handling** (High)
**Location:** `src/integrations/telegram.ts:370-380`

**Current Implementation:**
```typescript
try { 
  result = bodyText ? JSON.parse(bodyText) : null; 
} catch { 
  result = { text: bodyText }; 
}
const reply = textParts?.map((p: any) => p.content || p.text).join("\n") 
  || (result?.text as string) 
  || "(no reply)";
```

**Problem:**
- Empty response from OpenCode is not detected as error
- Falls through to "(no reply)" silently
- No logging of actual HTTP response status or body

## Architecture Understanding

### How Strategos Should Work

```
┌─────────────┐
│   Telegram  │
│   (User)    │
└──────┬──────┘
       │ Message: "Hello"
       ▼
┌─────────────────────────────────────────┐
│  src/integrations/telegram.ts           │
│  - Receives Telegram message            │
│  - Builds prompt with wake context      │
│  - Routes to appropriate agent          │
└──────┬──────────────────────────────────┘
       │
       │ CURRENTLY: HTTP POST (BROKEN) ❌
       │ SHOULD BE: opencode run or ACP stdio ✅
       ▼
┌─────────────────────────────────────────┐
│  OpenCode ACP (Agent Control Protocol)  │
│  - Processes message with MCP tools     │
│  - Executes Strategos MCP server tools  │
│  - Generates response                   │
└──────┬──────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────┐
│  Strategos MCP Server                   │
│  - agent.wake                            │
│  - memory.recall                         │
│  - board.get                             │
│  - message.search                        │
│  - lifeos.query                          │
│  - etc. (27 tools)                      │
└─────────────────────────────────────────┘
```

### Correct OpenCode Integration Patterns

**Pattern 1: CLI (`opencode run`)**
```bash
opencode run "Your message here"
# Returns: Response text directly
```

**Pattern 2: ACP stdio (JSON-RPC 2.0)**
```bash
opencode acp --print-logs
# stdin:  {"jsonrpc":"2.0","id":1,"method":"session/new","params":{...}}
# stdout: {"jsonrpc":"2.0","id":1,"result":{...}}
```

**Pattern 3: HTTP (Web UI only)**
```bash
# Only for browser-based UI, not programmatic use
```

## Required Fixes

### Fix 1: Update OpenCode Model Configuration
**File:** `~/.config/opencode/opencode.json`

Change:
```json
"model": "qwen-proxy/coder-model"
```

To (recommended):
```json
"model": "opencode/claude-sonnet-4"
```

Or any available model from `opencode models` output.

### Fix 2: Replace HTTP with CLI Integration
**File:** `src/integrations/telegram.ts`

Replace HTTP fetch calls with `opencode run` CLI execution:

```typescript
import { exec } from "child_process";
import { promisify } from "util";
const execAsync = promisify(exec);

// In message handler:
try {
  const { stdout } = await execAsync(
    `opencode run ${JSON.stringify(prompt)}`,
    { timeout: 60000, maxBuffer: 10 * 1024 * 1024 }
  );
  reply = stdout.trim() || "(no reply)";
} catch (err: any) {
  logger.error({ err: err.message, stdout: err.stdout, stderr: err.stderr }, "OpenCode run failed");
  reply = `(error: ${err.message})`;
}
```

### Fix 3: Add Proper Error Handling
- Log full OpenCode responses
- Distinguish between "no reply" vs error
- Add timeout handling
- Validate response format

### Fix 4: Session Management (Optional Enhancement)
Current code tries to maintain OpenCode sessions per chat+agent. With `opencode run`, sessions are stateless. To maintain context:

**Option A:** Use LifeOS memory for context
- Store conversation history in LifeOS
- Inject recent messages into prompt

**Option B:** Use ACP stdio mode
- Maintain long-running ACP process
- More complex but true session state

## Testing Plan

1. **Fix model config**
   ```bash
   # Update ~/.config/opencode/opencode.json
   opencode run "Hello"  # Should work now
   ```

2. **Test CLI integration**
   ```bash
   # In strategos directory
   npm run build
   npm start
   # Send Telegram message
   # Should get reply
   ```

3. **Verify MCP tools work**
   ```bash
   # Check logs for tool calls
   # agent.wake, memory.recall, etc.
   ```

4. **Test all commands**
   - /start
   - /agent CFO
   - Natural language messages
   - /recall, /wake, /messages

## Additional Issues Found

### 5. **Hardcoded Paths** (Medium)
**Location:** `.env`
```bash
LANCEDB_DIR=/home/ishanp/.local/share/strategos/lancedb
KANBAN_DB=/home/ishanp/.local/share/strategos/kanban/kanban.db
```

Should use `$HOME` or relative paths for portability.

### 6. **No Health Check** (Low)
No endpoint to check if Strategos is working properly. Add:
```typescript
bot.command("ping", async (ctx) => {
  await ctx.reply("🏓 Pong! Strategos is online");
});
```

### 7. **Logging Gaps** (Medium)
- No logging of OpenCode request/response bodies
- No metrics on response times
- No tracking of failed vs successful replies

## Recommended Next Steps

1. **Immediate:** Fix model configuration
2. **High Priority:** Replace HTTP with `opencode run`
3. **Medium Priority:** Add error handling and logging
4. **Low Priority:** Add health check endpoint
5. **Future:** Consider ACP stdio for session state

## Files to Modify

- `~/.config/opencode/opencode.json` (model config)
- `src/integrations/telegram.ts` (main fix)
- `src/logger.ts` (add more logging)
- `.env.example` (update paths)

## Summary

**The core issue is using the wrong OpenCode integration method.** The HTTP server is for the web UI, not programmatic access. Switching to `opencode run` CLI will fix the "(no reply)" issue immediately.

**Estimated Fix Time:** 1-2 hours
**Complexity:** Low (simple API replacement)
**Risk:** Low (isolated change, easy to rollback)
