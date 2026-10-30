# Spec: Presence waiting / blocked

**Date:** 2026-10-29  
**Status:** implemented (2026-10-29)  
**Roadmap:** closed — see [roadmap-next.md](../roadmap-next.md)

## Goal

When the agent loop pauses on tool approvals, roster and server presence should show **waiting**, not **online**. **`blocked`** is used when a user choice (`ask_choice`) is pending.

## Ship checklist

- [x] Extend `Presence` with `waiting` and `blocked` (`shared/chat/types.ts`)
- [x] Lakebase `bots_presence_check` includes new values (`server/chat/schema.ts`)
- [x] `ChatService`: after a turn stops, set `waiting` when `listPending(chatId)` is non-empty; otherwise `online` (`syncBotPresenceAfterTurn` in `finally` + sibling-pending path in `decideApproval`)
- [x] While a turn runs, keep `thinking` → `working` as today
- [x] `BotFace`: distinct visuals for `waiting` / `blocked` (pulse vs muted)
- [x] `BotRoster`: tooltips (`Aguardando aprovação`), roster preview via `rosterPreviewForPresence` (`Aguardando:` prefix when waiting)
- [x] Tests: `ChatService` presence on pending approval; `user-facing` preview helpers
- [x] App header face uses `presence` + tooltip; send refreshes roster instead of forcing online
- [x] Set `blocked` from server when pending choices and no pending approvals

## Non-goals

- Genie, choice cards, `App.tsx` header tweaks
- Pin artifact, seed skills

## Verification

```bash
npm test -- server/chat/service.test.ts client/src/lib/user-facing.test.ts
```
