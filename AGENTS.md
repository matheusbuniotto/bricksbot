# BricksBot: Agent guide

Greenfield **Databricks App** (AppKit + TypeScript/React): Grok Bot-style Spaces, bot roster, durable chat, lakehouse tools, approvals, routines. **Not** a Rakazo fork. Phase 5 sandbox defaults to **`SANDBOX_BACKEND=databricks`** in `app.yaml` (falls back to `python_exec` if Sandboxes preview is off; set `off` to disable), see [`docs/specs/2026-10-30-phase5-sandbox-execution.md`](docs/specs/2026-10-30-phase5-sandbox-execution.md).

Canonical product locks: [`docs/project-context.md`](docs/project-context.md). Full plan: [`docs/databricks-grokbot-marketplace-plan.md`](docs/databricks-grokbot-marketplace-plan.md). OSS community share: [`docs/oss-community-release.md`](docs/oss-community-release.md).

## Intent

- Ship a workspace-installable App that chats against OpenAI-compatible LLMs (OpenRouter) or Databricks Serving.
- Tools are lakehouse-native (`sql_query`, `lakehouse_catalog`, `volume_read`, `volume_write` when `BRICKSBOT_VOLUME_ROOT` is set, `web_fetch`, `handoff_to_bot`, `create_bot`) plus routines CRUD (`list_routines`, `schedule_routine`, `update_routine`, `delete_routine`) with **3-way approvals**, `read_attachment` (when attachments are on), and Pi skill/memory meta tools (`activate_skill`, `read_skill_resource`, `list_memories`, `remember`, `forget`, `save_skill`).
- Durable state lives in **Lakebase** schema `bricksbot` (memory store for local/tests); audit and usage go in schema `bricksbot_audit` once it lands (v2 design F4), so CDF exports only those.
- Capability discovery is Pi-shaped: `buildCapabilityCatalog` / `formatCapabilityPrompt` in `shared/agents/capability-catalog.ts` (register new tools in the `ChatService` constructor, not ad-hoc prompt `if`s).
- Built-in seed skills live in `shared/agents/seed-skills.ts` and merge via `mergeEffectiveSkills` (bot `save_skill` overrides same name). Agent improvement plan: `docs/agent-improvement-plan.md`.
- **Genie / Ontology / `system.ai` MCP:** go slow, cheap lakehouse tools stay default; Genie is opt-in (cost). Plan: `docs/databricks-platform-integration-plan.md`. Do not register Genie as always-on or "prefer Genie for most questions." The one exception that ships is opt-in `ask_genie_space` (single space, registered only when `BRICKSBOT_GENIE_SPACE_ID` is set; Ask-first, never "Always allow", not bypassed by handoff `autoApproveAll`; `BRICKSBOT_GENIE_ENABLED=false` kills it, `BRICKSBOT_GENIE_DAILY_CALLS` caps it per user).
- **Next must-do order:** `docs/roadmap-next.md` → OSS community share first (`docs/oss-community-release.md`: license, self-contained install, README). UI trust batch (details / waiting / choices / routine trust) is shipped.
- Default meta tools (`DEFAULT_META_TOOL_NAMES` in `shared/agents/meta-tools.ts`) are on for **every** bot; `handoff_to_bot` and `create_bot` are Primary-only. Meta tools auto-run (no Ask-first). `list_routines` and `read_attachment` (the user's own CSV/TSV in this chat, refused on routine turns) also auto-run. `create_bot` and `delete_routine` are always Ask-first (never "Always allow"). `pin_artifact`, `ask_choice`, `schedule_routine`, `update_routine`, and `volume_write` are Ask-first for all bots (`ask_choice` never "Always allow"). `volume_write` is off on routine turns.
- Sandbox tools (`python_exec`, `sandbox_exec`, upload/download/save_artifact) register only when `SANDBOX_BACKEND` is `databricks` | `python_exec` | `e2b`. Ask-first (except `sandbox_stop` auto); `sandbox_delete` never "Always allow". Handoff `autoApproveAll` does **not** bypass Ask-first sandbox tools or `volume_write`.

## Layout

| Path | Role |
|------|------|
| `client/` | React UI (roster, transcript, composer, approvals, routines, wizard) |
| `server/` | Express/AppKit API + agent loop |
| `server/chat/` | `ChatService`, approvals, Lakebase/memory stores, schema |
| `server/durable/` | Compaction, idempotency (Pi-compatible thin harness) |
| `server/agents/` | Agent domain: `clients/` (LLM chat clients), `tools/` (lakehouse + Pi meta tools), `memory/` (per-bot memories & skills), `handoff.ts` (Primary → teammate) |
| `server/runs/` | Run model: run store (Lakebase/memory), leases, sweeper, Stop, SSE feed (`sse.ts`) |
| `server/routines/` | Cron/webhook routines |
| `server/usage/` | LLM usage ledger: `MeteredChatClient` records every call (turns, compaction) in `bricksbot_audit.llm_usage` + `bricksbot.usage_daily`, charged to the caller. `BudgetService` (`BRICKSBOT_BUDGET_*_USD` caps + per-person limits in `bricksbot.budgets`) is checked before every model call and compaction; a block writes an assistant notice and makes no call. Usage routes: `/api/usage/me`, `/api/bots/:id/usage`, `/api/routines/:id/usage` (counts and money only). Model catalog (`BRICKSBOT_MODELS`) lives in `server/agents/models.ts` |
| `server/sandbox/` | Phase 5 execution backends, session service, reaper, artifact sync |
| `shared/` | Domain types shared by client + server (`chat`, `agents` incl. `agents/memory`, `routines`, `durable`, `sandbox`) |
| `databricks.yml` / `app.yaml` | Bundle + App runtime env |
| `scripts/` | Deploy/setup helper scripts |
| `skills/` | Standalone agent skills (outside the app runtime) |
| `.cursor/rules/` | Always-on agent rules |

## Domains (vocabulary)

- **Space.** Folder of bots; Personal space on bootstrap. Roles: `viewer` sees shared bots, `member` also chats/approves/schedules with them, `admin` also manages members. Bot owners keep full control; only owners may `save_skill`. Members can leave; owners/admins remove others. Access is re-checked on every turn (`requireBotUse`, `canUseBot`), so unsharing or removal cuts off existing chats and routines.
- **Bot.** Named agent; one is **Primary** (router + `handoff_to_bot`); presence (thinking/waiting/blocked) is derived per caller from their chats' latest runs, never stored per bot.
- **Chat.** Many chats per (bot, user), each with a `kind`: `user` (opened by people; `GET /api/bots/:botId/chat` is an alias for the latest active one), `routine` (one per routine) or `handoff` (one per teammate and caller). Archived chats leave the list and search; the UI links chats at `#/bots/:botId/chats/:chatId` and searches them with Cmd/Ctrl-K (`GET /api/search`, own chats only). Messages: `user` \| `assistant` \| `system` \| `tool`.
- **Tool call replay.** Assistant rows must store `toolCalls`; tool rows need matching `toolCallId`. Never send orphan tool results to the LLM.
- **Handoff.** Primary `handoff_to_bot` runs the teammate one turn (most tools auto-approved; sandbox Ask-first tools still need approval), relays the reply (the brief and reply live in the teammate's `handoff` chat, not the chat the user opens), and posts a tight "N messages with …" chip on both chats (click → peek).
- **Run.** One stretch of agent work (a send, or a resume after an approval/choice); one running run per chat (409 `{activeRunId}` otherwise), events in `run_events`, Stop via `POST /api/chats/:chatId/runs/:runId/stop`, live feed via `GET .../runs/:runId/events` (SSE; the UI sends `async:true` and follows it). `RunContext` replaces the old routine flag. Lives in `server/runs/`.
- **Approval.** `all_the_time` / `once` / `not_approved`; auto-approve is per chat+tool name.
- **ChatClient.** `openai-compatible` (primary) → `databricks-serving` → `stub` if no key.
- **Routine.** Scheduled/webhook prompt into a bot chat. Data tools run as the owner: `run_as='owner_approval'` (default) makes them Ask-first so the owner's approval supplies OBO; App SP only with `run_as='app'` and `BRICKSBOT_ROUTINE_APP_IDENTITY=allow`. Interactive data calls never fall back to the SP in a deployed App unless `BRICKSBOT_INTERACTIVE_SP_FALLBACK=allow`.
- **Sandbox.** Optional isolated Linux exec per chat (`SANDBOX_BACKEND`); Lakebase session/events; artifacts sync to UC Volumes.

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
- Secrets: scope `bricksbot` / `openrouter-api-key` (override via bundle `provider_secret_scope`); optional `web-fetch-allowlist` on the same scope. Never invent secret values. Workspace-specific Lakebase/warehouse ids belong in gitignored `dev.local.yml`, not committed `databricks.yml`.
- Desktop/browser "computer" UI stays out of scope; sandbox exec is opt-in via `SANDBOX_BACKEND`.
