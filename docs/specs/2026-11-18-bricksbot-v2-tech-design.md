# Technical design: BricksBot v2 (routines, metering, live runs, trust, lakehouse wedge)

- **Status:** Proposed
- **Date:** 2026-11-18
- **Author:** Engineering team
- **Inputs:** ranked feature research and eight lane deep dives (internal working notes, not in the repo)
- **Affects:** `server/chat/` (auth, service, schema, approvals), `server/routines/`, `server/agents/clients/`, `server/agents/tools/`, new `server/{runs,usage,observability,attachments,pages}/`, `shared/`, `client/`, `databricks.yml`, `app.yaml`

This doc merges the eight lanes into one plan. It extracts the pieces they share (identity, schema, runs, approvals, tagging), resolves where they disagree, and orders the work. Lane files keep the full detail. Each lane section here links to its file instead of copying it.

---

## 1. Context

BricksBot is a Databricks App: Spaces of bots, durable chat on Lakebase, lakehouse tools with 3-way approvals, routines, and an opt-in sandbox. The OSS community share is the current P0 ([roadmap-next.md](../roadmap-next.md)). Its north star is a cold clone that is **installable and trustworthy**.

The research ranked eight features that GrokBot and Rakazo both treat as table stakes and that map well onto Databricks. Reading the code for them turned up three problems that undercut the "trustworthy" half of the north star today:

1. **Routines read data as the App service principal (SP).** Routine turns have no user token, so `createDatabricksTokenProvider` falls through OBO → PAT → App SP M2M (`server/chat/databricks-auth.ts:120-131`, documented as intended at `:5-12`). A member who can schedule a routine can read whatever the SP can read, and UC row filters and masks apply to the SP, not to them.
2. **Routines do not fire by themselves.** Cron is stored but not run. Each routine needs a hand-deployed Lakeflow Job (`resources/jobs/routine-webhook.job.yml`).
3. **Turns are synchronous.** `POST /messages` waits for the whole turn, which is at risk under the ~120 s Apps gateway cut (community-reported, unverified). Nothing streams or shows progress.

## 2. Goals and non-goals

### Goals

- Close the P0 security gaps before the OSS announce.
- Routines that fire on their own (time and lakehouse events), keep run history, can be stopped, and run with an identity users can understand.
- Every LLM call metered, with budgets and per-bot / per-routine model choice, **before** more unattended runs are switched on.
- Detached runs with live progress (SSE) that survive the gateway cut.
- Safer unattended runs: opt-in Auto Review, and an audit trail that leaves the App as metadata-only rows in UC.
- Analyst surfaces: chat attachments into UC Volumes, and live, shareable Data Pages.

### Non-goals (locks respected)

| Lock (source) | How v2 respects it |
|---|---|
| OSS release first ([roadmap-next.md](../roadmap-next.md)) | Only the P0 security fixes and smoke run gate the announce. Everything else is post-announce, off by default, or degrades to "feature off" on a cold clone. No new **required** bundle resource. |
| Genie opt-in, Ask-first, never the default router (AGENTS.md, [project-context.md](../project-context.md)) | Genie stays human-gated in every mode. Auto Review never passes `genie_ask`. Lane 2 adds a kill switch and refuses Genie on SP turns. Event triggers and Pages never call Genie. |
| No desktop / computer / browser UI (AGENTS.md) | Nothing here adds one. Pages are a document viewer over SQL tiles with no HTML/JSX sandbox. |
| Thin Pi harness, no AppKit `agents()` migration, no pi-durable embed (`docs/durable-harness.md`) | Runs, events, metering and tracing are small hooks around `continueTurn` and `client.complete`. |
| Transcript is never deleted (`docs/durable-harness.md`) | Quiet runs collapse in the UI, they do not delete. Message retention stays an open question (Q14). |
| OpenAI-valid history (AGENTS.md) | Budget checks run before a completion. Stop and crash recovery write synthetic `tool` rows for started tool calls. Deltas are never persisted. |
| No `fast` model ids (`.cursor/rules/no-fast-models.mdc`) | Model catalog and reviewer config reject them (product scope is Q7). |

Also out of scope: group chats, Slack/Teams channels, Vector Search, `tool_search`, public page links (Apps never allow anonymous access).

## 3. Decisions at a glance

| # | Decision | Why |
|---|---|---|
| D1 | **Routine data access fails closed.** By default an unattended routine has no data credential. Data tools become Ask-first, and the owner's approval click supplies their OBO token. Unattended SP data access is an operator-allowed, owner-acknowledged, scope-limited opt-in. | Databricks guidance ("fail closed rather than silently switching to the app's service principal"). There is no supported way to keep a user token for later. |
| D2 | **Time schedules run in-App** (Lakebase lease scheduler). **Lakehouse event triggers use one zero-compute, SP-owned trigger Job per event routine**, which the App polls. | Jobs give no identity gain and cost compute per tick for cron. Nothing in-App can detect table commits or file arrival, and a `condition_task`-only Job needs no compute. |
| D3 | **Two run tables:** `routine_runs` (one per firing) and `chat_runs` (one per execution segment), linked by `chat_runs.routine_run_id`. | Routine firings have states with no execution (queued, skipped, expired) and span several segments (approval resume). |
| D4 | **One audit trail:** `bricksbot_audit.audit_events`, metadata-only and append-only, exported to UC by Lakebase CDF. `approval_events` is fixed now, then frozen. | CDF is schema-scoped, so a separate schema keeps transcripts out of UC. |
| D5 | **LLM calls (main loop and reviewer) authenticate as the App SP** on the Serving path. Data calls never fall back to the SP. | One attribution model, works for routines, needs no `model-serving` OBO scope. |
| D6 | **Explicit `RunContext`** threaded through `continueTurn` and tools. No new AsyncLocalStorage. | Testable attribution across handoff and resume. |
| D7 | **Detached runs + SSE**, with a server-initiated close at about 90 s and Lakebase replay. No WebSockets, no LISTEN/NOTIFY in v1. | Fits the Apps proxy, works with one instance today and several later. |
| D8 | **Auto Review can only turn "ask" into "pass"**, never beyond what Always-allow could grant, and fails closed. | Worst case equals the user clicking Always allow. |
| D9 | **Live Page tiles run with the viewer's OBO token.** Lakeview publish (later) is SP-created with `embed_credentials=false`. | Sharing never leaks the creator's or the SP's data. |

---

## 4. P0 security and correctness fixes

All references were re-checked on `feat/sharing-improvements` @ `70ef671` on 2026-11-18.

| ID | Finding | Evidence (verified) | Fix | Size |
|---|---|---|---|---|
| S1 | **Routine data runs as the App SP.** Applies to `sql_query`, `volume_read`, `lakehouse_catalog`, MCP / Genie / `system.ai` and sandbox on every routine turn. | `server/chat/databricks-auth.ts:120-131` (OBO → `DATABRICKS_TOKEN` → M2M). OBO is only set on three routes (`server/chat/routes.ts:671,698,724`). Routine turns carry `routine: true` (`server/chat/service.ts:184,340`). | Implement D1 (the "P0.5" gate): a routine turn's data provider throws `RoutineIdentityRequiredError` instead of falling back. Credentialed tools are forced Ask-first on routine turns, ignoring Always-allow and handoff `autoApproveAll`. Approval runs under the approver's OBO, and only the chat owner can approve. Update the `databricks-auth.ts:5-12` docblock. Release note: behavior change. | M |
| S2 | **Routine Test runs as the SP.** | `server/routines/routes.ts:104-111`: `service.runNow(...)` is not wrapped in `runWithDatabricksRequestAuth`. | Wrap it. The UI labels Test "runs as you". | S |
| S3 | **Routine tools on a shared bot act on the bot owner's routines.** A Space member's approved `schedule_routine` creates a routine owned by the bot owner that runs in the owner's chat. The member can also list, update or delete the owner's routines. | `server/agents/tools/routine-tools.ts:49,62,140,191,221` and `server/agents/tools/schedule-routine.ts:95` use `bot.ownerId`. The HTTP path correctly uses the caller (`server/routines/routes.ts:72-77`). | Use the turn caller (`ctx.userId`) and scope list/update/delete by `(ctx.userId, bot.id)`. | S |
| S4 | **Approval trail stores raw tool args and is deleted with the chat.** This includes `volume_write` content and SQL text. | Raw args: `server/chat/approvals.ts:137-140`. Cascade: `server/chat/schema.ts:136-138` (`chat_id … ON DELETE CASCADE`), and bot delete cascades to chats. | Store `argsDigest` + `argKeys` instead of args. Run `redactSecrets` (`server/sandbox/redact.ts`). Drop the FK cascade. | S |
| S5 | **Browser retry can double-run a turn.** | `client/src/lib/chat-api.ts:205-222` sends `{content}` with no `requestId`, though route and service support it. | Send `crypto.randomUUID()` as `requestId`. | S |
| S6 | **UI offers "Always allow" for `genie_ask`, which the server silently downgrades.** | `client/src/components/ApprovalCards.tsx:11-18` is missing `genie_ask` (lane 4). | Add it to `isOnceOnlyApproval`. | S |

Also run during the P0 smoke: confirm the OBO scope `files.files` still works or rename it to `files`. Lanes 4, 7 and 8 all found it listed as a deprecated alias (`databricks.yml` `user_api_scopes`).

Not P0, but tracked in F1: **interactive** turns also fall back to the SP when the proxy omits `x-forwarded-access-token`. Failing closed there can break installs where scopes were never consented, so it ships in P1 behind a flag (Q2). *Update 2026-11-18: Q2 decided yes; it shipped with the P0 fixes (default deny, `BRICKSBOT_INTERACTIVE_SP_FALLBACK=allow` escape hatch).*

