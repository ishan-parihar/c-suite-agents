# Strategos Agent Interaction Architecture

## Current State Analysis

### Memory Architecture Issues Found

1. **Client-side agent_id filtering** - LanceDB searches ALL agents then filters (inefficient, potential data leak)
2. **No message embeddings** - Message history uses keyword search only, no semantic search
3. **HierarchicalMemory unused** - Three-tier memory (personal/project/company) exists but never used
4. **Static wake context** - Always searches "recent activity", not message-relevant memories
5. **No proactive recall** - User message content NOT used to trigger memory recall automatically
6. **Embedding model inconsistency** - Different modules use different Ollama models

### Current Flow (Per Telegram Message)

```
User Message
    ↓
AgentContextManager.getWakeContext(agentId)
    ├─ Messaging context (pending, unread, threads)
    ├─ Kanban board (blocked, in-progress)
    ├─ Meeting votes
    └─ Memory.search(agentId, "recent activity", 5) ← Static query!
    ↓
Format as system prompt
    ↓
OpenCode ACP (HTTP)
    ↓
Agent receives prompt with wake context
    ↓
Agent must EXPLICITLY call memory.recall() to search
```

**Problem:** Memory is passive. Agent must know to search. No automatic relevance-based recall.

---

## Proposed Architecture Improvements

### 1. **Proactive Memory Injection**

Instead of static "recent activity", use the actual user message to trigger recall:

```typescript
// NEW: Before building prompt
const recall = await contextManager.recall({
  agent_id: agentId,
  query: text,  // ← Use actual user message!
  top_k: 5
});

// Inject into prompt
const prompt = `[Agent: ${agentId}]

[Context]
${wakeCtx}

[Relevant Memory]
${formatRecall(recall)}  // ← Message-specific memories!
[/Context]

[User]
${text}
[/User]`;
```

**Benefits:**
- Agent sees relevant memories immediately
- No need to explicitly call recall tool for basic context
- Faster response time (one less tool call)

---

### 2. **Agent Handoff System**

Allow seamless conversation transfer between agents:

#### Implementation: `/transfer` command

```typescript
// telegram.ts
bot.command("transfer", async (ctx) => {
  const args = ctx.message?.text?.split(/\s+/).slice(1) || [];
  const targetAgent = args[0];
  const summary = args.slice(1).join(" ");
  
  if (!targetAgent) {
    await ctx.reply("Usage: /transfer [agent] [summary]\nExample: /transfer CFO Please review this budget");
    return;
  }
  
  // 1. Save conversation context to memory
  await memory.upsert({
    agent_id: targetAgent,
    type: "handoff",
    content: summary,
    metadata: {
      from_agent: currentAgent,
      chat_id: chatId,
      thread_id: currentThreadId
    }
  });
  
  // 2. Notify target agent
  await messaging.send(currentAgent, targetAgent, {
    type: "handoff",
    content: summary,
    priority: "P2"
  });
  
  // 3. Update routing
  route.participants = [targetAgent];
  route.mode = "single";
  
  await ctx.reply(`✅ Transferred to **${targetAgent}**\n\n${summary}`);
});
```

#### Use Cases:
- CEO → CFO: "Review this budget proposal"
- CFO → CMO: "Align marketing budget with Q4 goals"
- Any agent → CEO: "Escalate for strategic decision"

---

### 3. **Multi-Agent Conversation Modes**

#### Current: Single agent or meeting (all agents)

#### Proposed: Dynamic participant selection

```typescript
type ConversationMode = 
  | { type: "single"; agent: string }
  | { type: "meeting"; agents: string[] }
  | { type: "threaded"; primary: string; cc: string[] }  // NEW
  | { type: "escalation"; chain: string[] };             // NEW

// Example: Threaded mode
// Primary agent responds, others are CC'd and can jump in
route = {
  type: "threaded",
  primary: "cmo-content",
  cc: ["strategos", "coo-productivity"]
};

// Fan-out: Primary responds first, CC'd agents see context
const replies = await Promise.all(
  [route.primary, ...route.cc].map(async (agentId) => {
    const isPrimary = agentId === route.primary;
    const prompt = buildPrompt(agentId, {
      role: isPrimary ? "respond" : "observe",
      context: fullContext
    });
    return acp.sendMessage(sessionId, prompt);
  })
);
```

#### Escalation Chain:
```typescript
// Automatic escalation if primary agent can't resolve
route = {
  type: "escalation",
  chain: ["cmo-content", "coo-productivity", "strategos"]
};

// Try each agent in sequence until one resolves
for (const agentId of route.chain) {
  const response = await acp.sendMessage(sessionId, prompt);
  if (response.confidence > 0.8) {
    return response;
  }
  // Auto-escalate to next
}
```

---

### 4. **Unified Memory Layer**

#### Problem: Three separate storage systems with inconsistent embeddings

#### Solution: Unified Memory Service

