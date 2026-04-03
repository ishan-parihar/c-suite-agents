# Fixes Applied: Report-Style & Telegram Formatting

**Date:** 2026-04-03  
**Issues Fixed:** 2 critical UX problems

---

## Issue 1: Agents Writing Reports Instead of Conversing ❌→✅

### Problem
Agents were responding to simple "Hello" with 200+ word reports including:
- Markdown headers (##, ###)
- Tables
- Bullet point lists
- Comprehensive analysis

### Root Cause
System prompts from `src/staff/prompts.ts` were NOT being included in messages sent to OpenCode agents.

### Fix Applied

**Files Modified:**
1. `src/integrations/telegram.ts` - Added system prompt to user message flow
2. `src/scheduler/message-processor.ts` - Added system prompt to agent message processing
3. `src/scheduler/agent-executor.ts` - Added system prompt to proactive checks
4. `src/staff/prompts.ts` - Added stronger conversational enforcement

**Changes:**

#### telegram.ts (Line ~465)
```typescript
// BEFORE: No system prompt
const prompt = `[Agent: ${agentId}]
[Chat: ${chatId}]
...
Use Strategos MCP tools via MCP. Think step-by-step and provide a helpful response.`;

// AFTER: System prompt included
const promptData = getPromptForRole(agentId);
const systemPrompt = promptData ? promptData.prompt : "You are a helpful AI assistant.";

const prompt = `${systemPrompt}

---

[Current Session]
Agent: ${agentId}
...

Remember: Be conversational, not report-style. Keep it brief and helpful.`;
```

#### prompts.ts - Added Final Reminder
```typescript
## ⚠️ FINAL REMINDER: CONVERSATIONAL ONLY ⚠️

**NEVER write reports, NEVER use markdown headers (##), NEVER use tables for simple responses.**

**For "Hello" or simple greetings:**
- GOOD: "Hey! What's on your mind today?" (1 sentence)
- BAD: Anything with ## headers, tables, or bullet points

**You are a PERSON having a conversation, not a system generating reports.**

If you catch yourself writing ## or tables or long bullet lists, STOP and rewrite as casual speech.
```

---

## Issue 2: Telegram Markdown Not Parsing ❌→✅

### Problem
Users saw raw markdown characters:
```
## 📊 Last 48 Hours Snapshot
**178h tracked** — Pattern concerns:
```

Instead of formatted text:
## 📊 Last 48 Hours Snapshot
**178h tracked** — Pattern concerns:

### Root Cause
Telegram's `ctx.reply()` was called without `parse_mode: "Markdown"` option.

### Fix Applied

**Files Modified:**
1. `src/integrations/telegram.ts` - Added parse_mode to all reply calls
2. `src/integrations/telegram.ts` - Fixed sendTelegramMessage function

**Changes:**

#### telegram.ts (Line ~511)
```typescript
// BEFORE: No parse mode
await ctx.reply(combined);

// AFTER: Markdown parsing enabled
await ctx.reply(combined, { parse_mode: "Markdown" });
```

#### telegram.ts (Line ~516)
```typescript
// BEFORE: No parse mode
const errorMsg = `❌ **Error processing your message**\n\n${err.message}...`;
await ctx.reply(errorMsg);

// AFTER: Proper markdown escaping + parse mode
const errorMsg = `❌ *Error processing your message*\n\n\`${err.message}\`...`;
await ctx.reply(errorMsg, { parse_mode: "Markdown" });
```

#### telegram.ts (Line ~571-584)
```typescript
// BEFORE: No parse mode
await telegramBot.telegram.sendMessage(cfg.telegramChatId, text);

// AFTER: Markdown + notification control
await telegramBot.telegram.sendMessage(cfg.telegramChatId, formattedText, { 
  parse_mode: "Markdown",
  disable_notification: priority === "info"
});
```

---

## Testing Instructions

### Test Conversational Responses

1. **Restart the system:**
   ```bash
   npm start
   ```

2. **Send "Hello" via Telegram:**
   ```
   Hello
   ```
   
   **Expected:** "Hey! What's on your mind today?" or similar (1-2 sentences)
   
   **NOT:** Tables, headers, bullet lists

3. **Send simple status question:**
   ```
   How's the budget?
   ```
   
   **Expected:** "Looking good! We're about 15% under budget..." (2-3 sentences)
   
   **NOT:** "## Budget Analysis\n\n| Category | Amount |..."

### Test Telegram Formatting

1. **Send any message** - should see:
   - ✅ Bold text rendered (not `**bold**`)
   - ✅ Headers rendered (not `## Header`)
   - ✅ Lists rendered (not `- item`)

2. **Error messages** - should see:
   - ✅ Formatted error with code blocks
   - ✅ Bold/italic text rendered

---

## Files Modified (4)

| File | Changes | Lines |
|------|---------|-------|
| `src/integrations/telegram.ts` | System prompt + parse_mode | ~15 |
| `src/scheduler/message-processor.ts` | System prompt in messages | ~10 |
| `src/scheduler/agent-executor.ts` | System prompt in execution | ~15 |
| `src/staff/prompts.ts` | Stronger conversational rules | ~20 |

**Total:** ~60 lines modified/added

---

## Expected Behavior After Fix

### Before ❌
```
User: Hello

👔 Strategos:
## 📊 Last 48 Hours Snapshot

**178h tracked** — Pattern concerns:

| Category | Hours | Notes |
|----------|-------|-------|
| 😴 Sleep | 75.8h | Fragmented...

---

## 🔴 Unchanged Critical Issues
...
```

### After ✅
```
User: Hello

👔 Strategos:
Hey! 👋 What's on your mind today?
```

---

## Build Status
```
✅ TypeScript compilation successful
✅ All files compile without errors
```

---

## Notes

### Session Reset Recommended
If agents continue writing reports after the fix, their OpenCode sessions may have learned the wrong style. To reset:

```bash
# In Telegram, use:
/session reset strategos
/session reset coo-productivity
/session reset cfo-financial
# etc for each agent
```

Or wait for sessions to timeout (8 hours) and they'll refresh with new system prompts.

### Why This Happened
The system prompts were defined in `src/staff/prompts.ts` but were never actually sent to OpenCode when messaging agents. The agents were responding based on:
1. Their initial training (helpful assistant)
2. Previous conversation patterns in the session
3. No explicit conversational guidelines

Now the full system prompt (including conversational rules) is sent with every message.

---

## Verification Checklist

- [ ] System restarted with new build
- [ ] "Hello" test sent via Telegram
- [ ] Response is conversational (1-2 sentences, no headers/tables)
- [ ] Telegram formatting renders correctly (bold, italic, lists)
- [ ] Error messages display with proper formatting
- [ ] Agent-to-agent messages also conversational

**Status:** Ready for testing
