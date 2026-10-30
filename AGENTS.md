# BricksBot — Agent guide

Greenfield **Databricks App** (AppKit + TypeScript/React): Grok Bot–style Spaces, bot roster, durable chat, lakehouse tools, approvals, routines. **Not** a Rakazo fork. Phase 5 sandbox is **implemented behind `SANDBOX_BACKEND` (default `off`)** — see [`docs/specs/2026-10-30-phase5-sandbox-execution.md`](docs/specs/2026-10-30-phase5-sandbox-execution.md).

Canonical product locks: [`docs/project-context.md`](docs/project-context.md). Full plan: [`docs/databricks-grokbot-marketplace-plan.md`](docs/databricks-grokbot-marketplace-plan.md). OSS community share: [`docs/oss-community-release.md`](docs/oss-community-release.md).

## Intent

- Ship a workspace-installable App that chats against OpenAI-compatible LLMs (OpenRouter) or Databricks Serving.
- Tools are lakehouse-native (`sql_query`, `lakehouse_catalog`, `volume_read`, `web_fetch`, `handoff_to_bot`, `create_bot`) plus routines CRUD (`list_routines`, `schedule_routine`, `update_routine`, `delete_routine`) with **3-way approvals**, and Pi skill/memory meta tools (`activate_skill`, `read_skill_resource`, `list_memories`, `remember`, `forget`, `save_skill`).
- Durable state lives in **Lakebase** schema `bricksbot` (memory store for local/tests).
- Capability discovery is Pi-shaped: `buildCapabilityCatalog` / `formatCapabilityPrompt` in `shared/agents/capability-catalog.ts` (register new tools in the `ChatService` constructor, not ad-hoc prompt `if`s).
- Built-in seed skills live in `shared/agents/seed-skills.ts` and merge via `mergeEffectiveSkills` (bot `save_skill` overrides same name). Agent improvement plan: `docs/agent-improvement-plan.md`.
- **Genie / Ontology / `system.ai` MCP:** go slow — cheap lakehouse tools stay default; Genie is opt-in (cost). Plan: `docs/databricks-platform-integration-plan.md`. Do not register Genie as always-on or “prefer Genie for most questions.”
- **Next must-do order:** `docs/roadmap-next.md` → OSS community share first (`docs/oss-community-release.md`: license, self-contained install, README). UI trust batch (details / waiting / choices / routine trust) is shipped.
- Default meta tools (`DEFAULT_META_TOOL_NAMES` in `shared/agents/meta-tools.ts`) are on for **every** bot; `handoff_to_bot` and `create_bot` are Primary-only. Meta tools auto-run (no Ask-first). `list_routines` also auto-runs. `create_bot` and `delete_routine` are always Ask-first (never “Always allow”). `pin_artifact`, `ask_choice`, `schedule_routine`, and `update_routine` are Ask-first for all bots (`ask_choice` never “Always allow”).
- Sandbox tools (`python_exec`, `sandbox_exec`, upload/download/save_artifact) register only when `SANDBOX_BACKEND` is `databricks` | `python_exec` | `e2b`. Ask-first (except `sandbox_stop` auto); `sandbox_delete` never “Always allow”. Handoff `autoApproveAll` does **not** bypass Ask-first sandbox tools.

## Layout

| Path | Role |
|------|------|
| `client/` | React UI (roster, transcript, composer, approvals, routines, wizard) |
| `server/` | Express/AppKit API + agent loop |
| `server/chat/` | `ChatService`, approvals, Lakebase/memory stores, schema |
| `server/durable/` | Compaction, idempotency (Pi-compatible thin harness) |
| `server/agents/` | Agent domain: `clients/` (LLM chat clients), `tools/` (lakehouse + Pi meta tools), `memory/` (per-bot memories & skills), `handoff.ts` (Primary → teammate) |
| `server/routines/` | Cron/webhook routines |
| `server/sandbox/` | Phase 5 execution backends, session service, reaper, artifact sync |
| `shared/` | Domain types shared by client + server (`chat`, `agents` incl. `agents/memory`, `routines`, `durable`, `sandbox`) |
| `databricks.yml` / `app.yaml` | Bundle + App runtime env |
| `scripts/` | Deploy/setup helper scripts |
| `skills/` | Standalone agent skills (outside the app runtime) |
| `.cursor/rules/` | Always-on agent rules |

## Domains (vocabulary)

- **Space** — folder of bots; membership roles; Personal space on bootstrap.
- **Bot** — named agent; one is **Primary** (router + `handoff_to_bot`); presence includes thinking/working/waiting/blocked.
- **Chat** — one chat per bot; messages: `user` \| `assistant` \| `system` \| `tool`.
- **Tool call replay** — assistant rows must store `toolCalls`; tool rows need matching `toolCallId`. Never send orphan tool results to the LLM.
- **Handoff** — Primary `handoff_to_bot` runs the teammate one turn (most tools auto-approved; sandbox Ask-first tools still need approval), relays the reply, and posts a tight “N messages with …” chip on both chats (click → peek).
- **Approval** — `all_the_time` / `once` / `not_approved`; auto-approve is per chat+tool name.
- **ChatClient** — `openai-compatible` (primary) → `databricks-serving` → `stub` if no key.
- **Routine** — scheduled/webhook prompt into a bot chat.
- **Sandbox** — optional isolated Linux exec per chat (`SANDBOX_BACKEND`); Lakebase session/events; artifacts sync to UC Volumes.

## Commands

```bash
npm run dev          # local (port 8000)
npm test             # vitest
npm run build        # server + client
databricks bundle validate -p dev
databricks bundle deploy -p dev && databricks bundle run app -p dev
```

App URL after deploy: `databricks apps get bricksbot -p dev`. Profile: `dev`.

## Agent conventions

- Prefer small, domain-aligned changes; keep types in `shared/`, logic in `server/`, UI in `client/`.
- Do not use models with `fast` in the id (see `.cursor/rules/no-fast-models.mdc`).
- Agent loop is a **thin Pi-compatible harness** (see `docs/durable-harness.md`): compaction never deletes transcript; skills index + `activate_skill` / `read_skill_resource`; `remember` / `forget` / `list_memories` / `save_skill`; durable approvals; `requestId` idempotency. Do not embed `@earendil-works/pi-durable` without a Lakebase adapter. No CodingTools / `run_skill_script` / desktop UI (Phase 5 is exec sandbox only).
- LLM history must stay OpenAI-valid: assistant `tool_calls` **before** matching `tool` messages; wait for all sibling approvals before the next completion.
- Secrets: scope `claw` / `openrouter-api-key`; optional `bricksbot` / `web-fetch-allowlist`. Never invent secret values.
- Desktop/browser “computer” UI stays out of scope; sandbox exec is opt-in via `SANDBOX_BACKEND`.