---

## 5. Cross-cutting foundations

Lanes depend on these, so build each one once.

### 5.1 Identity model

One module (`server/chat/databricks-auth.ts`) and three token purposes replace the single fallback chain. It merges lane 1 (`purpose: data|app`), lane 7 (OBO-required uploads) and lane 8 (`createUserOnlyTokenProvider`).

| Purpose | Used by | Interactive request | Routine turn | Local dev |
|---|---|---|---|---|
| `data` | `sql_query`, `lakehouse_catalog`, `volume_*`, MCP / Genie / `system.ai`, sandbox, probe SQL (lane 5), target checks (lane 5) | Request OBO. If it is missing in prod: error when F1's flag is on, otherwise legacy fallback (Q2). | `run_as='owner_approval'` (default): throw `RoutineIdentityRequiredError`, so the tool is gated to a human (S1). `run_as='app'`: runner SP or App SP, only inside `data_scope` (lane 1-d). | PAT |
| `viewer` (`data` without the routine branch) | Attachment upload/download/delete (lane 7), Page tile runs (lane 8) | Request OBO only. Missing → 401 `no_user_token`. | Refused | PAT |
| `app` | Main LLM on Serving, Auto Review reviewer, workspace-user lookup, Jobs create/pause/`runs/list` (lane 5), Lakeview create/publish (lane 8), MLflow traces (lane 6) | App SP M2M | App SP M2M | PAT |

Rules:

- **Never persist OBO tokens.** They live on the request ALS only, as today.
- **Lakebase stays app-only** (AppKit default).
- **The agent can never set `run_as` or `data_scope`.** Tools always create `owner_approval` routines. `app` is UI-only, needs the env `BRICKSBOT_ROUTINE_APP_IDENTITY=allow`, an explicit acknowledgement, and a valid scope.
- **Routine owner identity:** the payer, the identity, and the chat are all the **routine owner**. The owner is re-checked with `canUseBot` on every run. Losing access gives `failed/access_revoked` and pauses the routine (and its trigger Job).
- **Mixed identity is by design.** An approval inside a routine chat continues under the approver's OBO, and the approver is always the routine owner (`assertChatUse`, `server/chat/routes.ts:610-614`).
- **Long detached runs (lane 3):** a segment keeps the OBO token from the request that started it. A 401 mid-run fails the step with "session expired, resend". It never falls back to the SP.
- **`owner_delegated`** (custom OAuth app + stored refresh token) is deferred (Q1).

**Prereq inside F1:** the Serving chat client only accepts a static PAT and throws otherwise (`server/agents/clients/create-chat-client.ts:39-42`), so `LLM_PROVIDER=databricks` fails inside Apps. F1 switches it to the `app` provider (M2M). Lane 2 proposed the OBO-first chain and lane 4 proposed SP-only. This doc picks SP-only (D5). Per-user Gateway limits come later with lane 2's optional "Gateway mode".

### 5.2 Run and event model

```text
routine fires (schedule tick | trigger Job run | webhook | Test)
  └─ routine_runs row  (one per firing; idempotent on scheduled_for / external_run_id)
       └─ chat_runs segment kind=routine ──(approval)──> waiting
            └─ chat_runs segment kind=resume (parent_run_id) ──> succeeded
                 └─ chat_runs segment kind=handoff (teammate chat, same turn_id)
user message ─> chat_runs segment kind=user ...
every segment ─> run_events (durable step events, per-chat seq) ─> SSE
every tool call / approval / routine transition ─> audit_events (metadata only)
every LLM call ─> llm_usage
```

- **`chat_runs`** (lane 3) is the execution unit. It owns the per-chat lock (partial unique index on `status='running'`), the heartbeat/lease (`owner_instance`, `heartbeat_at`) and `stop_requested`.
- **`routine_runs`** (lane 1 + lane 5) is the firing record: trigger, schedule slot or external run id, `run_as`, status, reason. It holds no lease. Its status follows its segments: the segment goes `waiting` → the routine run goes `waiting`, and the last segment finishing → `succeeded|failed`.
- **`turn_id`** = id of the root segment. Resume and handoff segments inherit it. This fixes the "resume loses routine context" bug (`server/chat/service.ts:369` calls `continueTurn(chatId)` with no options): resume segments find `routine_run_id` through `parent_run_id`.
- **`RunContext`** (D6), passed in `ContinueTurnOptions` and the tool ctx:
  ```ts
  interface RunContext {
    runId: string; turnId: string; parentRunId?: string;
    trigger: 'interactive' | 'resume' | 'handoff' | 'schedule' | 'webhook' | 'test' | 'table_update' | 'file_arrival' | 'job_completion';
    routine?: { routineId: string; routineRunId: string; runAs: 'owner_obo' | 'owner_approval' | 'app'; quiet: boolean };
    payerUserId: string;          // chat user, handoff caller, or routine owner
    signal: AbortSignal;
    emit(e: RunEvent): void;      // no-op when not detached
  }
  ```
  It replaces the boolean `routine` flag (`server/chat/service.ts:184`). Metering, audit, `query_tags`, Auto Review and SSE all read from it.
- **Status vocabulary.** `chat_runs.status`: `running | waiting | succeeded | failed | stopped`. `routine_runs.status`: `queued | running | waiting | succeeded | failed | skipped | cancelled | expired`, plus `reason` (skipped: `overlap | rate_limit | probe | budget | coalesced`; failed: `auth | permission | llm | tool | timeout | lease_lost | access_revoked | budget`) and `quiet` (succeeded with `routine_report no_change`). This merges lane 1's `error_kind` with lane 5's `outcome`.
- **One Stop.** `POST /api/chats/:chatId/runs/:runId/stop` sets `stop_requested`. The owning instance aborts the `AbortSignal`, and others see the flag on the next heartbeat or step. Routine Cancel calls the same path on the active segment, then denies the run's pending approvals with "routine run cancelled" (deny-until-new-message path).
- **Per-step access re-check.** The detached loop re-checks `canUseBot` at each step (lane 3), not only at route entry. Removing a member stops an in-flight run at the next step.
- **Crash recovery.** The boot sweeper moves stale `running` segments (heartbeat older than 60 s) to `failed/lease_lost`. It writes synthetic `{"error":"run interrupted"}` tool rows for orphan tool calls, so history stays OpenAI-valid. There is no mid-turn resume.
- **Leases, no advisory locks.** Lanes 5 and 6 proposed `pg_try_advisory_lock`. Session advisory locks do not survive a transaction-mode pooler, and AppKit only exposes pooled `query()`. Use:
  - row claims with `FOR UPDATE SKIP LOCKED` for due routines (lane 1);
  - a `bricksbot.leases` row for singleton loops (event poller, run sweeper, audit pruner, `run_events` retention). It is claimed in one statement: `INSERT … ON CONFLICT (name) DO UPDATE … WHERE leases.expires_at < now() OR leases.owner = $me RETURNING owner`. The row also stores the event poller cursor, which replaces lane 5's `dispatch_cursors`.

### 5.3 Lakebase schema additions (all in one place)

Every change is additive and idempotent, appended to `CHAT_SCHEMA_STATEMENTS` (`server/chat/schema.ts`), with memory-store twins. CHECK changes use the existing drop/re-add pattern (`schema.ts:70-73`). Look the constraint name up in `pg_constraint` rather than assuming the default name.

**Schema `bricksbot` (operational, mutable):**

| Table / change | Columns (summary) | Lane | Phase |
|---|---|---|---|
| `routines` + cols | `timezone`, `next_run_at`, `run_as` (`owner_approval`\|`app`), `data_scope`, `consecutive_failures`, `paused_reason`, `updated_at`, `webhook_enabled`, `model`, `trigger_kind` (`schedule`\|`table_update`\|`file_arrival`\|`job_completion`), `trigger_config`, `probe_sql`, `probe_last_hash`, `quiet`, `post_no_changes`, `job_id`, `trigger_status`, `trigger_error`, `max_runs_per_hour`. Index `(next_run_at) WHERE enabled`. | 1, 2, 5 | P0 (`run_as`), P1, P2 |
| `routine_runs` (new) | `id`, `routine_id` FK cascade, `bot_id`, `owner_id`, `started_by`, `chat_id`, `trigger`, `scheduled_for`, `external_run_id`, `event_json` (≤8 KB, metadata), `run_as` (`owner_obo`\|`owner_approval`\|`app`), `status`, `reason`, `quiet`, `late`, timestamps. Unique `(routine_id, scheduled_for)` and `(routine_id, external_run_id)`, both partial. Keep the last 50 per routine. | 1 + 5 | P1 |
| `chat_runs` (new) | `id`, `chat_id`, `bot_id`, `kind` (`user`\|`resume`\|`routine`\|`handoff`), `parent_run_id`, `turn_id`, `routine_run_id`, `started_by`, `status`, `request_id`, `owner_instance`, `heartbeat_at`, `stop_requested`, `error`, timestamps. Partial unique `(chat_id) WHERE status='running'`. | 3 (+1) | P1 |
| `run_events` (new) | PK `(chat_id, seq)`, `run_id`, `type`, `payload` (previews ≤500 chars, no secrets), `created_at`. 7-day retention. | 3 | P1 |
| `chats.event_seq` | Per-chat monotonic counter for `run_events.seq` | 3 | P1 |
| `messages.run_id` | `chat_runs.id` that wrote the row (quiet-run collapse, transcript links) | 3, 5 | P1 |
| `messages.attachments` | `AttachmentRef[]` snapshot | 7 | P2 |
| `leases` (new) | `name` PK, `owner`, `expires_at`, `cursor JSONB`, `updated_at` | foundations | P1 |
| `bots.model` | Catalog model id, NULL = default | 2 | P1 |
| `usage_daily` (new) | PK `(day, scope_kind, scope_id)`: cost, tokens, `llm_calls`, `genie_calls` | 2 | P1 |
| `budgets` (new) | `scope_kind` (`user`\|`space`\|`bot`\|`routine`), `scope_id`, `period`, `limit_usd`, `action` (`warn`\|`block`) | 2 | P1 |
| `approvals.review` | Reviewer verdict and reason for the card (never merged into executed args) | 4 | P2 |
| `chat_review_settings` (new) | `chat_id` PK, `mode`, `routine_mode`, `opt_in_tools` | 4 | P2 |
| `chat_attachments` (new) | Lifecycle, quota and preview record per upload (lane 7 §3.2) | 7 | P2 |
| `pages`, `page_versions`, `page_publications` (new) | Lane 8 §3.2. `page_publications` has `CHECK (embed_credentials = FALSE)`. | 8 | P3 / P4 |
| `approval_events` | S4: drop the cascade, digest args. **Frozen after F4:** no new types, read-compat for one release. | 6 | P0 |

