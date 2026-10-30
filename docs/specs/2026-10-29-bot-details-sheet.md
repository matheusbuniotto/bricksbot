# Spec: Bot details sheet

**Status:** implemented  
**Date:** 2026-10-29  
**Why:** Grok-shaped bot details (routines, memory/skills, Biblioteca pins) without Genie. Panels already existed but were not mounted in `App.tsx`.

## Goal

1. **Layout:** Right/detail pane on selected bot with tabs **Detalhes** | **Biblioteca** | **Computador**.
2. **Detalhes:** `InstallWizard` (from `GET /api/setup/status`), `RoutinesPanel`, `MemoryPanel` for the selected bot.
3. **Biblioteca:** Read-only list of `artifact_pin` system messages from the current chat transcript.
4. **Computador:** Deferred Phase 5 copy (no computer runtime in MVP).

Out of scope: Genie, MCP, presence `waiting`/`blocked`, choice cards, server loop changes.

## Requirements

### `BotDetailsSheet`

- New component: `client/src/components/BotDetailsSheet.tsx`.
- Visible on `md+` as a third column beside chat; hidden on narrow viewports to preserve chat space.
- Tab state local to the sheet; default **Detalhes**.
- **Detalhes:** embed existing panels; routines filtered to `selectedBotId`; routine create defaults to that bot only.
- **Biblioteca:** `listArtifactPinsFromMessages(messages)` using `parseArtifactPinNotice`; show title, kind label, summary/body snippet; newest first.
- **Computador:** short “Phase 5” message.

### `App.tsx` wiring

- Fetch on bootstrap: `fetchSetupStatus`, `fetchRoutines`.
- On bot select / chat reload: `fetchMemories`, `fetchSkills` for that bot.
- Handlers: routine create/toggle/run, memory upsert, skill create/delete; refresh lists after mutations.
- `InstallWizard` dismiss persisted in `localStorage` (`bricksbot-install-wizard-dismissed`).
- Render `<BotDetailsSheet />` when a bot is selected, after `<section className="chat-pane">`.

### APIs (existing)

- `GET /api/setup/status` — `fetchSetupStatus` in `client/src/lib/routines-api.ts`
- Routines — `client/src/lib/routines-api.ts`
- Memory/skills — `client/src/lib/memory-api.ts`

## Acceptance

- [x] Detail pane with tabs Detalhes | Biblioteca | Computador on selected bot
- [x] Detalhes: RoutinesPanel + MemoryPanel + InstallWizard wired to APIs
- [x] Biblioteca: lists artifact pins parsed from current chat messages
- [x] Computador: Phase 5 deferred copy
- [x] InstallWizard when setup status loads (stub LLM shows secret hints via `needsLlmSetup`)
- [x] Unit test: `listArtifactPinsFromMessages` (`client/src/lib/artifact-pins.test.ts`)
- [x] No server / Genie / presence / pin-artifact server changes in this track
- [x] `npm test` passes for new client test

## Non-goals

Genie One, MCP, full Biblioteca editing, computer sandbox, mobile detail pane (v1).
