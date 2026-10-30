# Spec: `pin_artifact` tool + `pin-finding` seed skill

**Status:** ready to implement  
**Date:** 2026-10-29  
**Why:** Grok Biblioteca / Track F artifact MVP without Genie (cost lock). Give bots a durable way to pin lakehouse findings; teach when via a seed skill.

## Goal

1. **Tooling:** `pin_artifact` — Ask-first tool every bot can use to pin a short finding (title + kind + body or Volume path) onto the bot’s chat as a durable system/artifact notice.
2. **Skill:** built-in seed `pin-finding` — Grok 6-part contract; when to pin vs remember; never pin secrets.

Out of scope: Genie, MCP, full Biblioteca UI panel, Volume write of large blobs, choice cards.

## Requirements

### Tool `pin_artifact`

- Registered in `ChatService` for all bots (not Primary-only).
- **Ask-first** (not a default meta tool; not auto-approved).
- Args: `title` (string, required), `kind` (`note` | `sql` | `volume_path` | `link`, required), `body` (string, required — short markdown or path/URL), optional `summary` (one-line roster/transcript preview).
- Persist: append a **system** message to the current chat with a stable JSON envelope (parseable like handoff/bot_created notices), e.g. `{ "kind": "artifact_pin", "title", "artifactKind", "body", "summary?", "pinnedByBotId", "pinnedByName" }`.
- Shared helper: `shared/chat/artifact-pin-notice.ts` with `serialize` / `parse` (mirror handoff-notice style).
- Return JSON `{ ok, title, kind, messageId? }` for the model.
- Soft limit in capability catalog: pins are short; no secrets; prefer Volume path for large content.
- Client: show a compact chip/block in transcript when `parse` succeeds (minimal — reuse system-row styling if easier than a new component).

### Seed skill `pin-finding`

- Add to `SEED_SKILLS` in `shared/agents/seed-skills.ts`.
- Body: When / inputs / steps / validate / return / approvals — pin after a successful explore; use `remember` for lasting rules; use `pin_artifact` for shareable findings; Ask-first on pin.

### Prompt

- `formatCapabilityPrompt`: one line that `pin_artifact` exists when registered; prefer pin for findings, remember for rules.

## Acceptance

- [x] Unit tests: serialize/parse notice; tool execute writes system message; seed activates via `activate_skill`
- [x] Catalog lists tool + seed skill
- [x] `npm test` passes for touched files
- [x] No Genie / MCP changes

## Non-goals

Genie One, Ontology, Biblioteca side panel chrome, Always-allow for pins by default.
