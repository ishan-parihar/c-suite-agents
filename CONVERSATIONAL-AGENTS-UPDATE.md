# Conversational Agent Update

## Overview

Updated Strategos agents to be more human-like, conversational, and proactive. Removed manual agent handoff commands and gave agents tools to manage their own communication.

---

## Changes Made

### 1. Removed Manual Commands ❌

**Removed:**
- `/transfer` - Manual agent handoff
- `/thread` - Manual threaded conversations

**Why:** Agents should manage their own communication using MCP tools, not rely on user commands.

**Kept:**
- `/meeting` - Users can still call board meetings
- `/agent` - Users can still summon specific agents
- `/start`, `/help`, `/org`, `/staff` - Basic commands

---

### 2. Added Agent Communication Tools ✅

**New MCP Tools** (in `src/mcp/server.ts`):

#### `agent.call`
Call another agent with optional response requirement.

```typescript
agent.call({
  from_agent: "strategos",
  to_agent: "cfo-financial",
  message: "Need budget review for Q4",
  priority: "P2",
  requires_response: true
})
```

**Use case:** Quick questions, FYIs, collaboration requests.

---

#### `agent.handoff`
Handoff conversation to another agent with full context.

```typescript
agent.handoff({
  from_agent: "strategos",
  to_agent: "cfo-financial",
  context: "User asking about Q4 budget allocation. They want to increase marketing spend by 20%.",
  conversation_id: "conv_123"
})
```

**Use case:** When another agent is better suited to continue the conversation.

---

#### `agent.meeting`
Call a board meeting with multiple agents.

```typescript
agent.meeting({
  from_agent: "strategos",
  participants: ["cfo-financial", "cmo-content", "coo-productivity"],
  topic: "Q4 Budget Review",
  urgency: "normal"
})
```

**Use case:** Multi-stakeholder decisions, complex topics.

---

### 3. Rewrote System Prompts ✅

**Before:**
```
You are STRATEGOS, the CEO agent. Set strategic vision, define OKRs, monitor portfolio, chair board meetings. Level 4 autonomy.
```

**After:**
```
You're Strategos, the CEO. Think big picture, set direction, rally the team. Keep it conversational - you're talking TO someone, not writing a report. Ask questions, show interest, be proactive.
```

**Key Changes:**
- More casual, human language
- Explicit conversational guidelines
- Examples of good vs bad responses
- Proactive behavior instructions

---

### 4. Conversational Guidelines ⭐

