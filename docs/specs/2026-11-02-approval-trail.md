# Spec: Approval trail (structured audit log)

**Date:** 2026-11-02  
**Status:** implemented  
**Roadmap:** [roadmap-next.md](../roadmap-next.md) P1 #4  
**Depends on:** existing `bricksbot.approvals` / `auto_approvals`

## Goal

Persist an **append-only** trail of Ask-first approval **requests** and **decisions** so operators can audit who allowed or denied which tool. v1 sink is Lakebase (structured log). UC Delta / MLflow export is a later Job, not this slice.

## Behavior

1. On Ask-first `create` → append event `type = 'requested'` with `chat_id`, `approval_id`, `bot_id`, `user_id` (chat owner), `tool_name`, payload (`toolCallId`, args snapshot).
2. On `decide` → append event `type = 'decided'` with same keys plus `decision` / `status` and `decided_by` (HTTP caller when known).
3. Without Lakebase (local/tests) → keep the same events in an in-memory ring on `ApprovalStore` so tests can assert.
4. Auto-run tools (meta, auto-approved, handoff auto) do **not** emit events in v1.
5. No new public UI or list API required for v1 (store method `listEvents` for tests / future admin).

## Schema

```sql
CREATE TABLE IF NOT EXISTS bricksbot.approval_events (
  id UUID PRIMARY KEY,
  chat_id UUID NOT NULL REFERENCES bricksbot.chats(id) ON DELETE CASCADE,
  approval_id UUID,
  bot_id UUID,
  user_id TEXT,
  type TEXT NOT NULL CHECK (type IN ('requested', 'decided')),
  tool_name TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bricksbot_approval_events_chat
  ON bricksbot.approval_events(chat_id, created_at DESC);
```

## Non-goals

- UC / MLflow sync Job
- Auditing every auto-executed tool
- Changing the three-way approval UX
- Deny-until-new-message (separate spec)

## Verification

```bash
npm test -- server/chat/approvals.test.ts server/chat/service.test.ts
```