**Schema `bricksbot_audit` (append-only, metadata-only, CDF-exportable):**

| Table | Notes | Lane | Phase |
|---|---|---|---|
| `audit_events` | Lane 6 §3.2, plus `routine_run_id` and `run_id`. `REPLICA IDENTITY FULL`. An append-only trigger rejects UPDATE, and DELETE is only allowed inside retention. No FKs; labels are copied at write time. | 6 | P1 |
| `llm_usage` | Lane 2 §3.3, plus `run_id` and `routine_run_id`. `kind` includes `review`. No FKs, so history survives bot deletion. Moved here so CDF exports it with audit. | 2 | P1 |

**Dropped from lanes:** `tool_usage` (lane 2) is replaced by audit `tool.call` rows (`identity_mode` = token kind, `details.statementId` = external ref). `review_usage` (lane 4) becomes `llm_usage` with `kind='review'`. `dispatch_cursors` (lane 5) moves to `leases.cursor`. A separate `approval_events` type for `auto_reviewed` becomes audit action `approval.auto_reviewed`.

The second schema deviates from the AGENTS.md wording "durable state lives in schema `bricksbot`" (Q4). The fallback, if refused, is a nightly Job export from a single schema with an explicit table list.

### 5.4 Approval policy and trail

One classifier in `continueTurn` (`server/chat/service.ts:~669-703`) decides every call. Lanes 1, 4, 5, 7 and 8 each add rules, so they are consolidated here:

| Tool group | Interactive default | Always-allow allowed | Auto Review tier | Unattended (routine / event) turn |
|---|---|---|---|---|
| Meta tools, `list_routines`, `sandbox_stop`, new `routine_report` (routine-only), `read_attachment`, `list_pages`, `read_page` | auto | n/a | not reviewed | auto (whether `save_skill` should ask after outside text is Q10) |
| `sql_query`, `lakehouse_catalog`, `volume_read` | Ask-first | yes | reviewable | `owner_approval`: always human (supplies OBO). `app`: normal rules inside `data_scope`. |
| `web_fetch`, `pin_artifact`, `pin_chart`, `handoff_to_bot`, `save_page` (private page) | Ask-first | yes | reviewable (`web_fetch` to a new host after taint → human) | state-changing ones (`pin_*`, `save_page`) ignore Always-allow on event runs |
| `schedule_routine`, `update_routine` | Ask-first | yes | reviewable. Tainted or unattended → human. | human |
| `save_page` to a Space-visible page | Ask-first with diff | yes | human | refused unless the owner approves |
| `volume_write`, sandbox Ask-first tools, `mcp_*` | Ask-first | yes | opt-in per chat | `volume_write` refused. Others are credentialed: human under `owner_approval`, and Always-allow is ignored on event runs. |
| `create_bot`, `ask_choice`, `delete_routine`, `sandbox_delete`, `genie_ask`, plugin `neverAlwaysAllow` / `destructive`, new `publish_dashboard` | Ask-first | **never** | human_only | human (`publish_dashboard` refused on routine turns) |

Invariants: handoff `autoApproveAll` still never bypasses sandbox tools, `volume_write`, `mcp_*`, `publish_dashboard` or Ask-first plugin tools. "Taint" means outside content entered the turn since the last user message (lane 4 §3.3). Taint only adds strictness.

**Trail.** Once F4 lands, every decision writes to `audit_events`: `approval.requested`, `approval.decided`, `approval.auto_reviewed`, and `tool.call` with `approval_path` (`ask_once | ask_always | auto_always_allowed | auto_meta | auto_routine_tool | auto_handoff | plugin_auto | auto_reviewed`) and `identity_mode` (`obo | sp | pat | none`). This replaces lane 1's proposed `routine.data_access` kind on `approval_events`. Amend [2026-11-02-approval-trail.md](2026-11-02-approval-trail.md): auto-run tools now emit events.

### 5.5 ChatClient v2 (one interface change, done once)

Lanes 2, 3, 4 and 6 each widen `ChatClient` (`shared/agents/types.ts:26-39`). Do it in one PR (F2), with all new fields optional so the change is source-compatible:

- `ChatCompletionRequest`: `model?`, `maxCompletionTokens?`, `meta?: { endUser?: string; requestTags?: Record<string,string> }`, `responseFormat?` (reviewer JSON schema, behind a flag because the Claude 5.5 family rejects it).
- `complete(request, opts?: { signal?: AbortSignal; onDelta?: (t: string) => void })`. Streaming is implemented later (lane 3-d) and requests `stream_options.include_usage`.
- `ChatCompletionResult`: `usage?` (tokens, cached, reasoning, provider `cost`), `model?`, `finishReason?`, `providerRequestId?`.
- `ChatClient.defaultModel`.
- **`MeteredChatClient`** decorator (lane 2) wraps every client, including the reviewer, so lane 4 does not need its own counter. Fix the plugin ctx `model` field (`server/chat/service.ts:648`) to pass the resolved model id.

### 5.6 Tagging for system-table reconciliation

One tag set (lanes 2 and 6 used different keys). Keys use underscores only, because query-tag keys may not contain `, : - / = .`. Values are ids, never emails or content.

| Key | Value |
|---|---|
| `bricksbot_app` | App name |
| `bricksbot_bot` | bot id |
| `bricksbot_chat` | chat id |
| `bricksbot_routine` | routine id (if any) |
| `bricksbot_routine_run` | routine run id (if any) |
| `bricksbot_turn` | turn id |
| `bricksbot_trace` | trace id (when tracing is on) |

| Sink | Mechanism | Lands in |
|---|---|---|
| SQL statements | `query_tags` on `POST /api/2.0/sql/statements` (≤20 tags, ≤128 chars), `server/agents/tools/sql-query.ts:266-277` | `system.query.history.query_tags` |
| Serving / Gateway / MCP (Genie, `system.ai`) | `Databricks-Ai-Gateway-Request-Tags: {json}` header (`server/agents/tools/mcp-client.ts`) | `system.ai_gateway.usage.request_tags` |
| Trigger Jobs (lane 5) | Job `tags` | Jobs UI, `system.lakeflow.*`, billing |
| OpenRouter | `user = HMAC_SHA256(secret, userId)` | Provider abuse isolation |
| Traces (lane 6) | `bricksbot.*` span attributes | `*_otel_spans` / MLflow |

Lanes 2 and 6 also merge their reconciliation pieces into **one admin reconciliation pack**: a bundle SQL file or AI/BI dashboard that joins `llm_usage` / `audit_events` (via CDF) with `system.query.history`, `system.ai_gateway.usage` and `system.billing.usage` (`APPS`, `GENIE`). It runs with an **admin's OBO token**. The App SP is never granted `system.*`.

### 5.7 Shared conventions