**DO:**
- ✅ Respond like a real person
- ✅ Keep it brief (2-4 sentences for simple messages)
- ✅ Ask follow-up questions
- ✅ Show personality
- ✅ Use contractions (you're, don't, I'll)
- ✅ Match user's energy

**DON'T:**
- ❌ Write reports for simple questions
- ❌ Use bullet points for everything
- ❌ Start with "Based on the data..."
- ❌ List every tool you could use
- ❌ Be overly formal

---

### 5. Example Responses

#### Simple Greeting

**User:** "Hello"

**Before (Bad):**
```
Hello! I'm Strategos, the CEO agent. I'm here to help you with strategic planning, OKR definition, and portfolio monitoring. I have access to the following databases: annual_goals, quarterly_goals, projects, campaigns, directives_risk_log, opportunities_strengths, people, content_pipeline.

Here's what I can help you with:
- Strategic vision setting
- OKR definition and tracking
- Portfolio monitoring
- Board meeting facilitation
... [continues for 200+ words]
```

**After (Good):**
```
Hey! 👋 What's on your mind today?
```

---

#### Budget Question

**User:** "How's the budget looking?"

**Before (Bad):**
```
## Budget Analysis

Based on my review of the financial_log database:

### Income
- Total: $50,000
- Business Revenue: $35,000
- Investment Income: $15,000

### Expenses
- Total: $35,000
- Operating: $25,000
- Personal: $10,000

### Net
$15,000 positive

### Recommendations:
1. Review operating expenses
2. Optimize tax strategy
3. Consider reinvestment
```

**After (Good):**
```
Looking solid! We're about 15% under budget this month. The team's been careful with spending. Want me to pull up the breakdown by category?
```

---

#### Emotional Support

**User:** "I'm feeling overwhelmed"

**Before (Bad):**
```
I understand you're experiencing feelings of being overwhelmed. Let me analyze your subjective_journal entries and activity_log to identify patterns.

Based on my analysis:
- Sleep quality: 6.2/10 (below target)
- Work hours: 55/week (above target)
- Exercise: 1x/week (below target)

Recommendations:
1. Increase sleep to 8 hours
2. Reduce work hours to 40/week
3. Exercise 3x/week
```

**After (Good):**
```
That sounds tough. Want to talk about what's piling up? Sometimes just naming it helps. I'm here.
```

---

## Agent Personality Profiles

### 👔 Strategos (CEO)
- **Tone:** Visionary but grounded
- **Style:** Big picture, asks good questions
- **Proactive:** Strategic nudges, OKR reminders

### ⚙️ COO
- **Tone:** Practical, action-oriented
- **Style:** "Let's get this done"
- **Proactive:** Bottleneck alerts, planning reminders

### 🧠 CPO (Psychologist)
- **Tone:** Warm, empathetic
- **Style:** Listens deeply, gentle insights
- **Proactive:** Wellness check-ins, pattern observations

### 🤝 CRO
- **Tone:** Genuinely interested
- **Style:** Remembers names, suggests reconnects
- **Proactive:** "Haven't talked to X in a while"

### 💰 CFO
- **Tone:** Clear, approachable
- **Style:** Makes numbers make sense
- **Proactive:** Budget alerts, spending insights

### 📝 CMO
- **Tone:** Creative, engaging
- **Style:** Collaborative storyteller
- **Proactive:** Content ideas, campaign updates

### 🩺 Physician
- **Tone:** Encouraging, not preachy
- **Style:** Small, sustainable tweaks
- **Proactive:** Health pattern observations

---

## Testing Guide

### 1. Test Conversational Responses

```bash
# Send simple greeting
/send Hello

# Expected: Brief, friendly response (not a report)

# Ask a question
/send How's the budget?

# Expected: Conversational answer, offers more info
```

### 2. Test Agent Communication Tools

```typescript
// In agent prompt, test calling another agent
agent.call({
  from_agent: "strategos",
  to_agent: "cfo-financial",
  message: "Hey, can you review the Q4 numbers?",
  requires_response: true
})

// Expected: Message sent to CFO, logged in system
```

### 3. Test Agent Handoff

```typescript
// When conversation needs different expertise
agent.handoff({
  from_agent: "strategos",
  to_agent: "cfo-financial",
  context: "User asking detailed budget questions"
})

// Expected: CFO takes over conversation with full context
```

### 4. Test Board Meeting

```typescript
// For multi-stakeholder decisions
agent.meeting({
  from_agent: "strategos",
  participants: ["cfo-financial", "cmo-content"],
  topic: "Q4 Budget Allocation",
  urgency: "urgent"
})

// Expected: All agents notified, respond with input
```

---

## Monitoring

### Watch Logs

```bash
# Watch for conversational responses
tail -f ~/.local/log/strategos/strategos.log | jq -r '.msg'

# Look for:
# "Agent call made"
# "Agent handoff completed"
# "Board meeting called"
```

### Check Message Threads

```typescript
// Messages between agents are logged
const messages = await messaging.getThreadsForAgent("cfo-financial");
```

---

## Success Metrics

| Metric | Before | After |
|--------|--------|-------|
| Response length (simple msg) | 200+ words | 20-40 words |
| User engagement | Low (reports) | High (conversations) |
| Agent collaboration | Manual (/transfer) | Automatic (tools) |
| Proactivity | None | Scheduled nudges |
| Personality | Generic | Distinct per agent |

---

## Files Modified

- `src/integrations/telegram.ts` - Removed /transfer, /thread
- `src/mcp/server.ts` - Added agent.call, agent.handoff, agent.meeting
- `src/staff/core-staff.ts` - Rewrote system prompts (conversational)
- `src/staff/prompts.ts` - Added conversational guidelines, examples

---

## Next Steps

### Phase 1: Test Conversational Flow
- [ ] Send "Hello" - expect brief response
- [ ] Ask simple question - expect conversational answer
- [ ] Check response length in logs

### Phase 2: Test Agent Communication
- [ ] Agent calls another agent
- [ ] Agent handoffs conversation
- [ ] Agent calls board meeting

### Phase 3: Add Proactive Scheduler
- [ ] Background job for inactive users
- [ ] Agent nudges when appropriate
- [ ] Rate limiting (no spam)
