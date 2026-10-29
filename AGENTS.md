# BricksBot — Agent guide

Greenfield **Databricks App** (AppKit + TypeScript/React): Grok Bot–style Spaces, bot roster, durable chat, lakehouse tools, approvals, routines. **Not** a Rakazo fork. **No computer/sandbox** in MVP (Phase 5 later).

Canonical product locks: [`docs/project-context.md`](docs/project-context.md). Full plan: [`docs/databricks-grokbot-marketplace-plan.md`](docs/databricks-grokbot-marketplace-plan.md).

## Intent

- Ship a workspace-installable App that chats against OpenAI-compatible LLMs (OpenRouter) or Databricks Serving.
- Tools are lakehouse-native (`sql_query`, `lakehouse_catalog`, `volume_read`, `web_fetch`, `handoff_to_bot`) with **3-way approvals**.
- Durable state lives in **Lakebase** schema `bricksbot` (memory store for local/tests).

## Layout

| Path | Role |
|------|------|
| `client/` | React UI (roster, transcript, composer, approvals, routines, wizard) |
| `server/` | Express/AppKit API + agent loop |
| `server/chat/` | `ChatService`, approvals, Lakebase/memory stores, schema |
| `server/llm/` | Chat clients + tools under `tools/` |
| `server/bots/` | Primary → teammate handoff |
| `server/memory/` | Per-bot memories & skills |
| `server/routines/` | Cron/webhook routines |
| `shared/` | Domain types shared by client + server (`chat`, `llm`, `memory`, `routines`) |
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
- LLM history must stay OpenAI-valid: assistant `tool_calls` **before** matching `tool` messages; wait for all sibling approvals before the next completion.
- Secrets: scope `claw` / `openrouter-api-key`; optional `bricksbot` / `web-fetch-allowlist`. Never invent secret values.
- Computer/desktop runtime is explicitly out of scope until Phase 5.
