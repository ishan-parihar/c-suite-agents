# Organic Operations Model: Human-Like Agent Behavior

## Core Philosophy

Instead of hardcoding operational workflows (e.g., "board meeting every Monday 9 AM"), agents behave like **human employees** who:

1. **Initiate discussions** when they see issues
2. **Call meetings** when consensus emerges
3. **Hire their own teams** to delegate work
4. **Have visibility** into their reports' work
5. **Escalate organically** based on judgment

---

## Organic Behaviors

### 1. Inter-Agent Discussions

Any agent can initiate a discussion with any other agent:

```
CFO → CEO: "I notice we're overspending on content campaigns. Should we discuss budget reallocation?"
CEO → CMO: "CFO flagged budget concerns. Can we review campaign ROI?"
CMO → CFO: "Let me share the engagement metrics. High ROI on LinkedIn, low on Twitter."
CFO → CMO + CEO: "Thanks for the data. I recommend pausing Twitter spend."
```

**Implementation:**
- `message.send({to, content, priority, requires_response})` — Agent-to-agent messaging
- `message.thread({thread_id})` — View conversation thread
- `message.escalate({to, thread_id, reason})` — Escalate discussion to superior

---

### 2. Organic Board Meetings

Any agent can **propose a board meeting** when they identify an issue requiring collective decision:

```
CFO proposes: "Board meeting needed: Q3 budget reallocation"
Reason: "Content spend 40% over budget, but ROI varies significantly by platform"

Voting:
- CEO: ✅ Yes (strategic impact)
- COO: ✅ Yes (resource allocation)
- CPO: ❌ No (not mental health related)
- CRO: ✅ Yes (affects contractor relationships)
- CMO: ✅ Yes (directly impacts campaigns)
- Physician: ❌ No (not health related)

Result: 4/7 = Majority → Meeting scheduled
```

**Implementation:**
- `meeting.propose({title, reason, urgency, required_attendees})` — Propose meeting
- `meeting.vote({meeting_id, vote: 'yes'|'no'|'abstain'})` — Vote on relevance
- `meeting.schedule({meeting_id, time})` — Auto-schedule if majority agrees
- `meeting.minutes({meeting_id, decisions, action_items})` — Store outcomes

**Voting Thresholds:**
| Urgency | Votes Required | Response Time |
|---------|---------------|---------------|
| Critical (P1) | 3/7 (any 3 board members) | 1 hour |
| High (P2) | 4/7 (majority) | 24 hours |
| Normal (P3) | 5/7 (supermajority) | 72 hours |
| Low (P4) | 6/7 (near-unanimous) | 1 week |

---

### 3. Hiring & Delegation

Each core staff member can **hire their own auxiliary staff** to delegate work:

```
CMO hires:
- content-writer-1 (contracts, blog posts)
- video-editor-1 (contracts, video production)
- social-media-manager-1 (contracts, platform management)

CFO hires:
- bookkeeper-1 (contracts, transaction categorization)
- financial-analyst-1 (contracts, monthly reports)

COO hires:
- productivity-coach-1 (contracts, habit tracking)
- operations-assistant-1 (contracts, task management)
```

**Implementation:**
- `hire.create({role, reports_to, budget, tasks})` — Hire auxiliary staff
- `hire.fire({agent_id, reason})` — Fire auxiliary staff
- `delegate.to({to, task, deadline, priority})` — Delegate task to report
- `delegate.status({task_id})` — Check delegated task progress

**Hierarchy:**
```
CEO (strategos)
├─ COO (coo-productivity)
│  ├─ productivity-coach-1 (hired by COO)
│  └─ operations-assistant-1 (hired by COO)
├─ CMO (cmo-content)
│  ├─ content-writer-1 (hired by CMO)
│  ├─ video-editor-1 (hired by CMO)
│  └─ social-media-manager-1 (hired by CMO)
├─ CFO (cfo-financial)
│  ├─ bookkeeper-1 (hired by CFO)
│  └─ financial-analyst-1 (hired by CFO)
...
```

---

### 4. Kanban Visibility Hierarchy

Superiors have **full visibility** into their reports' Kanban boards:

```
CMO's View:
┌─────────────────────────────────────────────────┐
│ MY BOARD (CMO)                                  │
│ Backlog → Writing → Editing → Ready → Published │
│ ─────────────────────────────────────────────── │
│ ▼ content-writer-1's Board                      │
│   Backlog → Drafting → Review → Done            │
│   • Blog post: "AI Trends" (In Review)          │
│   • Case study: "Strategos" (Drafting)          │
│ ▼ video-editor-1's Board                        │
│   Backlog → Editing → Rendering → Complete      │
│   • Video: "Product Demo" (Rendering)           │
└─────────────────────────────────────────────────┘

CMO can:
- Reassign tasks between reports
- Escalate blocked items to CEO
- Review quality before publication
- Adjust priorities across team
```

**Implementation:**
- `kanban.view({agent_id})` — View own board
- `kanban.view_reports({manager_id})` — Manager views all reports' boards
- `kanban.reassign({card_id, from, to})` — Manager reassigns task
- `kanban.escalate({card_id, to, reason})` — Escalate to superior

---

## Implementation Architecture