- **Env naming:** every new env var uses the `BRICKSBOT_` prefix. This renames lane 1's `ROUTINE_SCHEDULER` / `ROUTINE_APP_IDENTITY`, lane 4's `AUTO_REVIEW_*` and lane 5's `BRICKSBOT_ROUTINE_SP_SQL`. Lanes 1 and 5 proposed two env vars for the same gate; this doc uses one, `BRICKSBOT_ROUTINE_APP_IDENTITY`.
- **OSS-safe defaults:** every feature is off or invisible on a cold clone without its resource or env. Budgets default to unset/warn. Auto Review is off. Event triggers are hidden until setup status says ready. Attachments are on only when a volume root is set. Dashboards are off.
- **Setup status** (`GET /api/setup/status`) reports readiness for each new feature (scheduler, app identity, Serving SP auth, reviewer, event triggers, CDF, attachments, dashboards).
- **Unified routine limits** (lanes 1 and 5 disagreed; Grok's 200/300 per hour is too high for warehouse-backed runs):

| Limit | Default | Env |
|---|---|---|
| Minimum schedule interval | 15 min (so ≤4 runs/h per schedule routine) | `BRICKSBOT_ROUTINE_MIN_INTERVAL_MINUTES` |
| Per event routine | 12 runs/h (max 60). Jobs side: `min_interval_sec` ≥ 60 (default 300), `max_concurrent_runs: 1`. | `max_runs_per_hour` column |
| Per owner, all kinds | 30 runs/h | `BRICKSBOT_ROUTINE_OWNER_RUNS_PER_HOUR` |
| App-wide | unset | `BRICKSBOT_ROUTINE_APP_RUNS_PER_HOUR` |
| Waiting run TTL | 24 h, then `expired` with approvals expired (Grok uses 30 min for background cards, see Q9) | `BRICKSBOT_ROUTINE_WAITING_TTL_HOURS` |
| Failure backoff | 5 min, doubling to 24 h, then `paused_reason='backoff'`. A non-owner's Test does not count. | n/a |

---
## 6. Conflicts between lanes, resolved

| # | Conflict | Lanes | Decision |
|---|---|---|---|
| C1 | **Per-routine Jobs.** Lane 1 rejects them (clutter, compute per tick, no identity gain). Lane 5 provisions one trigger Job per routine. | 1 vs 5 | **Split by trigger kind (D2).** `schedule` routines run in the in-App scheduler. No Job is created, and the example webhook Job becomes "advanced: external trigger". `table_update` / `file_arrival` / `job_completion` routines get exactly one App-SP-owned Job each. Its only task is a zero-compute `condition_task`, and the App polls `runs/list`. Lane 1's objections do not apply: there is no compute per event, the Job is the only way to detect commits, and identity stays with `run_as` either way. |
| C2 | **One run table or two.** Lane 3 suggests a single `chat_runs` table with routine columns. Lane 1 defines `routine_runs`. | 1 vs 3 | **Two tables, linked (D3, §5.2).** |
| C3 | **Locking.** Lane 1 uses `SKIP LOCKED`, lane 3 a heartbeat, lanes 5 and 6 `pg_try_advisory_lock`. | 1, 3, 5, 6 | Row claims plus a `leases` table. **No advisory locks** (the pooler drops session locks) (§5.2). |
| C4 | **Stop / cancel.** Lane 1 checks `shouldAbort()` between steps. Lane 3 uses an `AbortSignal` plus a `stop_requested` flag. | 1 vs 3 | One mechanism in `RunService` (lane 3's). Routine Cancel = stop the active segment and deny pending approvals. |
| C5 | **Attribution plumbing.** Lane 2 passes explicit options. Lane 6 adds an `ObservabilityContext` ALS. | 2 vs 6 | **Explicit `RunContext` (D6).** The only ALS stays the existing auth store. |
| C6 | **Serving LLM token.** Lane 2 wants OBO → PAT → SP. Lane 4 wants SP-only. | 2 vs 4 | **SP via the `app` purpose (D5)** for the main loop and the reviewer. |
| C7 | **Usage tables.** Lane 2 `tool_usage`, lane 4 `review_usage`, lane 6 audit `tool.call`. | 2, 4, 6 | Audit `tool.call` covers tool usage. `llm_usage` (`kind='review'`) covers the reviewer. Genie counts go to `usage_daily.genie_calls`. |
| C8 | **Trail location.** Lane 4 extends the `approval_events` CHECK. Lane 6 moves the trail to `audit_events`. | 4 vs 6 | `audit_events` is the single trail (D4). `approval_events` gets the S4 fix, then is frozen. Sequencing: F4 lands before lane 4's storage PR. |
| C9 | **Exporting usage to UC.** Lane 2 defers export to lane 6, but CDF is schema-scoped. | 2 vs 6 | `llm_usage` lives in `bricksbot_audit` next to `audit_events`. |
| C10 | **Tag keys.** Lane 2 uses `app`, `bricksbot_bot`…; lane 6 uses `bricksbot_trace`, `bricksbot_chat`…. | 2 vs 6 | One set (§5.6). |
| C11 | **Env names and the SP gate.** `ROUTINE_APP_IDENTITY` (lane 1) vs `BRICKSBOT_ROUTINE_SP_SQL` (lane 5). | 1 vs 5 | `BRICKSBOT_ROUTINE_APP_IDENTITY=allow`, and `BRICKSBOT_` prefix everywhere (§5.7). |
| C12 | **Rate limits.** Lane 1: 15 min min / 4 per routine / 30 per owner. Lane 5: 12 per routine / 60 per owner. | 1 vs 5 | Unified table (§5.7). Owner cap is 30/h across all kinds. |
| C13 | **Run result fields.** Lane 1 `status` + `error_kind` vs lane 5 `outcome`. | 1 vs 5 | `status` + `reason` + `quiet` (§5.2). |
| C14 | **Waiting expiry.** Lane 1: 24 h. Lane 4 suggests Grok's 30 min. | 1 vs 4 | 24 h default, configurable. Event routines coalesce new events while a run waits, so a long wait does not pile up runs (Q9). |
| C15 | **Unattended approval hardening.** Lane 1 forces credentialed tools to a human. Lane 4 Q2 suggests re-reviewing Always-allowed tools. Lane 5 PR7 ignores Always-allow for state-changing tools on event runs. | 1, 4, 5 | One "unattended" row in the classifier (§5.4). Credentialed tools follow `run_as`. State-changing tools ignore Always-allow on event runs. Extending that to schedule runs is Q11. |
| C16 | **Routine data in Auto Review.** Lane 4 makes routine data tools human-only "until lane 1". | 1 vs 4 | After S1: under `owner_approval`, routine data tools are **never** reviewable, because they need a human token. Under `app`, they are reviewable inside `data_scope`. |
| C17 | **Scheduler cadence vs Lakebase idle.** Lane 1 sleeps adaptively (≤300 s) so Lakebase can scale to zero. Lane 5 polls every 60 s. | 1 vs 5 | The event poller runs only while ≥1 event routine is active. It polls the **Jobs API**, not Lakebase, and writes to Lakebase only when new runs appear or the cursor moves. |
| C18 | **Webhook response.** Lane 1 keeps a synchronous 201. Lanes 3 and 5 want an async 202. | 1, 3, 5 | 202 `{routineRunId}` once detached runs land (lane 3-a), behind a compat flag. The ping script accepts 201 or 202. |
| C19 | **Presence.** Lane 1 reuses global `bots.presence` for "waiting". Lane 3 shows presence leaking across users of a shared bot. | 1 vs 3 | Roster status comes from the caller's `chat_runs` (lane 3-e). Routine "waiting" comes from `routine_runs`. `bots.presence` is kept write-only during the transition. |
| C20 | **User-token helpers.** Lane 1 `purpose`, lane 7 "OBO required", lane 8 `createUserOnlyTokenProvider`. | 1, 7, 8 | One module, three purposes (§5.1). |
| C21 | **Missing `requestId`.** Fixed separately in lane 3 PR1 and lane 7 P4. | 3, 7 | Fixed once (S5). |
| C22 | **`save_skill` after outside text.** Rakazo asks first. AGENTS.md says meta tools auto-run. | 4, 5 | Keep the lock in v2. This needs the user's decision before it changes (Q10). |
| C23 | **Research claims.** Grok "quiet runs" and "spend caps". | 2, 5 | Not supported by Grok docs. Quiet runs are a Rakazo pattern. Grok has run-rate caps and usage allowances, not a per-bot spend cap. |
| C24 | **Reconciliation surfaces.** Lane 2 PR8 dashboard and lane 6 PR6 views. | 2, 6 | One admin reconciliation pack, run with admin OBO (§5.6). |

---

## 7. Lane designs

Each subsection is a summary. Follow the link for schemas, test plans, alternatives and evidence.

### 7.1 Lane 1: Routine engine v2

**Summary.** An in-App scheduler fires routines from Lakebase. `routine_runs` gives history, Stop and guards. Identity fails closed by default (S1), with opt-in app identity for unattended runs.

**Design.**
- `server/routines/scheduler.ts` runs one claim loop in one transaction: `SELECT … WHERE enabled AND next_run_at <= now() FOR UPDATE SKIP LOCKED`, insert `routine_runs` with `ON CONFLICT DO NOTHING`, advance `next_run_at`, and coalesce missed ticks into one `late` run. Sleep `min(next due, 300 s)`. Enabled by `BRICKSBOT_ROUTINE_SCHEDULER` (on when Lakebase is configured).
- `server/routines/executor.ts` replaces `RoutineService.enqueue` (`server/routines/service.ts:43-57`). It applies the guards (access, overlap, rate, budget, app-scope re-check), starts a `chat_runs` segment through `RunService` with `requestId = routine-run:<id>`, and records the outcome. The settle hook finishes `waiting` runs after a decide or choice.
- Cron with timezone uses `nextRunAfter()` in `shared/` (new dependency `croner`, Q19).
- `run_as`: `owner_approval` (default, S1) or `app` (`BRICKSBOT_ROUTINE_APP_IDENTITY=allow` + acknowledgement + `data_scope`, checked against the owner's UC permissions **at save time with their OBO**, then re-checked with a 24 h TTL). An optional dedicated runner SP comes from secret `bricksbot/routine-sp-client-secret`. A best-effort SQL scope scan is defense in depth only. UC grants on the runner SP are the real boundary.
- Per-user MCP connector tools are excluded under `run_as='app'`.

**Data / API / UI.**
- Schema: `routines` cols and `routine_runs` (§5.3).
- API: `GET /api/routines/:id/runs`, `POST /api/routines/:id/runs/:runId/cancel`, PATCH accepts `timezone`, `runAs`, `dataScope`, `model`. Setup status gains scheduler and identity flags.
- UI (`RoutinesPanel`): next-run preview, status pill, History drawer (last 20), Stop, timezone. A "Runs as" line in the trust banner. Remove the "deploy a Job per routine" copy.

**Security.** S1–S3. The agent can never set `run_as`. Access is re-checked every run, and revocation pauses the routine. Waiting runs expire.

**Cost.** One indexed Lakebase query per sleep window. The warehouse is the main cost driver, bounded by the 15 min minimum and the caps. `owner_approval` runs touch no warehouse until a human approves.

**Risks.** Behavior change for existing routines (Q3). Double firing if an operator still runs the example Job (Q6). Owner effective-permission API rights are unverified (spike X6). Lakebase scale-to-zero vs the 300 s cap is unverified (X7).

**PRs.** P0 identity + ownership (S1–S3, M) · L1-a runs + executor + history (M) · L1-b scheduler (M) · L1-c controls and guards (S-M) · L1-d app identity opt-in (M) · L1-e docs (S) · later `owner_delegated` (L, Q1).

### 7.2 Lane 2: Usage metering, budgets, model choice

**Summary.** A Lakebase usage ledger fed by the `usage` that both providers already return (and BricksBot currently drops). Budgets are checked before every LLM call. A per-bot and per-routine model comes from an operator catalog. Databricks system tables are a reconciliation source via tags, not the mechanism.

**Design.**
- `MeteredChatClient` writes one `llm_usage` row per call (turn, compaction, review) and upserts `usage_daily` in the same statement.
- Cost: provider `cost` (OpenRouter) → price table → estimate, with `cost_source` and `price_snapshot` stored.
- `BudgetService.check()` runs before `client.complete` and before compaction. App caps come from env, plus Space / bot / routine / personal rows and a per-turn call cap. A block persists a notice row and makes no call, so no orphan `tool_calls`.
- Interactive turns fail open if the ledger is unreachable. Routines fail closed.
- Catalog: `BRICKSBOT_MODELS` JSON, defaulting to `[LLM_MODEL]`. Resolution order: routine → bot → default. `contextWindow` is per model. Ids with `fast` are dropped (Q7). One provider per deployment.
- Genie: `BRICKSBOT_GENIE_ENABLED`, a per-user daily cap, and `BRICKSBOT_GENIE_ALLOW_SP=false`. SP Genie calls are billed from the first DBU. This closes the platform plan's kill-switch question.

**Data / API / UI.**
- Schema: `llm_usage` (audit schema), `usage_daily`, `budgets`, `bots.model`, `routines.model`.
- API: `/api/usage/me`, `/api/bots/:id/usage`, `/api/spaces/:id/usage`, `/api/spaces/:id/budgets`, `/api/usage/me/budgets` (can only tighten), `/api/routines/:id/usage`, `/api/models`.
- UI: Usage panel, model select in Bot details (owner only) and in Routines, warn banner and block notice, Space budgets in the members dialog.

**Security.** The payer is the turn's human, never the bot owner of a shared bot. No content in usage rows. Tags carry ids only. OpenRouter `user` is an HMAC. System tables are read only with admin OBO.

**Cost.** One rollup read plus one write per LLM call. No warehouse in the hot path.

**Risks.** Concurrent overshoot is bounded and documented as "approximate". OpenRouter `cost` units (USD vs credits) are treated as USD. Gateway mode depends on a Beta feature and scopes (spike X9).

**PRs.** L2-a client usage capture: folded into F2 + F1 (S) · L2-b ledger + decorator (M) · L2-c tags + Genie counters: folded into F4 / §5.6 (S) · L2-d usage API + UI (M) · L2-e model catalog (M) · L2-f budgets + Genie kill switch (M) · L2-g docs (S) · later Gateway mode + reconciliation pack (M-L).

### 7.3 Lane 3: Detached runs and live streaming (SSE)

**Summary.** `POST /messages {async:true}` returns 202 `{runId}`, and the turn runs detached. A per-chat SSE feed carries durable step events (replayable from `run_events`) and ephemeral token deltas. It closes itself at about 90 s, and the client reconnects with `Last-Event-ID`. This answers the open "websocket / scaling" item in `project-context.md`.

**Design.**
- `RunService.start` takes the per-chat lock (409 `{activeRunId}` on conflict) and heartbeats every 10 s.
- Emit points in `continueTurn`: `run.started`, `llm.started`, `llm.delta` (memory only), `assistant.committed`, `tool.started` / `tool.finished` (previews ≤500 chars), `approval.pending`, `choice.pending`, `handoff.*`, `run.finished`.
- Fan-out: an in-process bus for one instance. With several instances, poll `run_events` every 1 s only while a run is active on another instance. No LISTEN/NOTIFY: it needs a direct connection and likely pins Lakebase compute.
- Decide and choice start `resume` segments. Handoff gets its own segment on the teammate chat with the same `turn_id`.
- Streaming clients parse `chat.completion.chunk` and fold tool-call fragments. They fall back to non-streaming per endpoint. Usage comes from the final chunk.

**Data / API / UI.**
- Schema: `chat_runs`, `run_events`, `chats.event_seq`, `messages.run_id`.
- API: async messages / decide / choice, `GET /api/chats/:id/events` (SSE), `GET /api/chats/:id/runs`, `POST …/runs/:runId/stop`, optional `GET /api/events/roster`.
- UI: async send with `requestId`, tool activity rows, streaming bubble, Stop button, live HandoffPeek, roster feed. Fall back to polling after 3 SSE errors.

**Security.** Watching needs ownership + `requireBotAccess`. Start and Stop need `requireBotUse`. Access is re-checked on reconnect, every 60 s in-stream, and at each loop step. Caps: 6 SSE connections per user, 3 concurrent runs per user. No SP fallback on token expiry.

**Cost.** LLM-neutral; Stop saves tokens. About 5–15 event rows per turn plus one heartbeat UPDATE per 10 s per active run. No DB traffic while idle.

**Risks.** The 120 s cut, buffering and compression through the Apps proxy are unverified (spike X1, in L3-b). Partial deltas are lost on cross-instance reconnect (acceptable). AppKit `StreamManager` internals may not be stable.

**PRs.** F3 run entity + lock + sweeper (M) · L3-a detached runs + step events + async webhook (M) · L3-b SSE feed + tool activity + deploy smoke + docs drift fix (`docs/architecture.md:54,69` claims SSE today) (M) · L3-c Stop (S) · L3-d token streaming (M) · L3-e per-chat presence + roster feed + live peek (S-M) · L3-f multi-instance poll + caps + retention (S, Q13).

### 7.4 Lane 4: Auto Review

**Summary.** An opt-in, per-chat reviewer sits between deterministic policy and the approval card. It can only turn "ask" into "pass", and it fails closed. It sees only the owner's words and redacted args, never tool outputs.

**Design.**
- Pipeline after classification: tiers (§5.4), then hard rules (taint + routine change, taint + new host, routine data under `owner_approval`, handoff opt-in only), then caps (8k args, wave cap 6, daily cap), then a memo, then the reviewer (timeout 8 s, one retry on an unreadable reply, a backup model only on `error`).
- Strict JSON `{decision, reason}`. Anything looser becomes `ask`.
- The reviewer is a Serving endpoint bound as an **optional** `serving_endpoint` resource with `CAN_QUERY`, called as the App SP through ChatClient v2 + metering. It falls back to an OpenRouter model. Requires F1's Serving SP fix.

**Data / API / UI.**
- Schema: `approvals.review`, `chat_review_settings`. Audit action `approval.auto_reviewed`.
- API: `GET/PUT /api/chats/:id/review-settings`, `GET /api/chats/:id/approvals/events?type=auto_reviewed`.
- UI: "Auto Review" section in the Permissions tab (chat mode, routine mode, opt-in tools, "Required by admin"), a reason line on cards, a recent auto-reviews list.

**Security.** Invariants: no denials, never beyond Always-allow, fail closed, no new identity, OpenAI order preserved. `genie_ask` is never reviewed. Args are redacted before the reviewer call and the audit row.

**Cost.** About 1k input / 50 output tokens per review. Nano-class models cost about 0.001 DBU per review (unverified pricing). Adds 0.3–2 s per wave.

**Risks.** Injected text inside args (bounded by tiers). Over-asking (tune with MLflow evals from audit pairs). Default model choice (Q12).

**PRs.** Prereq S6 + F1 · L4-a policy core (S) · L4-b reviewer (M) · L4-c storage + `ChatService` integration (M, after F4 and L2-b) · L4-d routes + UI (M) · L4-e bundle (optional resource in `dev.local.yml.example`), spec, AGENTS.md lock line (S) · later Jev adapter, evals, Space policy.

### 7.5 Lane 5: Lakehouse event triggers and quiet runs

**Summary.** Databricks Jobs detect the event and the App dispatches the run. Quiet runs post only when something is notable.

**Design.**
- On enable, the App SP provisions `[bricksbot] routine <id>`: native `tableUpdate` / `fileArrival` trigger (`job_completion` Beta via REST, flagged), `max_concurrent_runs: 1`, tags, job parameters bound to `{{job.trigger.*}}`, and a single `condition_task`.
- Target access is checked at save time with the **user's OBO**.
- The event poller (singleton lease) reads `runs/list` after the cursor. Each new run becomes `routine_runs` (deduped on `external_run_id`), then rate limit, `canUseBot`, budget, and probe gate, then a segment with `requestId = routine:<id>:<extRunId>`. Backlogs coalesce to the newest run.
- Quiet runs:
  - A probe gate: an App-side read-only `probe_sql` (zero tokens on skip). Jobs `sqlCondition` is an optional later optimization.
  - A routine-only meta tool `routine_report({status:'no_change'|'notable', summary})`. `no_change` collapses the turn into a "Checked · no changes" chip and skips the preview and presence bump. If the model forgets the tool, the run posts (fail loud).
- SQL Alerts with webhook destinations are rejected: they cannot pass Apps OAuth ingress.

**Data / API / UI.**
- Schema: `routines` trigger cols, `routine_runs.external_run_id` / `event_json`, `messages.run_id`, `leases.cursor`.
- API: trigger union in create/patch, `GET /api/routines/:id/trigger` (health from `include_trigger_history`), async webhook.
- UI: "When" control (Schedule / Table changes / Files arrive / Job finishes), probe textarea, "Post 'No changes'" toggle, trigger status pill, history with outcomes, collapsed quiet chips.

**Security.** **Hard dependency on S1:** without it, an event routine lets a member read, through the SP, tables they cannot read themselves. Revoked access pauses the Job trigger. Event payloads are metadata only. On event runs, state-changing tools ignore Always-allow and `volume_write` stays off. Provisioned Jobs get no user ACLs. Auto Review (lane 4) should land first, because event runs carry outside text.

**Cost.** Zero compute for the trigger and the `condition_task`. One `runs/list` call per tick. The LLM is the dominant cost, bounded by caps, the probe, and budgets. A quiet run costs one short turn.

**Risks.** Whether `runs/get` returns **resolved** `{{job.trigger.*}}` values (spike X2, blocking). Whether the SP needs read on watched tables (X3; if so, the SP's grants widen, though the SP is never used for data under `owner_approval`). `DESCRIBE` under `sql:restricted-query` (X4). The job-completion field name (X5).

**PRs.** L5-0 spike (S) · L5-a types + schema (S) · L5-b quiet runs, which also work for schedules (M) · L5-c probe gate (S-M) · L5-d job spec + provisioner (M) · L5-e poller + `dispatchEvent` (M) · L5-f UI (M) · L5-g outside-text hardening (S) · L5-h Beta kinds behind flags (M) · L5-i tool surface + seed skill (S).

### 7.6 Lane 6: Observability and audit export

**Summary.** Two products share one correlation id. **Audit:** Lakebase `bricksbot_audit.audit_events`, metadata-only and append-only, exported to UC Delta by Lakebase CDF. **Tracing:** a `Tracer` port with an OTel adapter (default, via AppKit's provider and Databricks App telemetry into UC `*_otel_*` tables) and an opt-in MLflow adapter (`@mlflow/core@0.4.0`, the version AppKit pins). Trace content is off by default.

**Design.**
- `audit-emit.ts` is the single place that decides what is safe to persist: `argsDigest`, `argKeys`, safe facts such as `statementId` / `rowCount` / path and bytes, a 4 KB cap, and `redactSecrets`.
- Events: `tool.call` (success / failure / refused / denied), `approval.*`, `routine.run.*`, sharing and membership, connectors, bot lifecycle, `skill.saved`, `attachment.*` (lane 7), `page.*` / `dashboard.*` (lane 8), `audit.exported`.
- SQL text is never stored. Join `system.query.history` on tags instead.
- Tracer collision rule: `BRICKSBOT_TRACING=auto` picks OTel when the OTLP env is set, else MLflow when an experiment is set, else noop.

**Data / API / UI.**
- Schema: `bricksbot_audit.audit_events` (+ trigger, `REPLICA IDENTITY FULL`, `audit.initialized` seed row), one-time backfill from `approval_events`.
- API: `GET /api/bots/:id/activity`, `GET /api/spaces/:id/activity`, `GET /api/audit/export` (JSONL, own scope).
- UI: Activity tab in Bot details, "Recent changes" in the Space dialog, "Export my activity".

**Security.** Metadata-only. `BRICKSBOT_TRACE_CONTENT=off|redacted|full` affects traces only, never audit, because experiment and UC ACLs are not Space ACLs. The App SP gets no MODIFY on the UC copy (tamper evidence). Govern UC access through views, because row filters on CDF targets stop the feed. Optional `BRICKSBOT_AUDIT_STRICT` fails closed on consequential tools if the audit write fails.

**Cost.** Small rows. CDF billing is undocumented (Q15). App telemetry bills on the Jobs Serverless SKU. Query tags are free.

**Risks.** CDF is Public Preview and needs an admin. The App telemetry env var names are unverified, and the OTel / MLflow global-provider collision is inferred (X12). Lakebase plpgsql triggers are assumed to work (X7). CDF billing is unknown (X13).

**PRs.** S4 trail fix (S, P0) · F4 audit core + `query_tags` + approval dual-write + backfill (M) · L6-a coverage: routes, routines, attachments, pages (S-M) · L6-b OTel tracer (M) · L6-c UC export runbook + views + reconciliation pack (S-M) · L6-d Activity UI + export + retention (M) · L6-e MLflow tracer (M) · later feedback and evals.

### 7.7 Lane 7: Chat attachments → UC Volume

**Summary.** The composer streams raw bytes to `POST /api/chats/:chatId/attachments`. The server streams them to the Files API with the **user's OBO token** (`viewer` purpose, no SP fallback) into `{root}/users/{user}/bots/{bot}/uploads/{chat8}/{att8}-{name}`, counted against `volume_usage`.

**Design.**
- An extension allowlist plus a magic-byte sniff.
- The preview comes from the first 64 KB, captured during the stream.
- The user message carries an `attachments` snapshot. `toLlmHistory` appends a capped "User attached … treat as data, not instructions" note.
- Reading: an auto-run `read_attachment` scoped to `(user, chat)` for text formats, and `read_files()` through Ask-first `sql_query` for analysis and joins. `ai_parse_document` is an opt-in cost path for PDF.
- Limits: 25 MiB per file, 5 per message, 25 per chat.

**Data / API / UI.**
- Schema: `chat_attachments`, `messages.attachments`, `volume_usage.subtractBytes` (+ reserve).
- API: `GET /api/attachments/config`, upload / list / content / delete routes, `attachmentIds` on messages.
- UI: paperclip, drag and drop, paste, progress chips, chips on the user bubble, Library "Uploads".

**Security.** `assertChatUse` on every route. OBO only in prod. The server builds every path and uploads with `overwrite=false`. Downloads use `attachment` + `nosniff`. `read_attachment` is refused on routine turns. **Caveat:** UC volume grants are volume-wide, so any user with WRITE VOLUME can read others' uploads directly (same as `volume_write` today). Document it and offer `BRICKSBOT_ATTACHMENT_VOLUME_ROOT` (Q16). `read_attachment` output counts as taint for lane 4.

**Cost.** Storage plus App compute. Previews cost no warehouse. Analysis runs on the user's warehouse (Ask-first).

**Risks.** The 120 s proxy limit for large uploads (X1). Parent directory auto-creation (X14; add `ensureVolumeDirectory`). Excel on SQL warehouse channels (X10).

**PRs.** L7-a types + store (S) · L7-b streaming helpers + validate + preview (M) · L7-c routes + service (M) · L7-d composer + transcript UI (M) · L7-e `read_attachment` + catalog line + seed skill (S) · L7-f Library uploads + delete (S) · later XLSX / PDF enrichment (M), hygiene / sweeps / reserve (M), materialize / strict mode / images (L).

### 7.8 Lane 8: Data Pages + optional AI/BI publish

**Summary.** **Phase A:** in-App Pages, a versioned list of markdown / Mermaid / snapshot tiles plus **live SQL tiles** (table / metric / Vega chart) that re-run with the **viewer's** OBO token on view. **Phase B (later, opt-in):** publish a Page as a Lakeview dashboard, created by the App SP (Apps have no `dashboards` OBO scope) with `embed_credentials=false`.

**Design.**
- `save_page` (Ask-first, every bot) can build tiles from earlier `sql_query` calls (copies the statement, never the rows). `list_pages` and `read_page` auto-run. A `data-page` seed skill.
- Tile runner: `viewer` token, `executeReadOnlySqlRows`, ≤1000 rows, a 5 min cache **per viewer**, concurrency limits.
- Routines rewrite narrative only, on private pages. Live tiles make data refreshes unnecessary.
- Phase B: a fixture-backed `serialized_dashboard` mapping, ACLs (owner `CAN_MANAGE`, Space `CAN_READ`) re-synced on membership change, and a publisher OBO dry-run of every tile.

**Data / API / UI.**
- Schema: `pages`, `page_versions`, `page_publications`. Optional `source` on pin notices.
- API: `/api/bots/:id/pages`, `/api/pages/:id`, `POST /api/pages/:id/tiles/:tileId/run`, PATCH / DELETE, and Phase B `/publish`.
- UI: PageCard ("Updated below"), PageView with per-tile states, Library Pages with Share, "Make a page from these pins".

**Security.** The data plane is always the viewer, enforced in code. Snapshot tiles are the only data at rest and reach a Space only through an explicit owner action. `publish_dashboard` is never Always-allow, is a handoff exception, and is refused on routine turns. `embed_credentials=false` is enforced in code and by a DB CHECK.

**Cost.** No LLM cost to view. Warehouse cost scales with tiles × views, bounded by lazy viewport loading, the cache, row caps and a rate-limited refresh. Published dashboards should use Lakeview schedules, not routines.

**Risks.** The undocumented `.lvdash.json` schema (fixtures). Permission level names (`CAN_READ` vs `CAN_VIEW`). SP folder rights. Whether `sql` covers Lakeview APIs (X11).

**PRs.** L8-0 pins carry source SQL (S) · L8-a domain + stores (M) · L8-b tile runner (M, after F1) · L8-c page tools (M) · L8-d routes (M) · L8-e PageCard + PageView (M) · L8-f Library + Share (S-M) · Phase B: L8-g serializer + Lakeview client (L) · L8-h publish flow (M) · L8-i ACL sync (S-M) · L8-j schedules / embed (S-M).

---
## 8. Roadmap

Sizes: **S** ≈ 1–2 days, **M** ≈ 3–5 days, **L** ≈ 1–2 weeks, for one engineer including tests. IDs match §4 and §7.

### P0: announce gate (before the OSS announce)

| ID | Item | Lanes | Size | Depends on |
|---|---|---|---|---|
| P0-1 | Fresh-workspace smoke ([oss-community-release.md](../oss-community-release.md)), including the `files` vs `files.files` scope check | roadmap | S | — |
| P0-2 | S2 Test OBO wrap, S3 routine-tool ownership, S5 client `requestId`, S6 genie card drift | 1, 3, 4, 7 | S | — |
| P0-3 | S4 `approval_events` digest + drop cascade | 6 | S | — |
| P0-4 | S1 routine data fail-closed: `routines.run_as` (default `owner_approval`), routine ALS marker, `RoutineIdentityRequiredError`, credentialed tools forced Ask-first on routine turns, release note | 1 | M | — |

P0-4 uses today's boolean `routine` flag. It does not wait for `RunContext`.

#### P0 follow-ups (from the P0 review, 2026-11-18)

Not regressions; none gates the announce. Pick up in P1 next to F1 / F4.

| ID | Item | Where |
|---|---|---|
| P0-F1 | "Always allow" still shows on routine-forced cards. Move `isOnceOnlyApproval` into `shared/` next to `requiresAlwaysAsk` so the card and server agree. | `client/src/components/ApprovalCards.tsx:315` |
| P0-F2 | The `approval_events` scrub `UPDATE` full-scans on every boot and assumes the default FK name (`approval_events_chat_id_fkey`). Run it once (marker row or `WHERE payload ? 'arguments'` + index) and drop the FK by lookup. | `server/chat/schema.ts:155` |
| P0-F3 | `redactSecrets` runs only on arg key names, and an unsalted sha256 of low-entropy args (short SQL, small files) can be brute-forced. Salt the digest (per-install secret) or keep only `argKeys` for those tools. | `server/chat/approvals.ts:40` |
| P0-F4 | `system.ai` MCP uses the static `DATABRICKS_TOKEN` and bypasses the `data` guard when a PAT is set in prod. Route it through `createDatabricksTokenProvider({ purpose: 'data' })`. | `server/agents/tools/system-ai-mcp.ts:138` |
| P0-F5 | Sandbox stop/delete and MCP connector routes are not wrapped in `runWithDatabricksRequestAuth`, so they never see the caller's OBO token. | `server/chat/routes.ts` |
| P0-F6 | Idempotency is written only after the turn finishes, so concurrent duplicate sends can still both run. Reserve the `requestId` row (`INSERT … ON CONFLICT DO NOTHING`, pending state) before the turn. | `server/chat/service.ts` `sendUserMessage`, `server/durable/idempotency-store.ts` |

### P1: foundations, routine engine, metering, detached runs

Three tracks can run in parallel once F1–F3 exist.

| ID | Item | Size | Depends on |
|---|---|---|---|
| F1 | Identity module (`data` / `viewer` / `app`), Serving SP auth, interactive fail-closed behind a flag (Q2) | M | P0-4 |
| F2 | ChatClient v2 + usage parsing in both clients | S | — |
| F3 | Run model: `chat_runs`, `run_events`, `RunContext`, `leases`, boot sweeper, per-step access re-check | M | — |
| F4 | Audit core (`bricksbot_audit`), approval dual-write + backfill, `query_tags` + Gateway request tags | M | P0-3, F3 |
| **Track A: routines** | | | |
| L1-a | `routine_runs`, executor, waiting + settle hook, History UI | M | F3 |
| L1-b | In-App scheduler (timezone, `next_run_at`, reaper), README/wizard copy | M | L1-a |
| L1-c | Stop/Cancel, overlap skip, rate caps, backoff, waiting TTL, late flag | S-M | L1-b, L3-c |
| **Track B: metering** | | | |
| L2-b | `llm_usage` + `usage_daily` + `MeteredChatClient` | M | F2, F3 |
| L2-d | Usage API + UI | M | L2-b |
| L2-e | Model catalog, per-bot / per-routine model | M | F2 |
| L2-f | Budgets + Genie kill switch + routine budget skip | M | L2-b, F4 |
| **Track C: live runs** | | | |
| L3-a | Detached runs, step events, async decide/choice, async webhook (202) | M | F3 |
| L3-b | SSE feed, tool activity rows, deployed proxy smoke (X1), architecture.md drift fix | M | L3-a |
| L3-c | Stop (AbortSignal, cross-instance flag, valid tool rows) | S | L3-a |

Spike L5-0 (no merge) can run during P1, so lane 5 is not blocked later.

### P2: trust, the lakehouse wedge, attachments

| ID | Item | Size | Depends on |
|---|---|---|---|
| L4-a…e | Auto Review: policy (S), reviewer (M), storage + integration (M), routes + UI (M), bundle + docs (S) | 2S + 3M | F1, F4, L2-b |
| L6-a | Audit coverage (routes, routines, attachments, pages) | S-M | F4 |
| L6-b | OTel tracer | M | F4, F2 |
| L6-c | UC export runbook (CDF), views, admin reconciliation pack | S-M | F4, L2-b |
| L6-d | Activity UI, export, audit retention | M | L6-a |
| L1-d | Opt-in app identity (`run_as='app'`, `data_scope`, runner SP) | M | L1-b, X6 |
| L5-a, L5-b | Trigger types + schema. Quiet runs (`routine_report`, collapse), which also work for schedules. | S + M | L1-a |
| L5-c | Probe gate | S-M | P0-4, L5-a |
| L5-d…g | Provisioner, poller + `dispatchEvent`, UI, outside-text hardening | 3M + S | L5-0, L1-b, L2-f, L4-c |
| L7-a…f | Attachments MVP: types/store (S), streaming (M), routes (M), UI (M), `read_attachment` (S), Library (S) | 3S + 3M | F1, P0-2 |
| L3-d, L3-e | Token streaming (M). Per-chat presence + roster feed (S-M). | M + S-M | L3-b, F2 |

**Gate for turning on event triggers (L5-e):** P0-4, L1-b, L2-f and L4-c have all merged.

### P3: Data Pages and polish

| ID | Item | Size | Depends on |
|---|---|---|---|
| L8-0…f | Data Pages v1: pins carry SQL (S), domain (M), tile runner (M), tools (M), routes (M), PageView (M), Library + Share (S-M) | S + 5M + S-M | F1 |
| L6-e | MLflow tracer (opt-in) | M | L6-b |
| L5-h, L5-i | Beta trigger kinds behind flags. Tool surface + seed skill. | M + S | L5-e |
| L3-f | Multi-instance fan-out + caps + `run_events` retention | S | L3-b, Q13 |
| L7 later | XLSX/PDF enrichment (M), hygiene / reserve / sweeps (M) | 2M | L7-f |

### P4: optional, later

L8-g…j Lakeview publish (L + M + S-M + S-M, after L8-f, L2-f and Q17) · lane 2 Gateway mode (M-L, X9) · lane 1 `owner_delegated` (L, Q1) · lane 7 materialize / strict mode / images (L) · lane 4 Jev adapter and evals · then Genie Agent F2, cost-gated by L2-f.

### Critical path

```text
P0-4 ─> F1 ─────────────────────────────> L4-a..c ─┐
F3 ─> L1-a ─> L1-b ─────────────────────────────────┼─> L5-d/e (event triggers on)
F2 ─> L2-b ─> L2-f ─────────────────────────────────┘
F3 ─> L3-a ─> L3-b / L3-c ─> L1-c
P0-3 ─> F4 ─> L6-*
F1 ─> L7-*  ,  F1 ─> L8-*
```

---

## 9. Open questions for the user

Recommendations are in the last column. Items marked **blocking** must be answered before their PR starts.

| # | Question | Blocks | Recommendation |
|---|---|---|---|
| Q1 | Build `owner_delegated` (custom OAuth app + stored refresh token, needs an account admin) so routines run unattended **as the owner**? | P4 | Not for OSS. Approval-supplies-OBO plus opt-in app identity is enough. |
| Q2 | Should **interactive** turns also fail closed when the OBO token is missing in prod? It can break installs where scopes were never consented. | F1 (**blocking**) | Yes, default deny, with `BRICKSBOT_INTERACTIVE_SP_FALLBACK=allow` as a legacy escape hatch and a setup-status warning. **Decided 2026-11-18: yes.** Shipped with P0 (`UserTokenRequiredError` in a deployed App; escape hatch logs a startup warning). |
| Q3 | Flip existing routines to `owner_approval` (secure, behavior change), or grandfather them as `app`? | P0-4 (**blocking**) | Flip, with a release note. **Decided 2026-11-18: yes, flip.** Release note below (§9.1). |
| Q4 | OK to add the Postgres schema `bricksbot_audit` (deviates from "durable state in `bricksbot`") so CDF exports only audit and usage? | F4 (**blocking**) | Yes, and update AGENTS.md. **Decided 2026-11-18: yes** (not P0). AGENTS.md now names `bricksbot_audit` for audit/usage. |
| Q5 | May a bot owner or Space admin see and pause routines that members created on their shared bot? See their prompts? Their usage and activity? | L1-c, L2-d, L6-d | Pause plus metadata (counts, tool, outcome) only. No prompts, no per-chat ids. |
| Q6 | Once the scheduler is on: auto-disable webhooks on schedule routines (to avoid double firing with already-deployed example Jobs), or only document it? | L1-b | Set `webhook_enabled=false` by default on schedule routines, and document it. |
| Q7 | Apply the "no `fast` model ids" rule to the end-user model catalog and the reviewer? | L2-e, L4-b | Yes, filter by default with a startup warning. |
| Q8 | OSS budget defaults (none/warn vs e.g. $5/user/day warn) and display currency (USD vs DBU)? | L2-f | Unset + warn. USD labelled "estimated", DBU in a tooltip. |
| Q9 | Waiting routine TTL: 24 h, or Grok's 30 min for background cards? | L1-c | 24 h, configurable. Event routines coalesce while waiting. |
| Q10 | Make `save_skill` / `remember` Ask-first after outside text or on unattended runs (Rakazo #5191)? This changes the AGENTS.md "meta tools auto-run" lock. | L4-c, L5-g | Keep the lock in v2. Revisit with audit data. |
| Q11 | Also ignore Always-allow for state-changing tools on **schedule** runs (v2 applies it to event runs only)? | L5-g | Event runs only for now. |
| Q12 | Default reviewer model (e.g. `databricks-gpt-5-4-nano` vs `databricks-gpt-6-luna` vs `databricks-gpt-oss-20b`; OpenRouter default for OSS)? | L4-b | Nano-class FMAPI endpoint. Confirm pricing first. |
| Q13 | Is multi-instance (horizontal scaling) a near-term need? | L3-f | No. Ship the in-process bus, keep L3-f in P3. |
| Q14 | Message retention (`BRICKSBOT_MESSAGE_RETENTION_DAYS`)? It changes the "transcript never deleted" principle. | none | Audit retention now (365 d). Message retention later, behind its own spec. |
| Q15 | Is Lakebase CDF (Public Preview, admin-enabled, billing undocumented) acceptable as the documented audit export, with a Job fallback? | L6-c | Yes, after confirming billing. |
| Q16 | Attachment isolation: app-enforced folders in a shared volume (same as `volume_write`), strict SP-only mode, or per-user volumes? | L7-c | Shared volume plus a documented caveat plus an optional separate attachments volume. |
| Q17 | Accept App-SP-owned Lakeview dashboards in an operator folder (user gets `CAN_MANAGE`), or wait for an Apps `dashboards` scope? | P4 | Accept, behind `BRICKSBOT_DASHBOARDS=off` by default. |
| Q18 | `job_completion` triggers (no jobs OBO scope to verify upstream visibility): Space admins only, an operator allowlist, or wait for GA? | L5-h | Operator allowlist of job ids. |
| Q19 | Add the dependency `croner` for timezone-aware cron? | L1-b | Yes. |
| Q20 | Steering while a run is active (Grok-style redirect vs queue), and Stop mid-text (keep the partial text marked "(stopped)" or discard it)? | L3-c | v1: refuse send while running. Keep the partial text, marked. |
| Q21 | Notifications beyond in-app (email or Slack via workspace notification destinations) for waiting or failed routines? | none | Later, owner-only, on wait or escalation. |
| Q22 | Can Space **viewers** open Space-visible Pages (tiles run with their own token)? | L8-d | Yes, read-only. |
| Q23 | Should quiet-run turns be excluded from LLM context in later turns (still shown collapsed)? | L5-b | Yes. Filtering context is not deleting the transcript. |

### 9.1 Release note: P0 security fixes (2026-11-18)

The repo keeps no CHANGELOG, so the note lives here.

- **Behavior change: routines no longer query data as the App service principal.** Every routine (existing ones included) now has `run_as='owner_approval'`. On scheduled and webhook runs, `sql_query`, `lakehouse_catalog`, `volume_read`, Genie / MCP and sandbox tools wait for the routine owner's approval, even when "Always allow" is on. The approval click supplies the owner's token. To keep the old SP behavior, set `BRICKSBOT_ROUTINE_APP_IDENTITY=allow` and set the routine's `runAs` to `app` (`PATCH /api/routines/:id`).
- **Behavior change: interactive chats in a deployed App no longer fall back to the SP** when the proxy omits `x-forwarded-access-token`. Data tools return a `no_user_token` error instead. Legacy escape hatch: `BRICKSBOT_INTERACTIVE_SP_FALLBACK=allow` (logged at startup).
- Routine **Test** runs as the person who clicks it.
- Routine tools on a shared bot act on the caller's own routines, not the bot owner's.
- The approval trail stores `argsDigest` + `argKeys` instead of raw tool arguments, scrubs raw arguments from existing rows, and is no longer deleted with the chat.
- The chat composer sends a `requestId`, so a replayed send runs once (the same `requestId` on another chat returns 409). The `genie_ask` card no longer offers "Always allow".

## 10. Unverified assumptions and spikes

| ID | Assumption | How to verify | Affects | When |
|---|---|---|---|---|
| X1 | Apps gateway cuts long requests at about 120 s (idle or absolute?). SSE passes the proxy without buffering or compression. Large uploads hit the same limit. | Deployed smoke: a 5 min SSE with 10 s heartbeats and a 90 s server close. A 100 MB upload. | L3-b, L7-b | L3-b |
| X2 | `jobs/runs/get` / `runs/list` return **resolved** `{{job.trigger.*}}` job-parameter values. A `condition_task`-only Job with a `tableUpdate` trigger is accepted and runs without compute. | Spike in dev (L5-0). Fallback: `trigger_info` plus `include_trigger_history`, or push. | L5 (blocking) | P1 (L5-0) |
| X3 | Whether the Job owner (App SP) needs SELECT / READ on watched tables and paths for triggers to evaluate. | L5-0 | L5 security posture | P1 |
| X4 | Whether `DESCRIBE TABLE` passes the `sql:restricted-query` OBO scope (lane 5 target checks). | L5-0 | L5-d | P1 |
| X5 | The job-completion trigger field name (absent from SDK v0.57). | L5-0 | L5-h | P1 |
| X6 | Who may read **another** principal's UC effective permissions, and whether OBO `catalog.*` scopes are enough. | Dev workspace test | L1-d | before L1-d |
| X7 | Lakebase autoscaling scale-to-zero idle timeout vs the scheduler's 300 s cap, and whether plpgsql triggers work on Lakebase. | Dev project metrics. `\d` + trigger test. | L1-b, F4 | P1 |
| X8 | Jobs `run_as` rules. Users can set themselves or an SP they hold `servicePrincipal.user` on; only admins can set another user. A Job that pings the App lands in App credentials anyway. Quoted from memory. | Re-read [jobs/privileges](https://docs.databricks.com/aws/en/jobs/privileges) | C1 rationale | before L5-d |
| X9 | Whether the `ai-gateway` OBO scope covers Unity Gateway model queries, or `model-serving` is also needed. The HTTP status of a Gateway budget block. | Dev test | Gateway mode | P4 |
| X10 | `read_files(format => 'excel')` support on the bound SQL warehouse channel. | Dev test | L7 later | P3 |
| X11 | Apps cannot request a `dashboards` scope. Whether `sql` covers `/api/2.0/lakeview/*`. Permission level names `CAN_READ` vs `CAN_VIEW`. The published dashboard URL pattern. SP folder rights. | Dev test + `/permissionLevels` | L8-g…i | P4 |
| X12 | App telemetry injects `OTEL_EXPORTER_OTLP_ENDPOINT` (which activates AppKit's exporter). The OTel / MLflow global-provider collision. | Deploy with telemetry on | L6-b, L6-e | P2 |
| X13 | Lakebase CDF billing, UUID mapping, and behavior for tables without `REPLICA IDENTITY FULL`. | Docs + dev | L6-c, Q15 | P2 |
| X14 | Files API upload creates parent directories (the shipped `volume_write` relies on it; docs suggest not). | Dev test, or always call `ensureVolumeDirectory` | L7-b | P2 |
| X15 | `files.files` is a working deprecated alias of `files`. | P0 smoke | All Volume features | P0 |
| X16 | Pricing: Genie (150 DBU/user/month free, SP billed from the first DBU, free for users until 2027-01-31), FMAPI per-token DBU rates. | Re-check before shipping UI copy | L2, L4 | P1–P2 |
| X17 | Whether Apps exposes a stable per-instance id env var (the design falls back to a random UUID). | Deploy | F3 | non-blocking |

## 11. Docs to update as phases land

- **P0:** `docs/specs/2026-11-02-approval-trail.md` (digests, no cascade). `server/chat/databricks-auth.ts` docblock. README release note on routine identity. AGENTS.md routine bullet ("routines run as the owner via approval by default; app identity is opt-in").
- **P1:** new specs per lane (`routine-engine-v2`, `usage-metering-budgets`, `detached-runs-sse`, `audit-and-tracing`). Supersede the non-goals in `docs/specs/2026-10-30-lakeflow-routine-job.md`. Mark "websocket / scaling" decided in `docs/project-context.md`. Fix `docs/architecture.md:54,69`. Update the stale Genie success checks and open questions in `docs/databricks-platform-integration-plan.md`. Update `docs/roadmap-next.md`.
- **P2:** `auto-review-lite` spec plus an AGENTS.md lock line ("Auto Review may only pass tools that could be Always-allowed; never-Always-allow, plugin-destructive and Genie tools always reach a human; the reviewer never denies"). Event-trigger spec plus setup docs (SP job entitlement, target grants). Attachments spec plus the volume isolation caveat. Tick Track B in `docs/agent-improvement-plan.md`. AGENTS.md: list the new tools (`routine_report`, `read_attachment`) and their approval rules.
- **P3/P4:** Data Pages spec. Lakeview publish runbook (folder grants, `embed_credentials=false`).
