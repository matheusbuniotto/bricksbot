# BricksBot — Next must-do roadmap

**Updated:** 2026-10-29  
**Shipped recently:** seed skills + `pin_artifact` (`5543880`); Genie cost lock (opt-in only).

## Must-do now (ordered)

Do these before Genie / MCP / computer.

### 1. Bot details sheet (Track A) — **next sprint**

**Why:** Grok’s routines + Biblioteca live on Bot details; we already have `RoutinesPanel`, `MemoryPanel`, `InstallWizard`, and pin chips — but they are **not mounted** in `App.tsx`.

**Ship:**

- Right/detail pane on selected Bot: tabs **Detalhes** | **Biblioteca** | Computador (empty / deferred copy).
- Detalhes: mount routines (list / pause / run) + light memory/skills list (or chat-only memory note).
- Biblioteca: list `artifact_pin` notices from that bot’s chat (read-only from transcript for v1).
- Wire `InstallWizard` when provider is stub.

**Spec to write:** `docs/specs/YYYY-MM-DD-bot-details-sheet.md`

### 2. Presence: `waiting` / `blocked` (Track B)

**Why:** Approvals already pause the loop; roster still looks “online,” so the app feels stuck.

**Ship:**

- Extend `Presence` with `waiting` (pending approval or choice) and `blocked` (needs user text).
- Set from `ChatService` when approvals pending; clear on decide / continue.
- Roster + header face treat `waiting`/`blocked` distinctly (tooltip = current tool or “needs you”).
- Optional: roster preview prefix `Rascunho:` / `Aguardando:` when pending.

### 3. Choice / action cards (Track B)

**Why:** Grok’s biggest non-tool trust loop; we only have tool approvals today.

**Ship:**

- Tool or message type: agent poses options → user picks → durable transcript row (“Sua resposta”).
- Blocks turn like Ask-first; no Always-allow for destructive choices without typed confirm later.

### 4. Routine trust polish (Phase 4 finish)

**Why:** Cron is stored; Job wiring is manual; Grok-level Test/history missing.

**Ship:**

- Routine detail: human schedule copy, webhook URL/key copy, **Run now** (exists) labeled as Test.
- Doc or stub Job YAML filled for one real App URL (ops, not product Genie).

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
