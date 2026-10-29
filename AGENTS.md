# BricksBot — Agent guide

Greenfield **Databricks App** (AppKit + TypeScript/React): Grok Bot–style Spaces, bot roster, durable chat, lakehouse tools, approvals, routines. **Not** a Rakazo fork. **No computer/sandbox** in MVP (Phase 5 later).

Canonical product locks: [`docs/project-context.md`](docs/project-context.md). Full plan: [`docs/databricks-grokbot-marketplace-plan.md`](docs/databricks-grokbot-marketplace-plan.md).

## Intent

- Ship a workspace-installable App that chats against OpenAI-compatible LLMs (OpenRouter) or Databricks Serving.
- Tools are lakehouse-native (`sql_query`, `lakehouse_catalog`, `volume_read`, `web_fetch`, `handoff_to_bot`) with **3-way approvals**, plus Pi skill/memory meta tools (`activate_skill`, `read_skill_resource`, `list_memories`, `remember`, `forget`, `save_skill`).
- Durable state lives in **Lakebase** schema `bricksbot` (memory store for local/tests).
- Capability discovery is Pi-shaped: `buildCapabilityCatalog` / `formatCapabilityPrompt` in `shared/llm/capability-catalog.ts` (register new tools in the `ChatService` constructor, not ad-hoc prompt `if`s).
- Default meta tools (`DEFAULT_META_TOOL_NAMES` in `shared/llm/meta-tools.ts`) are on for **every** bot; only `handoff_to_bot` is Primary-only. Meta tools auto-run (no Ask-first).

## Layout

| Path | Role |
|------|------|
| `client/` | React UI (roster, transcript, composer, approvals, routines, wizard) |
| `server/` | Express/AppKit API + agent loop |
| `server/chat/` | `ChatService`, approvals, Lakebase/memory stores, schema |
| `server/durable/` | Compaction, idempotency (Pi-compatible thin harness) |
| `server/llm/` | Chat clients + tools under `tools/` |
| `server/bots/` | Primary → teammate handoff |
| `server/memory/` | Per-bot memories & skills |
| `server/routines/` | Cron/webhook routines |
| `shared/` | Domain types shared by client + server (`chat`, `llm`, `memory`, `routines`, `durable`) |
| `databricks.yml` / `app.yaml` | Bundle + App runtime env |
| `.cursor/rules/` | Always-on agent rules |

## Domains (vocabulary)

- **Space** — folder of bots; membership roles; Personal space on bootstrap.
- **Bot** — named agent; one is **Primary** (router + `handoff_to_bot`); presence includes thinking/working.
- **Chat** — one chat per bot; messages: `user` \| `assistant` \| `system` \| `tool`.
- **Tool call replay** — assistant rows must store `toolCalls`; tool rows need matching `toolCallId`. Never send orphan tool results to the LLM.
- **Handoff** — Primary `handoff_to_bot` runs the teammate one turn (tools auto-approved), relays the reply, and posts a tight “N messages with …” chip on both chats (click → peek).
- **Approval** — `all_the_time` / `once` / `not_approved`; auto-approve is per chat+tool name.
- **ChatClient** — `openai-compatible` (primary) → `databricks-serving` → `stub` if no key.
- **Routine** — scheduled/webhook prompt into a bot chat.

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
- Agent loop is a **thin Pi-compatible harness** (see `docs/durable-harness.md`): compaction never deletes transcript; skills index + `activate_skill` / `read_skill_resource`; `remember` / `forget` / `list_memories` / `save_skill`; durable approvals; `requestId` idempotency. Do not embed `@earendil-works/pi-durable` without a Lakebase adapter. No CodingTools / `run_skill_script` until Phase 5.
- LLM history must stay OpenAI-valid: assistant `tool_calls` **before** matching `tool` messages; wait for all sibling approvals before the next completion.
- Secrets: scope `claw` / `openrouter-api-key`; optional `bricksbot` / `web-fetch-allowlist`. Never invent secret values.
- Computer/desktop runtime is explicitly out of scope until Phase 5.
