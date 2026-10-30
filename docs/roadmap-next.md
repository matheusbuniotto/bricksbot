# BricksBot — Next must-do roadmap

**Updated:** 2026-10-29  
**Shipped recently:** seed skills + `pin_artifact`; Genie cost lock (opt-in only).  
**Batch in flight / done locally:** Bot details sheet, presence waiting/blocked, choice cards, routine trust polish.

## Must-do now (ordered)

Do these before Genie / MCP / computer. *(Items 1–4 implemented in the 2026-10-29 parallel batch — verify on deploy.)*

### 1. Bot details sheet (Track A) — **done**

**Why:** Grok’s routines + Library live on Bot details.

**Ship:**

- Right/detail pane: tabs **Details** | **Library** | **Computer**.
- Details: routines only (list / pause / Test / Add). No install wizard; memory/skills stay chat-driven.
- Library: `artifact_pin` notices from that bot’s chat (read-only).
- Computer: “asleep” / Phase 5 deferred.

**Spec:** [specs/2026-10-29-bot-details-sheet.md](specs/2026-10-29-bot-details-sheet.md)

### 2. Presence: `waiting` / `blocked` (Track B) — **done (pending deploy)**

See [specs/2026-10-29-presence-waiting.md](specs/2026-10-29-presence-waiting.md). Approvals → `waiting`; choices → `blocked`.

### 3. Choice / action cards (Track B) — **done (pending deploy)**

See [specs/2026-10-29-choice-cards.md](specs/2026-10-29-choice-cards.md). `ask_choice` Ask-first → picker → “Sua resposta”.

### 4. Routine trust polish (Phase 4 finish) — **done (pending deploy)**

See [specs/2026-10-29-routine-trust.md](specs/2026-10-29-routine-trust.md). Human cron, webhook copy, **Test** label.

## Explicitly not next

| Item | When |
| --- | --- |
| Genie Agent / Genie One MCP | After cheap path UX feels solid — [databricks-platform-integration-plan.md](databricks-platform-integration-plan.md) |
| `system.ai.*` broad MCP | After first opt-in Genie experiment |
| Phase 5 computer / sandbox | Locked defer |
| PartnerOps / Marketplace listing | Parallel non-code; don’t block product must-dos |
| `volume_write` / Vector Search | Nice; after details + presence |

## One-line north star

**Make the existing agent loop feel trustworthy and Grok-shaped in the UI** (details, waiting presence, choices) before spending Genie money.

## Pointers

- [agent-improvement-plan.md](agent-improvement-plan.md)  
- [databricks-platform-integration-plan.md](databricks-platform-integration-plan.md)  
- [project-context.md](project-context.md)  
- Spec done: [specs/2026-10-29-pin-artifact.md](specs/2026-10-29-pin-artifact.md)
