# BricksBot

A multi-bot chat assistant that runs inside your Databricks workspace as a Databricks App. Bots query your lakehouse as the signed-in user, ask before they act, and keep their chats, memories and approvals in your own Lakebase.

[![CI](https://github.com/matheusbuniotto/bricksbot/actions/workflows/ci.yml/badge.svg)](https://github.com/matheusbuniotto/bricksbot/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

<p align="center">
  <img src="docs/assets/bricksbot-demo.gif" alt="BricksBot: Primary creates two teammate bots, hands a question to Taxi Analyst, which runs SQL on samples.nyctaxi.trips and replies with a table" width="880" />
</p>

## What it does

- **Bots in Spaces.** A Primary bot answers first and hands work to teammate bots (`handoff_to_bot`). Spaces let you share bots with viewers, members and admins.
- **Lakehouse tools.** `sql_query` (read-only), `lakehouse_catalog` and `volume_read` run On-Behalf-Of the signed-in user, so Unity Catalog grants, row filters and masks apply. `volume_write` and `web_fetch` are opt-in.
- **Approvals.** Data tools stop for **Always allow / Approve once / Deny** before they run. Decisions are recorded in Lakebase.
- **Durable state.** Chats, memories, skills and approvals live in Lakebase (schema `bricksbot`). Long chats are compacted for the model; the transcript is never deleted.
- **Routines.** A Lakeflow Job can send a prompt to a bot on a schedule.
- **Sandbox.** Optional Linux exec per chat, with artifacts saved to a Unity Catalog Volume.
- **Models.** Any OpenAI-compatible API (OpenRouter by default) or a Databricks Model Serving endpoint.

Not included: a desktop or browser-control UI, and always-on Genie (Genie is opt-in because it costs more).

## How it fits together

<p align="center">
  <img src="docs/assets/architecture.svg" alt="BricksBot architecture: the browser talks to a Databricks App whose bots call lakehouse tools as the signed-in user after an approval gate, with state in Lakebase, models from OpenRouter or Model Serving, and a Lakeflow Job triggering routines" width="880" />
</p>

Details: [docs/architecture.md](docs/architecture.md).

## Try it locally

No Databricks account needed. Without credentials it uses an in-memory store and a stub model.

```bash
git clone https://github.com/matheusbuniotto/bricksbot.git
cd bricksbot
npm ci
npm run dev
```

Open http://localhost:8000. To use a real model or Lakebase locally, copy `.env.example` to `.env` and fill it in.

## Deploy to a workspace

You need the Databricks CLI, a Lakebase project, a model (a Databricks Model Serving endpoint, or an OpenRouter API key) and, for SQL tools, a SQL warehouse.

### Quick setup

```bash
npm ci
npm run bootstrap -- -p <profile>
```

This picks (or creates) a Lakebase project and a SQL warehouse, then asks which model provider to use:

- **Databricks Model Serving** (the governed option). Pick a chat endpoint, such as a Foundation Model API one. No API key, no outbound allowlist: model calls stay in Databricks and bill on your existing contract.
- **OpenRouter.** Stores your key in secret scope `bricksbot`.

It writes `dev.local.yml`, enables the matching provider block in `databricks.yml` and `app.yaml` (re-run to switch) and validates the bundle. Then [deploy](#deploy).

### Manual setup

1. Copy `dev.local.yml.example` to `dev.local.yml` (gitignored) and set `lakebase_branch`, `lakebase_database` and `sql_warehouse_id`. List Lakebase projects with `databricks postgres list-projects -p <profile>`.
2. Pick a model provider. OpenRouter is the default; store the key:

   ```bash
   databricks secrets create-scope bricksbot -p <profile>
   databricks secrets put-secret bricksbot openrouter-api-key -p <profile>
   ```

   For Model Serving instead, set `serving_endpoint_name` in `dev.local.yml` (list chat endpoints with `databricks serving-endpoints list -p <profile>`). Then, in both `databricks.yml` and `app.yaml`, comment out the `llm:openrouter` block and uncomment the `llm:serving` block.

### Options

| Option | How |
| --- | --- |
| Model | OpenRouter: default `openai/gpt-6-luna`, change `LLM_MODEL` in `app.yaml`. Model Serving: the endpoint you picked (`serving_endpoint_name`). |
| Model choice | Set `BRICKSBOT_MODELS` to a JSON array of ids (or `{ "id", "label", "contextWindow", "inputUsdPerMTok", "outputUsdPerMTok" }`). Bot owners pick from it in Bot details; a routine owner may override it per routine. Unset means just `LLM_MODEL` (or the Serving endpoint). Ids containing `fast` are never offered. With Model Serving, an id is an endpoint name, and the App's service principal only gets `CAN_QUERY` on the one bound endpoint, so grant it on any others you list. Prices are only used to estimate cost when the provider reports none. |
| Usage ledger | Every LLM call (turns and compaction) is recorded in `bricksbot_audit.llm_usage` and rolled up per day in `bricksbot.usage_daily`, charged to the person chatting, not the bot owner. Costs are estimates. If the ledger is down, chats continue and routine runs fail. |
| Budgets | Unset by default: usage is recorded and shown (roster footer, gauge icon) but nothing limits it, and the server logs a warning at startup. Set `BRICKSBOT_BUDGET_USER_DAILY_USD`, `..._USER_MONTHLY_USD`, `..._BOT_DAILY_USD` or `..._BOT_MONTHLY_USD` in `app.yaml`; `BRICKSBOT_BUDGET_ACTION` is `warn` (default) or `block` (no model call is made once the cap is reached, and the chat gets a notice). People can add stricter limits of their own in the Usage dialog. Amounts are USD and **estimated**: Model Serving and Genie bill in DBU, so calls without a price are counted as $0 and flagged as unpriced. The check runs before each call, so calls already in flight can overshoot a cap slightly. |
| Usage views | Every person sees their own spend; a bot owner sees that bot's totals (Bot details) and a routine owner that routine's, as counts and money only, never names, chats or prompts. |
| Genie limits | `BRICKSBOT_GENIE_ENABLED=false` removes `ask_genie_space` without touching the space id. `BRICKSBOT_GENIE_DAILY_CALLS` caps calls per person per UTC day (default 50). |
| Model Serving instead of OpenRouter | Pick it in `npm run bootstrap` (it flips the `llm:` blocks in the tracked `databricks.yml` and `app.yaml`, and says so), or flip them by hand (see Manual setup). The App's service principal calls the endpoint, so people need no access to it. Use a chat endpoint that supports tool calling. |
| `web_fetch` | Store comma-separated hosts in secret `bricksbot/web-fetch-allowlist`, then uncomment it in `databricks.yml` and `app.yaml`. |
| `volume_write` | Create a Volume and set `BRICKSBOT_VOLUME_ROOT` in `app.yaml`. Files go under `users/{user}/bots/{bot}/`. |
| Chat attachments | On when `BRICKSBOT_VOLUME_ROOT` (or `BRICKSBOT_ATTACHMENT_VOLUME_ROOT`) is set and the App has a workspace host. Attach with the paperclip, drag and drop, or paste; files show as chips on the message, and Library > Uploads lists and deletes them. CSV, TSV, XLSX, XLS and PDF, up to 25 MiB each, 5 per message, 25 per chat, uploaded as the signed-in user (they need WRITE VOLUME) to `{root}/users/{user}/bots/{bot}/uploads/`, and counted against the Volume quotas. The bot reads CSV and TSV with the auto-run `read_attachment` tool and analyses any of them with `read_files()` through Ask-first `sql_query`. **Unity Catalog grants are per Volume, not per folder**, so anyone with READ VOLUME on that Volume can read everyone's uploads. Point `BRICKSBOT_ATTACHMENT_VOLUME_ROOT` at a Volume only the intended group can read. |
| MLflow tracing | Set `MLFLOW_EXPERIMENT_ID` in `app.yaml` and give the App service principal `CAN_EDIT` on the experiment. One trace per chat turn, with spans for LLM calls, tool calls (with approval outcome) and handoffs. Ids and names only, never message content. |
| Genie space | One curated Genie space as `ask_genie_space` (Ask-first, runs as the user, incurs Genie compute). Set `genie_space_id`, uncomment the `genie-space` resource, the `genie` scope in `databricks.yml` and `BRICKSBOT_GENIE_SPACE_ID` in `app.yaml`. Off and absent from the prompt until set. Users need `CAN_RUN` on the space. |
| Sandbox | On by default (`SANDBOX_BACKEND=databricks`). Set it to `off` to disable. |
| Second install | Set `app_name` in a separate target (see `dev.local.yml.example`). |

### Deploy

```bash
databricks bundle deploy -p <profile>
databricks bundle run app -p <profile>
databricks apps get bricksbot -p <profile>    # URL and status
```

Open the App URL and say hi to Primary. Logs: `databricks apps logs bricksbot -p <profile>`.

### Wiring a scheduled Job

The example Job (`resources/jobs/routine-webhook.job.yml`) deploys paused. To use it:

1. In the App, create a routine. Copy its routine id and the one-time webhook secret.
2. `databricks secrets put-secret bricksbot routine-webhook-key -p <profile>` and paste the secret.
3. In `dev.local.yml` set `routine_webhook_app_base_url` (the App URL), `routine_webhook_routine_id` and `routine_webhook_pause_status: UNPAUSED`. The schedule defaults to `0 0 9 * * ?` UTC (`routine_webhook_quartz_cron`, `routine_webhook_timezone_id`).
4. Give the Job's run-as identity `CAN_USE` on the App, then deploy again.
5. Turn the routine on. "Test" works while it is off; the webhook does not.

## FAQ

**Does my data leave Databricks?**
Only prompts and tool results sent to the model provider. If you pick Model Serving in `npm run bootstrap`, model calls stay on Databricks: no external key and no egress. With OpenRouter they go to OpenRouter. SQL runs on your warehouse and state stays in your Lakebase.

**Can a bot drop tables?**
Not through `sql_query`. It accepts one read-only statement (`SELECT`, `WITH`, `SHOW`, `DESCRIBE`, `EXPLAIN`) and runs as the user with the `sql:restricted-query` scope. It also asks for approval unless the user chose Always allow for that chat.

**Who can see my bots?**
You, plus anyone you share a Space with. Access is checked on every turn, so removing someone cuts them off right away.

More: [docs/security.md](docs/security.md) covers identities, scopes and the settings that widen access.

## Docs

- [Architecture](docs/architecture.md)
- [Security and trust model](docs/security.md)
- [Durable agent loop](docs/durable-harness.md)
- [Roadmap](docs/roadmap-next.md)
- [All docs](docs/README.md)
- [Contributing](CONTRIBUTING.md)

## License

[Apache-2.0](LICENSE)
