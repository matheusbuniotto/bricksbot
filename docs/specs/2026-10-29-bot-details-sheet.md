# Spec: Bot details sheet

**Status:** implemented (Grok-shaped UX polish 2026-10-30)  
**Date:** 2026-10-29  
**Why:** Grok-shaped bot details (routines + Library pins + Computer deferred) without Genie.

## Goal

1. **Layout:** Right/detail pane on selected bot with tabs **Details** | **Library** | **Computer**.
2. **Details:** Routines only (list / pause / Test / Add). No install wizard. Memory and skills stay chat-driven (Grok parity — no dense forms).
3. **Library:** Read-only list of `artifact_pin` system messages from the current chat transcript. Empty copy: “Pages, files, and apps this Bot makes”.
4. **Computer:** “Computer is asleep” + Phase 5 note (no computer runtime in MVP).

Out of scope: Genie, MCP, full Library editing, computer sandbox, mobile detail pane (v1), remounting MemoryPanel / InstallWizard in the sheet.

## Requirements

### `BotDetailsSheet`

- Component: `client/src/components/BotDetailsSheet.tsx`.
- Visible on `md+` as a third column beside chat; hidden on narrow viewports.
- Tab state local to the sheet; default **Details**.
- **Details:** `RoutinesPanel` filtered to `selectedBotId`; create defaults to that bot (no bot picker when single).
- **Library:** `listArtifactPinsFromMessages(messages)`; title, kind, blurb, time; newest first.
- **Computer:** asleep empty state.

### `App.tsx` wiring

- Fetch on bootstrap: `fetchRoutines`.
- Handlers: routine create/toggle/run; refresh lists after mutations.
- Render `<BotDetailsSheet />` when a bot is selected, after `<section className="chat-pane">`.

## Acceptance

- [x] Detail pane with tabs Details | Library | Computer on selected bot
- [x] Details: routines only (no InstallWizard / MemoryPanel)
- [x] Library: lists artifact pins parsed from current chat messages
- [x] Computer: asleep / Phase 5 deferred copy
- [x] Unit test: `listArtifactPinsFromMessages` (`client/src/lib/artifact-pins.test.ts`)

## Non-goals

Genie One, MCP, full Library editing, computer sandbox, memory/skills settings UI in the sheet.