```typescript
// src/memory/unified.ts
export class UnifiedMemory {
  private lancedb: LanceDB;      // Long-term semantic
  private messages: MessageStore; // Conversation history
  private kanban: TaskStore;      // Task/project state
  
  constructor() {
    // Single embedding model for all
    this.embedder = new OllamaEmbedder(process.env.EMBEDDING_MODEL);
  }
  
  // Unified search across all systems
  async search(agentId: string, query: string, options: {
    topK?: number;
    systems?: ('memory' | 'messages' | 'tasks')[];
    timeRange?: { from: Date; to: Date };
    importance?: number;
  }) {
    const queryVector = await this.embedder.embed(query);
    
    const results = await Promise.all([
      options.systems?.includes('memory') 
        ? this.lancedb.search(agentId, queryVector, options.topK)
        : [],
      options.systems?.includes('messages')
        ? this.messages.search(agentId, query, options.topK) // ← Add embeddings!
        : [],
      options.systems?.includes('tasks')
        ? this.kanban.search(agentId, query, options.topK) // ← Add embeddings!
        : []
    ]);
    
    // Re-rank by combined relevance score
    return this.rerank(results.flat(), queryVector);
  }
  
  // Auto-consolidate important conversations
  async consolidate(agentId: string, exchange: Exchange) {
    const importance = await this.evaluateImportance(exchange);
    if (importance > 0.7) {
      await this.lancedb.upsert({
        agent_id: agentId,
        type: "conversation_summary",
        content: this.summarize(exchange),
        importance,
        embedding: await this.embedder.embed(exchange.summary)
      });
    }
  }
}
```

---

### 5. **Memory-Aware Routing**

Route messages to agents based on memory context:

```typescript
// Analyze message and route to most relevant agent
async function routeMessage(text: string, chatId: string) {
  // Search all agents' memories for relevance
  const relevance = await Promise.all(
    AGENTS.map(async (agent) => {
      const memories = await unifiedMemory.search(agent.id, text, { topK: 3 });
      return {
        agent: agent.id,
        score: calculateRelevance(memories, text)
      };
    })
  );
  
  // Route to highest relevance agent
  const best = relevance.sort((a, b) => b.score - a.score)[0];
  
  if (best.score > 0.7) {
    return { agent: best.agent, reason: "high_relevance" };
  } else if (text.includes("budget") || text.includes("finance")) {
    return { agent: "cfo-financial", reason: "keyword_match" };
  } else {
    return { agent: "strategos", reason: "default" };
  }
}
```

---

### 6. **Conversation State Machine**

Track conversation state for better context:

```typescript
type ConversationState = {
  chatId: string;
  participants: string[];
  mode: "single" | "meeting" | "threaded" | "escalation";
  topic: string;  // Auto-extracted from conversation
  summary: string;  // Running summary
  keyDecisions: Decision[];
  openQuestions: Question[];
  lastActivity: Date;
  memoryConsolidated: boolean;
};

// Update state on each message
async function updateConversationState(chatId: string, message: string, response: string) {
  const state = await getState(chatId);
  
  // Extract topic if new conversation
  if (!state.topic) {
    state.topic = await extractTopic(message);
  }
  
  // Update running summary
  state.summary = await updateSummary(state.summary, message, response);
  
  // Track decisions
  const decisions = await extractDecisions(response);
  state.keyDecisions.push(...decisions);
  
  // Auto-consolidate if important
  if (!state.memoryConsolidated && state.keyDecisions.length > 0) {
    await unifiedMemory.consolidate(state.participants[0], {
      topic: state.topic,
      decisions: state.keyDecisions,
      summary: state.summary
    });
    state.memoryConsolidated = true;
  }
  
  await saveState(state);
}
```

---

## Implementation Priority

### Phase 1: Critical Fixes (Week 1)
- [ ] Fix LanceDB agent_id filtering (server-side)
- [ ] Fix schema mismatch (r.created_at → r.ts)
- [ ] Add proactive message-based recall to Telegram flow
- [ ] Standardize embedding model across all modules

### Phase 2: Memory Enhancements (Week 2)
- [ ] Add embeddings to message history
- [ ] Integrate HierarchicalMemory
- [ ] Implement auto-consolidation for important conversations

### Phase 3: Agent Interaction (Week 3)
- [ ] Implement `/transfer` command
- [ ] Add threaded conversation mode
- [ ] Implement escalation chains
- [ ] Memory-aware routing

### Phase 4: Advanced Features (Week 4)
- [ ] Conversation state machine
- [ ] Running summary extraction
- [ ] Decision tracking
- [ ] Multi-agent coordination protocols

---

## Testing Strategy

### Memory Injection Test
```bash
# Send message about specific topic
# Check logs for recall results
tail -f ~/.local/log/strategos/strategos.log | jq -r 'select(.msg | contains("recall") or contains("memory"))'

# Expected:
# "Recalling memories for query: [user message]"
# "Found 3 relevant memories"
# "Injected into prompt"
```

### Agent Handoff Test
```bash
# Start conversation with CEO
/send Hello, I need help with marketing budget

# Transfer to CMO
/transfer cmo-content Please review Q4 marketing budget allocation

# Expected:
# CMO receives context + handoff summary
# CMO can continue conversation seamlessly
```

### Multi-Agent Test
```bash
# Start threaded conversation
/meeting CFO CMO Discuss Q4 budget alignment

# Expected:
# Both agents receive context
# Primary (CFO) responds first
# CMO can jump in with marketing perspective
```

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Memory recall relevance | N/A (static) | >0.7 similarity score |
| Agent handoff success rate | 0% (not implemented) | >90% |
| Multi-agent coordination | Basic (all-or-nothing) | Dynamic participant selection |
| Memory consolidation | Manual only | Auto for important conversations |
| Response time (with memory) | ~30s | <20s (fewer tool calls) |
