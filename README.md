# BricksBot

Greenfield Databricks App (AppKit, TypeScript, React) for a Grok Bot–style roster and transcript. This tree is not a Rakazo fork. There is no computer or sandbox runtime in the MVP.

Product locks and build order live in [docs/project-context.md](docs/project-context.md) and [docs/databricks-grokbot-marketplace-plan.md](docs/databricks-grokbot-marketplace-plan.md).

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
- UI: Routines panel (list / create / enable / Run now) + first-run install wizard when `provider === stub`
- Job stub only: `resources/jobs/routine-webhook.job.yml.stub` — workspace Job creation stays **manual** until App URL + per-routine secret are parameterized. Do not uncomment into `databricks.yml` until those values exist.

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

### Wiring a scheduled Job (manual)

1. Create a routine in the App and copy the one-time `webhookSecret`.
2. Create a Lakeflow Job (workspace UI or adapt the stub YAML) that POSTs to  
   `https://<app-url>/api/webhooks/routines/<routineId>`  
   with header `X-BricksBot-Webhook-Key: <secret>`.
3. Prefer storing the secret in scope `bricksbot` and reading it from the Job task — never commit it.

## Lakebase

Workspace project limit is 3, so the `dev` target reuses the clawhouse project with a dedicated branch:

- `projects/clawhouse/branches/bricksbot`
- database `…/databases/databricks-postgres`
- App-owned schema `bricksbot` (deploy before local Lakebase development)

Without `LAKEBASE_ENDPOINT` / `PGHOST`, the server falls back to an in-memory store so `npm run dev` still works.

## What is intentionally out

No computer/sandbox, no UC volume tools yet, no Marketplace PartnerOps listing push (Phase 4 ships routines + wizard only). `sql_query` is read-only and needs `DATABRICKS_WAREHOUSE_ID` plus `DATABRICKS_HOST` and `DATABRICKS_TOKEN`.
