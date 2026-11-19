# Security and trust model

What an operator grants when deploying BricksBot, which identity each action runs as, and which switches widen that. To report a vulnerability, see [SECURITY.md](../SECURITY.md).

## Identities

| Identity | Used for | Granted by the operator |
| --- | --- | --- |
| **Signed-in user (OBO)** | `sql_query`, `lakehouse_catalog`, `volume_read`, `volume_write`, Genie | `user_api_scopes` in `databricks.yml`: `sql:restricted-query`, `files.files`, `ai-gateway`, plus `genie` if you bind a Genie space |
| **App service principal** | Lakebase (schema `bricksbot`), reading bound secrets, warehouse `CAN_USE` | App resources in `databricks.yml` |
| **Job run-as** | Scheduled routine webhook | `CAN_USE` on the App (see README, "Wiring a scheduled Job") |

Data tools run as the user, so Unity Catalog grants, row filters and column masks apply as they would in a notebook. They never silently fall back to the App service principal (`server/chat/databricks-auth.ts`):

- **Interactive turns** fail with `no_user_token` when the Apps proxy does not forward the user's token.
- **Routine turns** have no user token. Data tools wait for the routine owner's approval, which supplies their token.

## Approvals

Every tool call is **Ask-first** unless it is one of:

- Meta tools (`remember`, `forget`, `list_memories`, `save_skill`, `activate_skill`, `read_skill_resource`), `list_routines`, `sandbox_stop`.
- A tool the user marked **Always allow** for that chat.

Never "Always allow": `create_bot`, `delete_routine`, `ask_choice`, `sandbox_delete`, `genie_ask`, `ask_genie_space`. Primary → teammate handoff auto-approves most teammate tools, but not sandbox tools, `volume_write`, MCP connector tools or Ask-first plugin tools. Each decision is recorded in Lakebase `bricksbot.approval_events` (a digest of the tool arguments, not the raw values).

## Guards on data tools

- `sql_query`: one read-only statement (`SELECT`, `WITH`, `SHOW`, `DESCRIBE`, `EXPLAIN`), mutating keywords inside `WITH` rejected, row and byte limits.
- `volume_write`: off until `BRICKSBOT_VOLUME_ROOT` is set; writes stay under `{root}/users/{user}/bots/{bot}/` with size and quota limits.
- `ask_genie_space`: off until `BRICKSBOT_GENIE_SPACE_ID` is set (bind the `genie-space` resource). One space, called as the signed-in user through the Genie Conversation API, so the user needs `CAN_RUN` on the space and Unity Catalog access to its data; there is no service principal fallback beyond the switches above. It costs Genie and warehouse compute, so the prompt tells bots to prefer `sql_query` and escalate only for business definitions or when asked. Routine turns wait for the owner's approval like other data tools.
- `web_fetch`: off until the `web-fetch-allowlist` secret is bound; HTTPS only, and redirects must stay on the allowlist.

## Switches that widen access

All default to off. Turn one on only if you accept what it does.

| Setting | Effect |
| --- | --- |
| `BRICKSBOT_INTERACTIVE_SP_FALLBACK=allow` | Interactive turns without a user token query data as the App service principal. |
| `BRICKSBOT_ROUTINE_APP_IDENTITY=allow` | Routines with `run_as='app'` query data as the App service principal, unattended. |
| `BRICKSBOT_PLUGIN_VOLUME` | Loads and **executes** plugin code from that Volume path. Anyone who can write there can run code as the App. |
| `SANDBOX_BACKEND` | On by default (`databricks`). Ask-first Linux exec per chat. Set `off` to disable. |

## Network egress

- The LLM provider (`openrouter.ai` by default). Use Databricks Model Serving (`LLM_PROVIDER=databricks`) to keep model traffic in your workspace.
- `web_fetch` hosts on your allowlist.
- The MLflow tracking server, only if you set `MLFLOW_EXPERIMENT_ID`. Traces are sent as the App service principal and hold chat, bot and tool ids, model, tool names, approval outcomes and counts. They never hold prompts, replies, tool arguments or results, because experiment permissions are not Space roles.
- Your Genie space, only if you set `BRICKSBOT_GENIE_SPACE_ID`: questions go to the workspace's Genie API.
- MCP connectors that a user adds.

## Sharing

Space roles are `viewer`, `member` and `admin`. Bot owners keep full control. Access is re-checked on every turn, so removing a member or unsharing a bot stops their chats and routines immediately.
