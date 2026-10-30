# BricksBot

Greenfield Databricks App (AppKit, TypeScript, React) for a Grok Bot–style roster and transcript. This tree is not a Rakazo fork. Optional Phase 5 sandbox execution is **off by default** (`SANDBOX_BACKEND=off`).

Product locks: [docs/project-context.md](docs/project-context.md). Research plan: [docs/databricks-grokbot-marketplace-plan.md](docs/databricks-grokbot-marketplace-plan.md). **What’s left for open-source community share:** [docs/oss-community-release.md](docs/oss-community-release.md) · next actions: [docs/roadmap-next.md](docs/roadmap-next.md).

## Prerequisites

- Node.js 22+ and npm
- [Databricks CLI](https://docs.databricks.com/aws/en/dev-tools/cli/install) 1.0.0 or newer

Auth uses the existing `dev` profile on this machine (`~/.databrickscfg`). Confirm it:

```bash
databricks -v
databricks current-user me -p dev
```

## Local development

```bash
npm ci
npm run dev
```

The dev server prints its URL (default port 8000). Copy `.env.example` to `.env` if you need to override the profile or port. `.env` is gitignored.

## Deploy

The bundle target `dev` is the default. It deploys the App named `bricksbot` to the workspace on the `dev` profile. Lakebase is not bound yet.

```bash
databricks bundle validate -p dev
databricks bundle deploy -p dev
databricks bundle run app -p dev
```

`bundle run app` starts the app resource declared in `databricks.yml`. Equivalent one-shot deploy-and-start:

```bash
databricks apps deploy -p dev
```

After a deploy, status and logs:

```bash
databricks apps get bricksbot -p dev
databricks apps logs bricksbot -p dev
```

Stopped apps can be started again without a redeploy:

```bash
databricks apps start bricksbot -p dev
```

## Phase 1–3 — Spaces, multi-bot, durable chat, dual ChatClient

- Grok-style shell: Spaces chips, bot roster, presence (incl. thinking/working), transcript, composer, approval cards
- API: Spaces CRUD/members, `GET/POST /api/bots`, chat + approvals
- Thin harness on Lakebase schema `bricksbot` (Personal space + Primary bot bootstrap)
- `ChatClient`: OpenAI-compatible (primary) or Databricks Serving; stub if unset
## Tooling & Approvals (Native Lakehouse)

- **3-Way Approvals**:
  - `All the time (Sempre permitir)`: Approves this execution and automatically approves future calls to this tool in the chat.
  - `Once (Apenas desta vez)`: Approves only the single execution.
  - `Not approve (Não aprovar)`: Denies the tool call and notifies the model.
  - Keyboard shortcuts on approval cards: `A` / `1` (All the time), `B` / `2` (Once), `C` / `3` / `Escape` (Not approve).
  - Auto-approval management: active auto-approved tools are displayed in the chat header with quick-revoke controls (`DELETE /api/chats/:chatId/approvals/auto/:toolName`).
- **Native Lakehouse Tools**:
  - `sql_query`: Single read-only SQL statements (SELECT, WITH, SHOW, DESCRIBE, EXPLAIN) on Databricks SQL Warehouses.
  - `lakehouse_catalog`: Direct exploration of Unity Catalog catalogs, schemas, tables, and column metadata.
  - `volume_read`: Read file contents or list directories in Unity Catalog Volumes (`/Volumes/...`).
  - `web_fetch`: Fetch allowlisted HTTPS URLs with automatic HTML text extraction and script stripping.
  - `handoff_to_bot`: Primary bot delegation to teammates in the same Space.
- **Transcript Tool Visibility**: Tool executions are surfaced directly in the chat transcript with collapsible details blocks for inspecting outputs and error diagnostics.

```bash
npm test
```

## Phase 4 — Routines + thin install wizard

- Lakebase table `bricksbot.routines` (id, bot, cron, prompt, webhook key hash, enabled, lastRunAt)
- API:
  - `GET/POST /api/routines`
  - `PATCH /api/routines/:id` or `POST /api/routines/:id/update` (enable toggle / edits)
  - `POST /api/routines/:id/run` (manual → system note + prompt via ChatService)
  - `POST /api/webhooks/routines/:routineId` with header `X-BricksBot-Webhook-Key` (or `Authorization: Bearer`)
  - `GET /api/setup/status` (provider, Lakebase flag, put-secret examples; never invents secret values)
- UI: Routines panel (list / create / enable / Test) + first-run install wizard when `provider === stub`
- Bundle Job [`resources/jobs/routine-webhook.job.yml`](resources/jobs/routine-webhook.job.yml) POSTs to the routine webhook on a Quartz schedule (parameterized via `databricks.yml` variables).

### LLM secrets (workspace deploy)

Dev target reuses the **same OpenRouter secret as clawhouse**:

| Secret scope | Secret key            | Env var               |
| ------------ | --------------------- | --------------------- |
| `claw`       | `openrouter-api-key`  | `OPENROUTER_API_KEY`  |

`app.yaml` sets `LLM_BASE_URL` / `LLM_MODEL` to the clawhouse OpenRouter defaults; the server maps `OPENROUTER_API_KEY` → the internal OpenAI-compatible client.

Optional BricksBot-only scope **`bricksbot`**:

| Secret key            | Env var               |
| --------------------- | --------------------- |
| `web-fetch-allowlist` | `WEB_FETCH_ALLOWLIST` |

```bash
# Usually already set for clawhouse:
databricks secrets put-secret claw openrouter-api-key --string-value 'YOUR_KEY' -p dev
databricks bundle deploy -p dev && databricks bundle run app -p dev
```

Missing `openrouter-api-key` keeps the stub ChatClient. Local `npm run dev` can use `.env` (`OPENROUTER_API_KEY` or `LLM_API_KEY`; see `.env.example`). The install wizard surfaces the same scope/key when the stub provider is active.

### Wiring a scheduled Job

Scheduled runs use a **Lakeflow Job** → `POST /api/webhooks/routines/:routineId`. The App stores Unix 5-field cron on the routine row for display only; the Job uses **Quartz** (`routine_webhook_quartz_cron`). Keep them aligned manually.

| Bundle variable | Purpose | Default |
| --- | --- | --- |
| `routine_webhook_app_base_url` | App origin, no trailing slash | `""` (required before Job runs) |
| `routine_webhook_routine_id` | Routine UUID from trust banner / list | `""` |
| `routine_webhook_secret_scope` | Scope for webhook secret | `${var.app_secret_scope}` → `bricksbot` |
| `routine_webhook_secret_key` | Secret key name | `routine-webhook-key` |
| `routine_webhook_quartz_cron` | Job schedule (Quartz 6-field) | `0 0 9 * * ?` (↔ routine `0 9 * * *`) |
| `routine_webhook_timezone_id` | Job timezone | `America/Sao_Paulo` |

**Apps ingress note:** Databricks Apps reject anonymous POSTs (HTTP 401 `{}`). The Job script sends **OAuth M2M** (`Authorization: Bearer`) plus the routine shared secret (`x-bricksbot-webhook-key` / `body.webhookKey`). Store a service principal’s client credentials in the same secret scope (SP needs **CAN_USE** on the App and **READ** on the scope):

```bash
databricks secrets put-secret bricksbot apps-oauth-client-id --string-value '<sp-application-id>' -p dev
databricks secrets put-secret bricksbot apps-oauth-client-secret --string-value '<sp-oauth-secret>' -p dev
```

Job resource uses **serverless** (`environment_key`); classic `new_cluster` is rejected in serverless-only workspaces.

**Checklist**

1. Deploy the App; open **Detalhes → Routines** and **Add** a routine (copy the one-time `webhookSecret`, routine id, and webhook URL from the trust banner).
2. Store the webhook secret (never commit it):

   ```bash
   databricks secrets put-secret bricksbot routine-webhook-key --string-value '<paste webhookSecret>' -p dev
   ```

3. Store Apps OAuth M2M client id/secret (above) and grant the SP **CAN_USE** on App `bricksbot`.
4. Discover the App URL: `databricks apps get bricksbot -p dev` → `url` field.
5. Set bundle variables on the `dev` target (do not commit workspace-specific values). Either add a gitignored `dev.local.yml` (see `dev.local.yml.example`) with `include` from your fork, or pass at deploy time:

   ```bash
   databricks bundle deploy -p dev \
     --var routine_webhook_app_base_url=https://bricksbot-1234567890123456.us-west-2.databricksapps.com \
     --var routine_webhook_routine_id=<routine-uuid>
   ```

6. Deploy bundle (creates/updates Job `bricksbot_routine_webhook`):

   ```bash
   databricks bundle deploy -p dev
   ```

7. Toggle routine **On** in the UI. **Test** (`POST /api/routines/:id/run`) still works when **Off**; the webhook returns **403** when disabled.

8. **Run now** on the Job once. Expect HTTP **201** and a `[routine:name] scheduled run` note in bot chat. Empty `routine_webhook_app_base_url` / `routine_webhook_routine_id` makes the ping script fail fast with a clear error.

**Job identity:** the run-as principal needs **READ** on the secret scope (webhook + optional M2M keys) and HTTPS egress to the App URL. Prefer M2M SP with **CAN_USE** on the App.

**Manual curl** (needs a user/SP OAuth token — Apps reject anonymous POSTs):

```bash
TOKEN=$(databricks auth token -p dev -o json | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')
curl -sS -X POST "$APP_URL/api/webhooks/routines/$ROUTINE_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"webhookKey\":\"$SECRET\"}"
```

Job task script: [`scripts/ping_routine_webhook.py`](scripts/ping_routine_webhook.py). Resource: [`resources/jobs/routine-webhook.job.yml`](resources/jobs/routine-webhook.job.yml).

## Lakebase

Workspace project limit is 3, so the `dev` target reuses the clawhouse project with a dedicated branch:

- `projects/clawhouse/branches/bricksbot`
- database `…/databases/databricks-postgres`
- App-owned schema `bricksbot` (deploy before local Lakebase development)

Without `LAKEBASE_ENDPOINT` / `PGHOST`, the server falls back to an in-memory store so `npm run dev` still works.

## Phase 4+ trust UI (shipped)

- Bot details sheet: **Details** (routines) | **Library** (artifact pins) | **Computer** (sandbox status when enabled)
- Presence: `waiting` (approvals) and `blocked` (choice cards)
- `ask_choice` Ask-first picker → transcript “Sua resposta”
- Routine trust: human cron copy, webhook secret banner, **Test** run

## Phase 5 sandbox (optional, off by default)

Isolated Linux exec for bots. Spec: [docs/specs/2026-10-30-phase5-sandbox-execution.md](docs/specs/2026-10-30-phase5-sandbox-execution.md).

| Var | Meaning |
| --- | --- |
| `SANDBOX_BACKEND` | `off` (default) \| `databricks` \| `python_exec` \| `e2b` |
| `SANDBOX_IDLE_MINUTES` | Idle reaper (default `15`) |
| `SANDBOX_EXEC_TIMEOUT_SEC` | Per-command timeout (default `120`) |
| `SANDBOX_MAX_SESSION_MINUTES` | Hard max session age (default `120`) |
| `SANDBOX_MAX_ACTIVE_PER_USER` | Concurrent sandboxes per user (default `3`) |
| `SANDBOX_ARTIFACT_VOLUME_PATH` | Default UC Volume root for `sandbox_save_artifact` |
| `E2B_API_KEY` / `E2B_DOMAIN` | Required when `SANDBOX_BACKEND=e2b` |

**Beta caveats:** Databricks Sandboxes is Public Beta (workspace Previews opt-in, regional). If the API is unavailable, the Databricks backend may fall back to `system.ai.python_exec` and the session is labeled accordingly. Prefer syncing artifacts out before delete. Egress is governed by workspace Serverless Egress Control / E2B account policy (`SANDBOX_EGRESS_ALLOWLIST` is reserved, not enforced in-app).

## What is intentionally out

No desktop/browser “computer” UI, no `volume_write` / Vector Search yet, no Genie by default (opt-in later), no PartnerOps Marketplace Apps listing required for OSS share. `sql_query` is read-only and needs `DATABRICKS_WAREHOUSE_ID` plus `DATABRICKS_HOST` and `DATABRICKS_TOKEN`. `volume_read` is available when UC Volumes are reachable.
