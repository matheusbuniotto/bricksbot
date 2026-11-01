# BricksBot

BricksBot is a new Databricks App (AppKit, TypeScript, React) with a Grok Bot-style bot roster and transcript. It is not a Rakazo fork. Sandbox execution (phase 5) is on by default: `app.yaml` sets `SANDBOX_BACKEND=databricks`. If the Sandboxes preview is unavailable, it falls back to `system.ai.python_exec`. Set `off` to disable it.

Product locks: [docs/project-context.md](docs/project-context.md). Research plan: [docs/databricks-grokbot-marketplace-plan.md](docs/databricks-grokbot-marketplace-plan.md). Remaining work for the open-source release is in [docs/oss-community-release.md](docs/oss-community-release.md). Next actions are in [docs/roadmap-next.md](docs/roadmap-next.md).

## Prerequisites

- Node.js 22+ and npm
- [Databricks CLI](https://docs.databricks.com/aws/en/dev-tools/cli/install) 1.0.0 or newer

Auth uses the `dev` profile in `~/.databrickscfg`. Check it with:

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

`bundle run app` starts the app resource declared in `databricks.yml`. To deploy and start in one command:

```bash
databricks apps deploy -p dev
```

To see status and logs after a deploy:

```bash
databricks apps get bricksbot -p dev
databricks apps logs bricksbot -p dev
```

To restart a stopped app without redeploying:

```bash
databricks apps start bricksbot -p dev
```

## Phases 1 to 3: Spaces, multi-bot, durable chat, dual ChatClient

- Grok-style shell with Space chips, bot roster, presence (including thinking and working), transcript, composer, and approval cards
- API: Spaces CRUD/members, `GET/POST /api/bots`, chat + approvals
- Thin harness on Lakebase schema `bricksbot` (Personal space + Primary bot bootstrap)
- `ChatClient`: OpenAI-compatible (primary) or Databricks Serving; stub if unset

## Tooling and approvals

Approvals have three options:

- `All the time (Sempre permitir)` approves this call and every later call to the tool in the chat.
- `Once (Apenas desta vez)` approves only this call.
- `Not approve (Não aprovar)` denies the call and tells the model.

Approval cards have keyboard shortcuts: `A` or `1` (all the time), `B` or `2` (once), `C`, `3`, or `Escape` (not approve). The chat header lists auto-approved tools, each with a revoke control (`DELETE /api/chats/:chatId/approvals/auto/:toolName`).

Lakehouse tools:

- `sql_query` runs one read-only SQL statement (SELECT, WITH, SHOW, DESCRIBE, EXPLAIN) on a Databricks SQL Warehouse, as the signed-in user when Apps user authorization is enabled.
- `lakehouse_catalog` lists Unity Catalog catalogs, schemas, tables, and column metadata (same warehouse + OBO auth).
- `volume_read` reads a file or lists a directory in a Unity Catalog Volume (`/Volumes/...`).
- `web_fetch` fetches allowlisted HTTPS URLs, extracts the HTML text, and strips scripts.
- `handoff_to_bot` lets the Primary bot delegate to teammates in the same Space.

The transcript shows each tool call with a collapsible block for its output and errors.

```bash
npm test
```

## Phase 4: Routines and install wizard

- Lakebase table `bricksbot.routines` (id, bot, cron, prompt, webhook key hash, enabled, lastRunAt)
- API:
  - `GET/POST /api/routines`
  - `PATCH /api/routines/:id` or `POST /api/routines/:id/update` (enable toggle and edits)
  - `POST /api/routines/:id/run` (manual run: adds a system note and sends the prompt through ChatService)
  - `POST /api/webhooks/routines/:routineId` with header `X-BricksBot-Webhook-Key` (or `Authorization: Bearer`)
  - `GET /api/setup/status` (provider, Lakebase flag, put-secret examples; never invents secret values)
- UI: Routines panel (list, create, enable, Test) + first-run install wizard when `provider === stub`
- Bundle Job [`resources/jobs/routine-webhook.job.yml`](resources/jobs/routine-webhook.job.yml) POSTs to the routine webhook on a Quartz schedule (parameterized via `databricks.yml` variables).

### LLM secrets (workspace deploy)

The `dev` target reads the OpenRouter key from a workspace secret:

| Secret scope | Secret key            | Env var               |
| ------------ | --------------------- | --------------------- |
| `claw`       | `openrouter-api-key`  | `OPENROUTER_API_KEY`  |

`app.yaml` sets `LLM_BASE_URL` / `LLM_MODEL` to OpenRouter defaults; the server passes `OPENROUTER_API_KEY` to the internal OpenAI-compatible client.

The optional `bricksbot` scope holds BricksBot-only secrets:

| Secret key            | Env var               |
| --------------------- | --------------------- |
| `web-fetch-allowlist` | `WEB_FETCH_ALLOWLIST` |

```bash
databricks secrets put-secret claw openrouter-api-key --string-value 'YOUR_KEY' -p dev
databricks bundle deploy -p dev && databricks bundle run app -p dev
```

Missing `openrouter-api-key` keeps the stub ChatClient. Local `npm run dev` can use `.env` (`OPENROUTER_API_KEY` or `LLM_API_KEY`; see `.env.example`). The install wizard surfaces the same scope/key when the stub provider is active.

### Wiring a scheduled Job

A Lakeflow Job runs each schedule and calls `POST /api/webhooks/routines/:routineId`. The App stores a Unix 5-field cron on the routine row for display only. The Job uses Quartz (`routine_webhook_quartz_cron`). Keep the two in sync by hand.

| Bundle variable | Purpose | Default |
| --- | --- | --- |
| `routine_webhook_app_base_url` | App origin, no trailing slash | `""` (required before Job runs) |
| `routine_webhook_routine_id` | Routine UUID from trust banner / list | `""` |
| `routine_webhook_secret_scope` | Scope for webhook secret | `${var.app_secret_scope}` → `bricksbot` |
| `routine_webhook_secret_key` | Secret key name | `routine-webhook-key` |
| `routine_webhook_quartz_cron` | Job schedule (Quartz 6-field) | `0 0 9 * * ?` (matches routine `0 9 * * *`) |
| `routine_webhook_timezone_id` | Job timezone | `America/Sao_Paulo` |

Databricks Apps reject anonymous POSTs (HTTP 401 `{}`). The Job script sends an OAuth M2M token (`Authorization: Bearer`) and the routine shared secret (`x-bricksbot-webhook-key` or `body.webhookKey`). Store a service principal's client credentials in the same secret scope. The service principal needs CAN_USE on the App and READ on the scope:

```bash
databricks secrets put-secret bricksbot apps-oauth-client-id --string-value '<sp-application-id>' -p dev
databricks secrets put-secret bricksbot apps-oauth-client-secret --string-value '<sp-oauth-secret>' -p dev
```

The Job resource uses serverless compute (`environment_key`). Serverless-only workspaces reject classic `new_cluster`.

Checklist:

1. Deploy the App; open Detalhes, then Routines, and click Add. Copy the one-time `webhookSecret`, the routine id, and the webhook URL from the trust banner.
2. Store the webhook secret (never commit it):

   ```bash
   databricks secrets put-secret bricksbot routine-webhook-key --string-value '<paste webhookSecret>' -p dev
   ```

3. Store Apps OAuth M2M client id/secret (above) and grant the service principal CAN_USE on the App `bricksbot`.
4. Get the App URL from the `url` field of `databricks apps get bricksbot -p dev`.
5. Set bundle variables on the `dev` target without committing workspace-specific values. Either add a gitignored `dev.local.yml` (see `dev.local.yml.example`) with `include` from your fork, or pass at deploy time:

   ```bash
   databricks bundle deploy -p dev \
     --var routine_webhook_app_base_url=https://bricksbot-1234567890123456.us-west-2.databricksapps.com \
     --var routine_webhook_routine_id=<routine-uuid>
   ```

6. Deploy bundle (creates or updates the Job `bricksbot_routine_webhook`):

   ```bash
   databricks bundle deploy -p dev
   ```

7. Turn the routine on in the UI. Test (`POST /api/routines/:id/run`) works while the routine is off. The webhook returns 403 when it is off.

8. Click Run now on the Job once. Expect HTTP 201 and a `[routine:name] scheduled run` note in the bot chat. If `routine_webhook_app_base_url` or `routine_webhook_routine_id` is empty, the ping script fails immediately with an error.

The Job's run-as principal needs READ on the secret scope (webhook key and optional M2M keys) and HTTPS egress to the App URL. Use an M2M service principal with CAN_USE on the App.

To call the webhook manually with curl, use a user or service principal OAuth token:

```bash
TOKEN=$(databricks auth token -p dev -o json | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')
curl -sS -X POST "$APP_URL/api/webhooks/routines/$ROUTINE_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"webhookKey\":\"$SECRET\"}"
```

Job task script: [`scripts/ping_routine_webhook.py`](scripts/ping_routine_webhook.py). Resource: [`resources/jobs/routine-webhook.job.yml`](resources/jobs/routine-webhook.job.yml).

## Lakebase

The workspace allows 3 projects, so the `dev` target reuses the clawhouse project with a dedicated branch:

- `projects/clawhouse/branches/bricksbot`
- database `…/databases/databricks-postgres`
- App-owned schema `bricksbot` (deploy before developing locally against Lakebase)

Without `LAKEBASE_ENDPOINT` / `PGHOST`, the server falls back to an in-memory store so `npm run dev` works without Lakebase.

## Trust UI (shipped)

- Bot details sheet: Details (routines), Library (artifact pins), and Computer (sandbox status, when enabled)
- Presence: `waiting` (approvals) and `blocked` (choice cards)
- `ask_choice` is an Ask-first picker. The chosen answer appears in the transcript as "Sua resposta"
- Routine trust: plain-language cron text, webhook secret banner, and a Test run

## Phase 5 sandbox

Bots can run commands in an isolated Linux sandbox. Spec: [docs/specs/2026-10-30-phase5-sandbox-execution.md](docs/specs/2026-10-30-phase5-sandbox-execution.md). Deployed `app.yaml` sets `SANDBOX_BACKEND=databricks`.

| Var | Meaning |
| --- | --- |
| `SANDBOX_BACKEND` | `databricks` (deploy default) \| `python_exec` \| `e2b` \| `off` |
| `SANDBOX_IDLE_MINUTES` | Idle reaper (default `15`) |
| `SANDBOX_EXEC_TIMEOUT_SEC` | Per-command timeout (default `120`) |
| `SANDBOX_MAX_SESSION_MINUTES` | Hard max session age (default `120`) |
| `SANDBOX_MAX_ACTIVE_PER_USER` | Concurrent sandboxes per user (default `3`) |
| `SANDBOX_ARTIFACT_VOLUME_PATH` | Default UC Volume root for `sandbox_save_artifact` |
| `E2B_API_KEY` / `E2B_DOMAIN` | Required when `SANDBOX_BACKEND=e2b` |

Beta caveats: Databricks Sandboxes is in Public Beta. It is regional, and a workspace admin must opt in to the preview. If the API is unavailable, the Databricks backend may fall back to `system.ai.python_exec`, and the session is labeled accordingly. Sync artifacts out before you delete a sandbox. Workspace Serverless Egress Control or the E2B account policy governs egress. The app does not enforce `SANDBOX_EGRESS_ALLOWLIST`, which is reserved.

## Out of scope

The project has no desktop or browser "computer" UI, no `volume_write` or Vector Search yet, and no Genie by default (opt-in later). The OSS release does not require a PartnerOps Marketplace Apps listing. `sql_query` is read-only: bind a `sql-warehouse` resource (injects `DATABRICKS_WAREHOUSE_ID`) and declare `user_api_scopes: [sql:restricted-query, ai-gateway]` so interactive queries run as the signed-in user (UC grants apply). If no warehouse is bound, it falls back to governed `system.ai.dbsql`. Locally set `DATABRICKS_WAREHOUSE_ID` plus `DATABRICKS_HOST` and a PAT or app SP credentials. `volume_read` is available when UC Volumes are reachable.

## License and contributing

BricksBot uses the Apache-2.0 license, see [LICENSE](LICENSE). For contributions, see [CONTRIBUTING.md](CONTRIBUTING.md).