### Core Systems

| System | Purpose | Key Functions |
|--------|---------|---------------|
| **Messaging** | Agent-to-agent communication | `message.send()`, `message.thread()`, `message.escalate()` |
| **Meeting Governance** | Organic meeting scheduling | `meeting.propose()`, `meeting.vote()`, `meeting.schedule()` |
| **Hiring/Delegation** | Team building | `hire.create()`, `hire.fire()`, `delegate.to()` |
| **Kanban Hierarchy** | Management visibility | `kanban.view_reports()`, `kanban.reassign()` |
| **Voting/Consensus** | Collective decisions | `vote.on()`, `vote.tally()`, `consensus.reached()` |

### Database Extensions

| New Database | Purpose |
|--------------|---------|
| `messages` | Agent-to-agent message threads |
| `meeting_proposals` | Meeting requests with voting |
| `meeting_minutes` | Decisions and action items |
| `employment_contracts` | Auxiliary staff hiring records |
| `delegations` | Task delegation tracking |
| `reporting_lines` | Manager-report relationships |

### Voting Logic

```typescript
async function proposeBoardMeeting(proposer: string, title: string, reason: string, urgency: 'P1'|'P2'|'P3'|'P4') {
  const proposal = await db.meeting_proposals.create({
    proposer, title, reason, urgency,
    status: 'voting',
    votes: {},
    created_at: Date.now()
  });
  
  // Notify all board members
  const boardMembers = getBoardMembers();
  for (const member of boardMembers) {
    await message.send({
      to: member.id,
      from: 'system',
      content: `Board meeting proposed: ${title}\nReason: ${reason}\nVote yes/no within ${getDeadline(urgency)}`
    });
  }
  
  return proposal;
}

async function voteOnMeeting(meeting_id: string, voter: string, vote: 'yes'|'no'|'abstain') {
  const proposal = await db.meeting_proposals.get(meeting_id);
  proposal.votes[voter] = vote;
  await db.meeting_proposals.update(meeting_id, proposal);
  
  // Check if threshold reached
  const yesVotes = Object.values(proposal.votes).filter(v => v === 'yes').length;
  const threshold = getThreshold(proposal.urgency);
  
  if (yesVotes >= threshold) {
    await meeting.schedule({ meeting_id, time: getNextAvailableSlot() });
    return { status: 'scheduled', votes: proposal.votes };
  }
  
  // Check if voting period expired
  if (isVotingPeriodExpired(proposal)) {
    await db.meeting_proposals.update(meeting_id, { status: 'rejected' });
    return { status: 'rejected', votes: proposal.votes };
  }
  
  return { status: 'voting', votes: proposal.votes };
}
```

---

## Agent Behavior Patterns

### Proactive Behaviors

| Trigger | Agent Response |
|---------|---------------|
| Budget overrun >20% | CFO → CEO: "Budget concern, should we call board meeting?" |
| Task stalled >4h | Manager → Report: "Task blocked? Need help?" |
| Quality issue detected | Manager → Report: "Please revise X before publishing" |
| Relationship neglected | CRO → Self: "Schedule reconnect with X" |
| Mental health decline | CPO → CEO: "Wellness concern, recommend workload adjustment" |

### Reactive Behaviors

| Incoming Message | Agent Response |
|-----------------|---------------|
| Meeting proposal (P1) | Vote within 1 hour |
| Meeting proposal (P2) | Vote within 24 hours |
| Task delegation | Accept and add to Kanban |
| Escalation from report | Review and decide (resolve/escalate further) |
| Peer discussion request | Respond within 4 hours |

---

## Implementation Phases

### Phase 3A: Organic Messaging
- `message.send()` — Agent-to-agent messaging
- `message.thread()` — View conversation history
- `message.escalate()` — Escalate to superior
- Notification system for new messages

### Phase 3B: Meeting Governance
- `meeting.propose()` — Propose board meeting
- `meeting.vote()` — Vote on relevance
- `meeting.schedule()` — Auto-schedule if majority agrees
- `meeting.minutes()` — Store outcomes to company memory

### Phase 3C: Hiring & Delegation
- `hire.create()` — Hire auxiliary staff
- `hire.fire()` — Release contractors
- `delegate.to()` — Delegate tasks
- `delegate.status()` — Track progress

### Phase 3D: Kanban Hierarchy
- `kanban.view_reports()` — Manager visibility
- `kanban.reassign()` — Task reassignment
- `kanban.escalate()` — Escalation workflow
- Trajectory alignment dashboards

---

## Key Design Principles

1. **No Hardcoded Schedules** — Meetings happen when needed, not on fixed schedule
2. **Consensus-Driven** — Board meetings require majority agreement on relevance
3. **Distributed Authority** — Each core staff can build their own team
4. **Transparent Visibility** — Managers see reports' work, not micromanage
5. **Organic Escalation** — Issues flow up naturally based on judgment
6. **Memory of Interactions** — All discussions, decisions stored for future reference

---

## Next Steps

1. Implement messaging system (Phase 3A)
2. Implement meeting governance (Phase 3B)
3. Implement hiring/delegation (Phase 3C)
4. Implement Kanban hierarchy (Phase 3D)
5. Test organic behaviors end-to-end
