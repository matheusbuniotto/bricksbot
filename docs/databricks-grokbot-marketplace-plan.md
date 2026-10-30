# Databricks Apps Marketplace plan: Grok Bot–parity agent

**Audience:** product / architecture decision for BricksBot (Databricks Marketplace app that mirrors Grok Bot as closely as practical).  
**Method:** online research only (Firecrawl); no local repo inspection.  
**Primary sources:** [Designing Grok Bot](https://x.ai/news/designing-grok-bot), [Grok Bot overview](https://docs.x.ai/grok-bot/overview) (+ linked docs), [Pi Durable](https://earendil.com/posts/pi-durable/), [Rakazo](https://github.com/elie222/rakazo), Databricks Apps / Marketplace docs (cited inline).

---

## 0. Locked decisions (Matheus, Oct 28, 2026)

| Topic | Decision |
| --- | --- |
| **Codebase** | **Greenfield slim App** with a **high-fidelity Grok Bot–cloned UI** (roster, presence, transcript chrome). Steal patterns from Rakazo/Pi Durable; do **not** fork Rakazo as the Marketplace binary. |
| **Models** | **OpenAI-compatible** provider first (OpenRouter-like base URL + API key via Secret). **Databricks-native** Model Serving / Unity Gateway as a first-class install option. xAI is just another OpenAI-compatible endpoint if desired. |
| **Computer** | **Defer full cloud desktop.** MVP = lakehouse + web tools only. Phase 5 plugs a `SandboxProvider` (see §2.1 recommendation: Daytona free credits / E2B Desktop when paid; no free forever “Grok computer”). |
| **Marketplace** | **Plan call:** apply Data Partner Program now; ship **workspace-installable App** immediately; list on **public Marketplace Apps** when PartnerOps confirms App listing artifact. Do not block MVP on public listing. Private exchange is fine as interim distribution. |
| **Tenancy** | **User-level** ownership of Bots + **team sharing**. Organize with in-app **Spaces / folders** (project/team boundaries) inside one App install per Databricks workspace. Map Databricks groups → Space membership where possible. |

---

## 1. What Grok Bot is

### Product surface

Grok Bot is a **persistent-agent product**, not a chat-history product. The first-class objects are **Bots** (named teammates with identity, memory, runtime, and tools), not disposable threads ([design essay](https://x.ai/news/designing-grok-bot); [overview](https://docs.x.ai/grok-bot/overview)).

Five user-facing primitives ([design](https://x.ai/news/designing-grok-bot)):

| Primitive | Role |
| --- | --- |
| **Bots** | Persistent agents with name, avatar, memory, tools |
| **Chats** | Conversational interface to a Bot (or group) |
| **Prompts** | One-shot instructions, saved **Skills**, or scheduled/event **Routines** |
| **Tools** | Apps/connectors, shell, filesystem, computer use, MCP |
| **Artifacts** | Durable outputs (docs, code, data, drafts) |

Everything else (models, context windows, sandboxes) stays under the UI until the user needs it.

### UX model

- **Bot roster** in the sidebar (scan by avatar; pin / section / hide) instead of a long chat history ([design](https://x.ai/news/designing-grok-bot); [bots](https://docs.x.ai/grok-bot/bots)).
- **Presence:** avatar motion encodes idle / thinking / working / waiting / blocked / done; hover shows current action ([design](https://x.ai/news/designing-grok-bot)).
- **Their computer:** status → side preview → full-screen takeover; wallpaper reinforces “coworker’s desk,” not your remote desktop ([design](https://x.ai/news/designing-grok-bot); [computer](https://docs.x.ai/grok-bot/computer-and-apps)).
- **Heterogeneous transcript:** prose, inline widgets (e.g. email drafts), system events (routine created), tool progress ([design](https://x.ai/news/designing-grok-bot); [chat](https://docs.x.ai/grok-bot/chat-and-collaboration)).
- **Approvals by default** for outbound mail/Slack drafts; Secure Forms / Vault for secrets the model never sees ([chat](https://docs.x.ai/grok-bot/chat-and-collaboration); [computer](https://docs.x.ai/grok-bot/computer-and-apps)).
- Practical limits (~50 Bots/account, ~6/group) to keep delegation manageable ([design](https://x.ai/news/designing-grok-bot)).

### Channels / surfaces

| Channel | Behavior |
| --- | --- |
| Desktop | macOS / Windows / Linux apps ([overview](https://docs.x.ai/grok-bot/overview)) |
| Mobile | iOS / Android ([overview](https://docs.x.ai/grok-bot/overview)) |
| Voice | Dictate, voice memos, live voice chat ([chat](https://docs.x.ai/grok-bot/chat-and-collaboration)) |
| X | Tag [@bot](https://x.com/bot) → primary Bot picks up the post ([overview](https://docs.x.ai/grok-bot/overview)) |
| Event triggers | Slack / GitHub / Linear / Sentry / PagerDuty / email / webhooks via Routines ([skills & routines](https://docs.x.ai/grok-bot/skills-routines-and-automations)) |
| Shared Bots / templates | Team-shared live Bot vs publishable template copy ([shared bots](https://docs.x.ai/grok-bot/shared-bots); [bots](https://docs.x.ai/grok-bot/bots)) |

Work continues on the **cloud computer** when the laptop is closed ([overview](https://docs.x.ai/grok-bot/overview)).

### Agent loop (behavioral)

1. User (or Routine / peer Bot / webhook / @bot) submits a task with outcome + approval boundary.
2. Bot plans and calls tools: connected apps (OAuth tokens stay off the computer), browser/computer use, shell/files, MCP ([computer](https://docs.x.ai/grok-bot/computer-and-apps); [security](https://docs.x.ai/grok-bot/security)).
3. Progress streams into the transcript; avatar shows activity.
4. Risky / write / irreversible steps hit **Ask first** or **Auto Review** ([security](https://docs.x.ai/grok-bot/security)).
5. Human takeover for SSO / CAPTCHA / passkeys; then continue ([computer](https://docs.x.ai/grok-bot/computer-and-apps)).
6. Result lands as artifact + memory update; optional Skill / Routine capture ([skills & routines](https://docs.x.ai/grok-bot/skills-routines-and-automations)).

**Context boundaries:** tools & skills are account-wide; memory & routines are per-Bot; all Bots share one account computer (files, cookies, CLI creds)—isolation is **between users**, not between Bots ([overview](https://docs.x.ai/grok-bot/overview); [computer](https://docs.x.ai/grok-bot/computer-and-apps); [design](https://x.ai/news/designing-grok-bot)).

**Security shape (Cursor cloud):** app → Cursor servers (team policy) → per-member microVM computer + model providers (ZDR when Privacy Mode) + connector tools without tokens + Auto Review ([security](https://docs.x.ai/grok-bot/security)).

---

## 2. Architecture mapping: Grok Bot → Databricks

Goal: same *product semantics* inside a customer workspace via **Databricks Apps** + Lakehouse primitives ([Apps overview](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/); [key concepts](https://learn.microsoft.com/en-us/azure/databricks/dev-tools/databricks-apps/key-concepts); [Marketplace Apps announcement](https://www.databricks.com/blog/announcing-apps-databricks-marketplace)).

| Grok Bot concept | Databricks landing | Notes / unknowns |
| --- | --- | --- |
| Desktop/mobile client | **Databricks App** web UI (`https://<app>-<workspace-id>.<region>.databricksapps.com`) | Native Electron/iOS not Marketplace-native; optional thin clients later. Apps: Python/Node (Streamlit/Dash/Gradio/React/Express) ([Apps](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/)). |
| Cursor control plane | App process + **Lakebase** (managed Postgres) for sessions/transcripts/bot registry | Apps **lose in-memory & local FS on restart**—must externalize state ([key concepts](https://learn.microsoft.com/en-us/azure/databricks/dev-tools/databricks-apps/key-concepts)). Lakebase is an official App resource ([resources](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/resources)). |
| Bot identity + memory | Lakebase tables (+ optional UC tables/Volumes for exports) | Mirror “memory per Bot, capabilities per account/workspace.” |
| Shared cloud computer | **Deferred (locked).** MVP: no desktop. Later: pluggable `SandboxProvider` via Secret + egress (Daytona / E2B Desktop preferred). UC Volumes as durable “home” files without GUI. | No free forever Grok-class computer inside Apps; see §2.1. |
| Connected apps (Gmail/Slack…) | UC **Connections** resource + OAuth connectors where available; else MCP/OpenAPI via secrets | Tokens should stay server-side like Grok ([security](https://docs.x.ai/grok-bot/security)). |
| Model inference | **OpenAI-compatible** client (base URL + key Secret, OpenRouter-like) **or** Model Serving / **Unity Gateway** resource | Default path: BYO OpenAI-compatible. Databricks-native as install option ([resources](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/resources)). |
| Long-term / RAG memory | **AI Search (Vector Search) index** resource | For recall beyond transcript summaries ([resources](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/resources)). |
| Routines (schedule) | **Lakeflow Jobs** + App webhook receiver, or Graphile-style worker inside Lakebase | Jobs are first-class App resources. |
| Routines (events) | External webhooks → App HTTPS; UC/Jobs for lakehouse events | Slack/GitHub need egress + secrets; parity with Cursor account integrations is custom work. |
| Skills | Markdown/skill docs in UC Volume or Lakebase; injected as system sections | Same pattern as Pi Durable extensions ([Pi Durable](https://earendil.com/posts/pi-durable/)). |
| Approvals / Auto Review | App UI cards + optional second Model Serving call as reviewer | Policy stored in Lakebase; audit to UC / MLflow experiment resource. |
| AuthN/Z | **App SP** (`DATABRICKS_CLIENT_ID`/`SECRET`) + **user OAuth** (on-behalf-of) with scopes | Dual identity model ([auth](https://docs.databricks.com/gcp/en/dev-tools/databricks-apps/auth)). |
| Secrets / Vault | Databricks **Secret** scopes as App resources (`valueFrom` in `app.yaml`) | Scope-level perms; one scope per app ([secrets](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/secrets)). |
| Network policy | Workspace **NCC** + **network policies** (Enterprise) / SEG for Marketplace apps | Declare egress up front ([networking](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/networking); [Marketplace blog](https://www.databricks.com/blog/announcing-apps-databricks-marketplace)). |
| SQL / lakehouse tools | **SQL warehouse** + UC tables/volumes/functions as resources | Differentiator vs consumer Grok Bot: agents that are *data-native*. |
| Genie / Agent Bricks | Optional Genie Agent resource | NL analytics inside the app ([Marketplace blog](https://www.databricks.com/blog/announcing-apps-databricks-marketplace)). **Cost lock (2026-10-29):** Genie opt-in, not default — [databricks-platform-integration-plan.md](databricks-platform-integration-plan.md). |
| Billing compute | App instance size Medium/Large/XLarge (0.5 / 1 / 3 DBU/hr) + warehouse/serving usage | ([compute size](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/compute-size)). |

### Recommended reference architecture (MVP+)

```text
[User browser / Databricks SSO]
        │ OAuth user token + App SP
        ▼
[Databricks App: slim React UI (Grok-cloned) + agent API]
        │ durable harness (Pi Durable–style or equivalent)
        ├─ Lakebase ………… users, spaces/folders, bots, chats, tasks, memory, approvals
        ├─ LLM: OpenAI-compatible Secret  OR  Model Serving / Unity Gateway
        ├─ SQL Warehouse + UC tables/volumes
        ├─ AI Search index (memory/RAG)
        ├─ Lakeflow Jobs (routines)
        ├─ Secrets (LLM keys, connectors; later sandbox keys)
        └─ (phase 5) SandboxProvider via egress ──► Daytona / E2B Desktop / …
```

`app.yaml` drives command + `env`/`valueFrom` bindings ([app runtime](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/app-runtime)); resources configured at install/deploy ([resources](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/resources)).

### 2.1 Computer strategy — what’s easier / free?

**Verdict: defer full computer.** Nothing free gives Grok-like persistent desktop + takeover inside Databricks Apps. Cheapest credible path is **tool-only MVP now**, then a **BYO sandbox key** later.

| Option | Cost to start | Effort on Databricks Apps | Fits Grok “computer”? | Recommendation |
| --- | --- | --- | --- | --- |
| **No computer** — SQL/UC/Vector/`web_fetch` only | $0 beyond App DBUs | Lowest | No desktop; still useful lakehouse agent | **MVP default (locked)** |
| **In-app Playwright / browser-use** | $0 (App CPU) | Medium; Chromium in App env is **unknown**/fragile; weak isolation (shares App process) | Browse-only, no real desktop/takeover | Optional thin “browser tool” only if Apps system image allows Chromium; not a security boundary |
| **Daytona** hosted | Free compute credits (~$200 cited in 2026 comparisons); then ~$0.05/vCPU-h + $0.016/GiB-h ([Daytona pricing](https://www.daytona.io/pricing); [comparison](https://pinggy.io/blog/best_cloud_computers_for_ai_agents/)) | Medium: Secret + egress + SDK; Computer Use available | Closest paid path with good free runway | **Preferred Phase 5 default provider** |
| **E2B** (+ Desktop) | Hobby: **$100 one-time** credit, 20 concurrent, 1 h sessions; Pro $150/mo ([E2B pricing](https://e2b.dev/pricing)) | Medium; strongest agent-ecosystem SDKs; pause keeps memory | Yes (E2B Desktop) | Strong alt; use if team prefers E2B Desktop UX |
| **OpenComputer** | ~$10 free credit; Apache-2.0 self-host possible ([pinggy roundup](https://pinggy.io/blog/best_cloud_computers_for_ai_agents/)) | Hosted: easy SDK; self-host: **hard** (needs KVM workers outside Apps) | Partial (8 h hard ceiling on hosted v2) | Prototype only; self-host not Marketplace-friendly |
| **Self-host Docker / OpenComputer / E2B runtime on customer VMs** | Infra cost only | High ops; Apps call out via egress | Yes if customer runs it | Enterprise “BYOC computer” later—not MVP |
| **Boat / Modal / machine0 / Vercel Sandbox** | Paid / various free scraps | Similar integration cost | Varies | Keep behind same `SandboxProvider` interface; don’t pick now |

**Why not “free Docker inside the App”?** Databricks Apps run as managed serverless containers ([key concepts](https://learn.microsoft.com/en-us/azure/databricks/dev-tools/databricks-apps/key-concepts)). Public docs do **not** expose nested Docker/KVM for untrusted agent desktops. Treating the App itself as the computer collapses isolation (one App SP / one process for all users)—unacceptable for Marketplace.

**Phase 5 interface (design now, implement later):** `SandboxProvider` with provision / exec / files / observe / destroy (Rakazo [computer-runtime](https://github.com/elie222/rakazo/blob/main/docs/computer-runtime.md) shape). Consumer pastes provider API key into a Secret; egress allowlists provider domains at install.

---

## 3. Feature parity matrix

Legend: **P** = practical parity on Databricks Apps · **P\*** = parity with caveats · **G** = gap (needs external service or product decision) · **N** = out of Marketplace app scope / deferred

| Grok Bot capability | Databricks equivalent | Status | Gap notes |
| --- | --- | --- | --- |
| Named Bot roster + avatars | App UI + Lakebase | **P** | Presence animation is UI work |
| Per-Bot memory | Lakebase + optional Vector Search | **P** | |
| Shared account computer (desktop+browser) | No native App primitive | **G** | Phase-gate; tool-first MVP |
| Computer preview / takeover | Sandbox stream + App embed | **G** | Needs provider (Rakazo-style) |
| Connected SaaS apps | UC Connections / OAuth / MCP | **P\*** | Catalog breadth << Grok |
| Skills | Volume/Lakebase skill store | **P** | |
| Teach-by-demonstration | Computer recording | **G** | Depends on computer |
| Routines (cron) | Jobs + App worker | **P** | |
| Routines (Slack/GH/… events) | Custom webhooks + connectors | **P\*** | Build per integration |
| Webhooks | App HTTPS endpoint | **P** | Auth key in Secrets |
| Bot-to-Bot messaging / groups | Lakebase + agent tools | **P** | |
| Shared Bot / templates | UC share of config vs App ACL | **P\*** | Templates ≠ Marketplace listing |
| Voice chat / dictation | Browser WebSpeech / BYO TTS-STT Secret | **P\*** | Quality/cost TBD |
| Tag @bot on X | X API via Secret | **N**/optional | Regional/API credit constraints |
| Auto Review | Second model + policy engine | **P** | |
| Network allowlist | NCC / network policies | **P\*** | Enterprise tier for policies |
| Vault / Secure Form | Secrets + UI masked fields | **P\*** | No 1Password ecosystem out of box |
| Desktop/mobile native apps | Web-first | **N** | Post-MVP |
| Zero Data Retention contracts | Customer Model Serving / Gateway | **P\*** | xAI BYO is customer’s contract |
| Primary Bot / Chief of Staff routing | Product logic | **P** | |
| Inline draft widgets | App UI components | **P** | |
| Lakehouse-native tools (SQL, UC, Genie) | Native resources | **P** | **Beyond** Grok—strategic wedge |

---

## 4. Durable agent patterns (Pi Durable + Rakazo) → Databricks

### Pi Durable ([post](https://earendil.com/posts/pi-durable/))

Harness = **storage + parallel conversations + tools + execution env**. Portable lessons:

| Pattern | Meaning | Databricks landing |
| --- | --- | --- |
| Storage backends | Memory / SQLite / JSONL; small interface | **Lakebase** as source of truth (not App local disk) |
| Checkpointed tasks | Every model/tool/compaction step survives crash | Task rows + `resume()` on App boot / Job retry |
| `requestId` exactly-once | Client retries don’t double-submit | Idempotent submit keys in Lakebase |
| Conversation fork | Thread from transcript point | Fork metadata; share history by reference |
| Extensions | Prompt sections + tools + hooks + custom tasks | Registry in code; selection persisted by name |
| Tool `replay: safe \| none` | Crash recovery policy | Persist intent before execute; refuse replay for deploys/writes |
| Hooks / memos | Approvals that survive restart | Store approval decision on task before asking again |
| Ownership tree | Abort cascades; background vs foreground tasks | Model routines as background; turn work as foreground |
| Compaction | Background summarize; never delete history | Compaction Job + full transcript retained |
| Documents | App state co-committed with transcript | Lakebase docs (todos, plans) in same txn |
| Multiplayer watch | Many clients stream one conversation | App websockets / SSE over committed state |

**Implementation choice:** embed `@earendil-works/pi-durable` (or a thin compatible harness) inside the App/worker, with a **Postgres/Lakebase storage adapter**. Unknown: whether Pi Durable’s published adapters already include Postgres—plan for a small custom storage backend conforming to their interface ([Pi Durable](https://earendil.com/posts/pi-durable/)).

### Rakazo ([README](https://github.com/elie222/rakazo); [VISION](https://github.com/elie222/rakazo/blob/main/VISION.md); [computer-runtime](https://github.com/elie222/rakazo/blob/main/docs/computer-runtime.md))

Open-source Grok Bot alternative; useful as a **blueprint**, not necessarily as the Marketplace binary.

**High-level repo map:**

```text
apps/        web, api, worker, desktop, mobile, www
packages/    core, contracts, db, adapters, adapter-kit, auth,
             chat-ui, memory, logging, testkit, ui-tokens, …
infra/       compose, sandbox images, railway
docs/        self-host, computer-runtime, fleet-management, releases
```

Stack: TypeScript, React/Vite, Hono/oRPC, PostgreSQL/Prisma, Better Auth, Graphile Worker, **Pi**, Docker/E2B/Daytona/Boat/… sandboxes, Composio/Pipedream/MCP ([README](https://github.com/elie222/rakazo)).

**Patterns to port:**

- **Separate agent runtime from computer runtime** (`Pi session → computer tools → SandboxProvider`) ([computer-runtime](https://github.com/elie222/rakazo/blob/main/docs/computer-runtime.md)).
- **Portable home** checkpointed to object store / volume; disposable OS image ([computer-runtime](https://github.com/elie222/rakazo/blob/main/docs/computer-runtime.md)).
- **Team vs Private computers**; per-bot screen leases ([VISION](https://github.com/elie222/rakazo/blob/main/VISION.md)).
- **Approvals:** Never ask / Auto / Ask + Allow/Block lists ([VISION](https://github.com/elie222/rakazo/blob/main/VISION.md)).
- **Spaces** as auth boundaries; skills/MCP at account with availability ([VISION](https://github.com/elie222/rakazo/blob/main/VISION.md)).
- Worker for routines + RLS-style tenancy (Rakazo uses Postgres RLS).

**On Databricks:** App = `web+api`; **Jobs or long-lived App process** = worker; Lakebase = db; UC Volumes / object storage = AgentHomeStore; SandboxProvider behind egress Secrets. Shipping full Rakazo as the Marketplace container is possible in principle (closed-source packaging per [blog](https://www.databricks.com/blog/announcing-apps-databricks-marketplace)) but heavy vs a slim Pi Durable–based App—decision for Matheus (§7).

---

## 5. Marketplace packaging

### What “Apps on Marketplace” means today

From the [Public Preview announcement](https://www.databricks.com/blog/announcing-apps-databricks-marketplace):

1. Browse Marketplace → **Apps** category.
2. Admin installs; **reviews/authorizes resource bindings**.
3. App runs on **customer serverless** (data stays in workspace).
4. **Closed-source containers** by default (IP protected).
5. Egress declared and governed (SEG / network policy).
6. Native stack hooks: UC, SQL Warehouse, Lakebase, Model Serving, Genie, Agent Bricks.

Roadmap called out there (not all GA—treat as intent): bundled assets (jobs/notebooks), provider analytics, monetization.

**Provider path (plan call):**

1. Apply to the [Data Partner Program](https://docs.databricks.com/aws/en/marketplace/become-provider) (`Databricks Data Provider`) immediately so Provider console unlocks.
2. Ship MVP as a **normal Databricks App** installable in a workspace (Git/workspace deploy)—this is the real product artifact regardless of Marketplace.
3. For distribution before public Apps listing is fully documented: use **private exchange** and/or share the deployable App package with design partners.
4. Escalate to `partnerops@databricks.com` for the **Apps-on-Marketplace listing artifact** (closed-source container + resource bindings per [blog](https://www.databricks.com/blog/announcing-apps-databricks-marketplace)). Classic [create listing](https://docs.databricks.com/aws/en/marketplace/create-listing) docs still emphasize OpenSharing **data** shares—do not assume that flow alone publishes an App.

Do **not** block product build on step 4.

### App shape (implementation)

| Piece | Recommendation |
| --- | --- |
| Runtime | Node.js (React UI + agent API) **or** Python FastAPI + React static; hybrid OK if `package.json` present ([deploy](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/deploy)) |
| Manifest | `app.yaml` with `command` + `env`/`valueFrom` ([runtime](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/app-runtime)) |
| Deps | `package.json` + lockfile and/or `requirements.txt` / `uv.lock` |
| Instance size | Start **Large** (agent concurrency); scale to XLarge or [horizontal scaling](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/horizontal-scaling) if needed ([sizes](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/compute-size)) |
| State | **Required:** Lakebase resource. Never rely on container FS. |
| Declared resources (install-time) | Lakebase, SQL warehouse, Model Serving and/or Unity Gateway, Secret scope(s), UC volume, optional AI Search index, optional Job(s), optional Genie |

### Install UX (consumer admin)

1. Marketplace → find BricksBot → Install.
2. Bind resources: Lakebase, warehouse, optional Vector Search / volume / Job; **either** Serving/Gateway **or** Secrets for `LLM_BASE_URL` + `LLM_API_KEY`.
3. Authorize OAuth scopes for user-auth paths ([auth](https://docs.databricks.com/gcp/en/dev-tools/databricks-apps/auth)).
4. Approve egress domains (LLM host, later connectors/sandbox).
5. Grant `CAN_USE` to users/groups ([key concepts](https://learn.microsoft.com/en-us/azure/databricks/dev-tools/databricks-apps/key-concepts)).
6. First-run wizard: create Primary Bot + first Space/folder, pick LLM mode, invite teammates.

### Config: models (locked)

| Mode | Config | Role |
| --- | --- | --- |
| **OpenAI-compatible (primary)** | Secrets: `LLM_BASE_URL`, `LLM_API_KEY`, optional `LLM_MODEL` | OpenRouter-like or any `/v1/chat/completions` host (incl. xAI if OpenAI-compatible) |
| **Databricks-native (install option)** | Model Serving / Unity Gateway resource via `valueFrom` | Customer wants inference on-platform + UC governance |

Install wizard: pick provider → either bind Serving endpoint **or** enter base URL + key into a dedicated secret scope. App code uses one internal `ChatClient` interface. Never hardcode endpoint IDs ([resources](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/resources)).

### Permissions

- **App SP:** Lakebase connect, Job run, Serving query, Volume R/W, Secret read, warehouse use as needed for *shared* ops (logging, compaction jobs).
- **User OAuth:** UC table/volume access for user-scoped lakehouse tools (row filters/masks apply) ([auth](https://docs.databricks.com/gcp/en/dev-tools/databricks-apps/auth)).
- **Do not** put PATs in code; use injected `DATABRICKS_CLIENT_ID`/`SECRET` ([auth](https://docs.databricks.com/gcp/en/dev-tools/databricks-apps/auth)).
- Forwarded user tokens are **workspace-scoped**—multi-workspace warehouses need SP M2M or deploy app where the warehouse lives ([auth](https://docs.databricks.com/gcp/en/dev-tools/databricks-apps/auth)).

### Tenancy & sharing (locked)

One **Databricks App install per workspace**. Inside the App:

| Layer | Meaning |
| --- | --- |
| **User** | Owns personal Bots, private memory, private skills; Databricks user identity via OAuth |
| **Space / folder** | Team or project boundary (like Grok sections / Rakazo spaces). Shared Bots, shared skills, optional shared connector grants |
| **Team sharing** | Invite by Databricks group or user → Space membership (`viewer` / `member` / `admin`) |
| **Workspace** | Hard outer boundary: separate Lakebase + App SP; no cross-workspace Bot DB in MVP |

Capabilities (OpenAI-compatible keys, sandbox keys) default to **account/user or Space**, not duplicated per Bot—same Grok rule: capabilities shared, context per Bot ([design](https://x.ai/news/designing-grok-bot)).

### Egress allowlists (document for admins)

Publish an install checklist of domains the App may need under [network policies](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/networking) / SEG:

- Always: `*.databricksapps.com`, PyPI/npm build hosts as required by Databricks ([networking](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/networking))
- If OpenAI-compatible: customer’s `LLM_BASE_URL` host (e.g. `openrouter.ai`, `api.x.ai`, …)
- If connectors: per-provider OAuth/API hosts
- If Phase 5 sandbox: Daytona / E2B (or chosen provider) API + screen endpoints

### Multi-workspace considerations

- One App instance **per workspace** (URL embeds `workspace-id`).
- Shared metastore: UC objects can span; **App identity and Lakebase do not**—separate Bot databases per workspace in MVP.
- CI/CD: Git-backed deploy + Declarative Automation Bundles for staging→prod ([deploy](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/deploy)).

---

## 6. MVP vs full 1:1 scope, build order

### MVP (Marketplace-credible “Grok Bot for the Lakehouse”)

Slim App + **cloned Grok UI**, durable and data-native, **no cloud desktop**:

1. High-fidelity UI: Bot roster, avatars/presence, chat transcript, approval cards, Spaces/folders sidebar.
2. Durable harness on Lakebase (Pi Durable patterns: tasks, checkpoints, compaction, documents).
3. `ChatClient`: OpenAI-compatible (primary) + Databricks Serving/Gateway option.
4. Tools: SQL warehouse, UC volume R/W, Vector Search, allowlisted `web_fetch`; **optional Genie** (Ask-first / install-bound — not default; see [databricks-platform-integration-plan.md](databricks-platform-integration-plan.md)).
5. Per-Bot memory; user-owned Bots; Space sharing for team Bots/skills.
6. Routines via Lakeflow Job → App webhook (cron first).
7. Bot-to-Bot message + Primary Bot router.
8. Install wizard (LLM + resource bindings) + Partner Program application; public listing when ready.
9. Audit log to UC / MLflow.

**Explicitly out of MVP:** graphical computer/takeover, teach-by-demo, native mobile/desktop, X @bot, full SaaS catalog, 1Password, voice realtime.

### Full 1:1 track (after MVP)

1. `SandboxProvider` (Daytona first / E2B Desktop alt; later BYOC Docker) + portable home on UC Volume.
2. Screen preview + takeover in App iframe.
3. Connector pack + Auto Review; egress checklist per connector.
4. Event-driven routines; webhook key rotation UI.
5. Shared Bot templates + richer Space admin.
6. Voice (BYO STT/TTS).
7. Compliance narrative + SEG presets.
8. Optional native clients.

### Recommended build order

| Phase | Deliverable | Why first |
| --- | --- | --- |
| **0** | Partner apply + App skeleton (`app.yaml`, resources) | Distribution path |
| **1** | Cloned UI shell + Lakebase + one-Bot durable chat | Looks like Grok; survives restart |
| **2** | OpenAI-compatible + DBX model options; SQL/UC/Vector tools; approvals | Wedge + flexible LLMs |
| **3** | Multi-Bot, Spaces/folders, sharing, skills, Primary Bot | Team product |
| **4** | Jobs routines + install wizard + private/public listing push | MVP ship |
| **5** | SandboxProvider (Daytona/E2B) | Computer parity |
| **6** | Connectors + voice | Breadth |

---

## 7. Remaining open items

Resolved items are in **§0**. Still open:

1. **Pi Durable vs thin internal harness** — accept experimental Pi Durable API churn, or ~minimal custom harness with the same checkpoint semantics?
2. **Horizontal scaling / websockets** — single App instance first vs sticky multi-instance for streaming ([horizontal scaling](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/horizontal-scaling))?
3. **Who files PartnerOps** — owner for `partnerops@databricks.com` / Data Partner application?
4. **Phase 5 provider pick** — lock Daytona vs E2B when computer epic starts (recommend Daytona free credits → E2B if Desktop UX wins)?
5. **Success metric** — UX clone fidelity vs lakehouse capability matrix %?
6. **Chromium-in-App** — verify whether Databricks Apps system image allows a bounded Playwright tool without a sandbox (optional; not a security boundary).

---

## Source index

- https://x.ai/news/designing-grok-bot  
- https://docs.x.ai/grok-bot/overview (+ bots, computer-and-apps, skills-routines-and-automations, chat-and-collaboration, security, teams-and-enterprises, shared-bots)  
- https://earendil.com/posts/pi-durable/  
- https://github.com/elie222/rakazo (+ VISION.md, docs/computer-runtime.md, README)  
- https://www.databricks.com/blog/announcing-apps-databricks-marketplace  
- https://docs.databricks.com/aws/en/dev-tools/databricks-apps/ (+ app-runtime, deploy, secrets, resources, compute-size, networking)  
- https://docs.databricks.com/gcp/en/dev-tools/databricks-apps/auth  
- https://learn.microsoft.com/en-us/azure/databricks/dev-tools/databricks-apps/key-concepts  
- https://docs.databricks.com/aws/en/marketplace/become-provider  
- https://docs.databricks.com/aws/en/marketplace/create-listing  
- https://e2b.dev/pricing · https://www.daytona.io/pricing · https://pinggy.io/blog/best_cloud_computers_for_ai_agents/ · https://tech-insider.org/e2b-vs-modal-vs-daytona-2026/

*Research retrieved online via Firecrawl, Oct 28, 2026. Decisions in §0 locked from Matheus answers the same day. APIs or Marketplace App-listing steps not evidenced in docs remain marked unknown.*
