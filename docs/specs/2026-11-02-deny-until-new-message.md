# Spec: Deny-until-new-message

**Date:** 2026-11-02  
**Status:** implemented  
**Roadmap:** [roadmap-next.md](../roadmap-next.md) P1 #3 · Track B trust  
**Depends on:** [2026-10-29-presence-waiting.md](2026-10-29-presence-waiting.md)

## Goal

After the user **denies** a tool approval, BricksBot must **not** call the model again until the user sends a **new** message. Denial still writes a matching tool-error row so OpenAI replay stays valid.

## Behavior

1. User denies (`denied` / `not_approved`) → write tool message `{ error: 'User denied tool call', tool }` for that `toolCallId`.
2. If sibling approvals (or choices) are still pending → stay paused (`waiting` / `blocked`); do not continue.
3. When the wave clears and **any** denial happened in this chat since the last user message → return pause snapshot **without** `continueTurn`. Presence → `online` (no pending cards). Composer is free.
4. Next `sendUserMessage` clears the deny-pause flag and runs `continueTurn` as usual (history already includes denial tool rows).
5. Approving with no denials in the wave still auto-continues (unchanged).

## Non-goals

- New presence value for “denied”
- Auto Review lite
- Changing Always-allow / sibling Always wave behavior
- UI copy beyond existing “Not approve”

## Verification

```bash
npm test -- server/chat/service.test.ts
```
