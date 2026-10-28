# Databricks + agent skills research for BricksBot

**Audience:** Matheus / BricksBot Project  
**Scope:** Online-only (Firecrawl); no local repos.  
**Context:** Slim greenfield Databricks App; OpenAI-compatible primary + Databricks Model Serving option; no computer in MVP.  
**As of:** 2026-10-28 (America/Sao_Paulo)

---

## 1. Tooling map (what exists)

| Tool | What it is | Primary links |
| --- | --- | --- |
| **Databricks CLI** | Auth profiles, `apps`, `bundle`, `aitools`, workspace sync. Need **v1.0.0+** for `aitools`; Apps+DAB tutorials cite **≥0.250.0**. | [CLI docs](https://docs.databricks.com/aws/en/dev-tools/cli/) · [aitools ref](https://docs.databricks.com/aws/en/dev-tools/cli/reference/aitools-commands) |
| **Declarative Automation Bundles (DABs)** | IaC for Apps, Jobs, Lakebase, serving, UC resources. `bundle deploy` / `bundle run`. Formerly “Asset Bundles.” | [Bundles](https://docs.databricks.com/aws/en/dev-tools/bundles/) · [Apps in a bundle](https://docs.databricks.com/aws/en/dev-tools/bundles/apps-tutorial) |
| **Databricks Apps** | Serverless workspace apps (Python or Node). `app.yaml`, resources, OAuth, Lakebase, Serving, SQL. AppKit (TS+React) is the recommended greenfield path. | [Apps](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/) · [app-templates](https://github.com/databricks/app-templates) · [apps cookbook / GHA](https://github.com/databricks-solutions/databricks-apps-cookbook) |
| **SDK Python** | Workspace APIs: Apps, Jobs, Serving, UC, secrets, SQL. | [SDK Python](https://docs.databricks.com/aws/en/dev-tools/sdk-python) · [ReadTheDocs](https://databricks-sdk-py.readthedocs.io/) |
| **SDK JS/TS** | Same surface for Node/AppKit backends. | [SDK JavaScript](https://docs.databricks.com/aws/en/dev-tools/sdk-javascript) |
| **Databricks Connect** | Local Spark/DataFrame against remote compute. Strong for notebooks/ETL; **weak fit** for App UI/agent harness MVP. | [Connect](https://docs.databricks.com/aws/en/dev-tools/databricks-connect/) |
| **IDE extension (VS Code / Cursor)** | Auth, bundle UI, run/debug via Connect, sync. Officially supports **Cursor**. | [IDE extension](https://docs.databricks.com/aws/en/dev-tools/vscode-ext/) · [Marketplace](https://marketplace.visualstudio.com/items?itemName=databricks.databricks) |
| **Databricks AI Tools (agent skills)** | Official Agent Skills (`SKILL.md`) for Claude/Cursor/Codex/Copilot. Installed via CLI or plugin marketplace. | [Docs](https://docs.databricks.com/aws/en/agent-skills/) · [GitHub](https://github.com/databricks/databricks-agent-skills) · [Cursor plugin](https://cursor.com/marketplace/databricks) · [Claude plugin](https://claude.com/plugins/databricks) |
| **AI Dev Kit** | Field kit: installer → delegates to `aitools`; still owns **Builder App**, **tools-core**, **standalone MCP**. Bundled skills **deprecated** (moved to official repo). | [ai-dev-kit](https://github.com/databricks-solutions/ai-dev-kit) |
| **Managed MCP (`system.ai.*`)** | Hosted UC/Unity Gateway MCP: Genie One, DBSQL, sandbox, web search, Slack/GitHub/etc. | [Built-in MCPs](https://docs.databricks.com/aws/en/agents/mcp-tools/built-in-mcp-services) · [Coding agents](https://docs.databricks.com/aws/en/ai-gateway/coding-agent-supported-agents) |
| **MLflow skills** | Agent eval / tracing skills (separate repo; AI Dev Kit installer can pull). | [mlflow/skills](https://github.com/mlflow/skills) |
| **App template skills** | Per-template skills inside `databricks/app-templates` (quickstart, deploy, modify-agent, …). | [app-templates](https://github.com/databricks/app-templates) |

---

## 2. Day-to-day: how each helps BricksBot

| Concern | Use |
| --- | --- |
| **Local App develop** | CLI auth + `databricks apps` / sync; AppKit or FastAPI+React template; IDE extension for profile/workspace. Skills: `databricks-apps`, `databricks-app-design`, `databricks-core`. |
| **Package / deploy** | `app.yaml` + DAB `resources.apps`; `databricks bundle deploy` then `bundle run <app>` (creates app, deploys code, starts). GHA cookbook for CI/CD. Skill: `databricks-dabs`. |
| **Auth** | CLI OAuth/PAT profiles; App OAuth for end users; service principal for CI. Skills + Cursor hooks (`/databricks-setup`, `/databricks-doctor`) reduce auth thrash. |
| **Lakebase** | Postgres OLTP resource on the App (bots, chats, memory, spaces). Bundle/schema workflows exist. Skill: `databricks-lakebase`. Blog: [Lakebase + Apps](https://www.databricks.com/blog/how-use-lakebase-transactional-data-layer-databricks-apps). |
| **Model Serving** | Optional Databricks-native LLM path (Unity Gateway / serving endpoints). Skill: `databricks-model-serving`. App runtime still calls OpenAI-compatible URL for OpenRouter-like primary. |
| **Jobs** | Routines / scheduled prompts later → Lakeflow Jobs via DAB. Skill: `databricks-jobs`. Not MVP-critical day one. |
| **Unity Catalog** | Secrets, volumes, lineage, governed MCP. Skills: `databricks-unity-catalog`, `databricks-unity-gateway`. |
| **Agent coding loop** | Skills = knowledge; managed MCP = live SQL/Genie/tools. Prefer **skills first**, add MCP when workspace data must be queried from Cursor. |

**Databricks Connect:** skip for MVP App shell unless you add heavy Spark-side tools.

---

## 3. Skills to adopt first (ranked for BricksBot MVP)

Install path (pick one):

```bash
# Preferred: CLI (latest + selectable)
databricks aitools install
# or slim:
databricks aitools install --skills databricks-core,databricks-apps,databricks-dabs,databricks-lakebase,databricks-model-serving,databricks-python-sdk

# Or Cursor marketplace (skills + setup/doctor commands + hooks/rules)
/add-plugin databricks
```

AI Dev Kit installer still fine as onboarding wrapper (uninstalls old skills/MCP first):

```bash
bash <(curl -sL https://raw.githubusercontent.com/databricks-solutions/ai-dev-kit/main/install.sh)
```

| Rank | Skill / pack | Why for MVP |
| --- | ---: | --- |
| **1** | **`databricks-core`** | Auth, profiles, CLI — parent of everything. |
| **2** | **`databricks-apps`** (+ **`databricks-app-design`**) | AppKit TS+React greenfield; UX patterns for chat/data surfaces. |
| **3** | **`databricks-dabs`** | Repeatable App (+ later Lakebase/Jobs) deploy. |
| **4** | **`databricks-lakebase`** | Bot/chat/memory persistence layer. |
| **5** | **`databricks-model-serving`** | Second model path (Serving / Gateway). |
| **6** | **`databricks-python-sdk`** (and/or JS SDK docs) | Workspace API calls from App/backend. |
| **7** | **Cursor Databricks plugin** | `/databricks-setup`, `/databricks-doctor`, routing rule — even if skills also installed via CLI. |
| **8** | **Managed MCP** `system.ai.dbsql` / Genie One | Only when agents need live workspace SQL from the IDE. |
| **9** | **`databricks-jobs`**, **`databricks-unity-gateway`**, **MLflow skills** | Phase 2+: routines, governed models, eval. |
| **Defer** | AI Dev Kit **standalone MCP** (40+ tools) | Prefer managed MCP; keep as fallback if you need custom tool surface. |
| **Defer** | **`databricks-apps-python`**, Connect, pipelines, vector search | Not default greenfield; use if you deliberately pick Streamlit/Dash or RAG indexes. |
| **Avoid** | Old **AI Dev Kit bundled skills** / retired `databricks-ai-dev-kit` plugin | Deprecated; conflicts with official names (`databricks-bundles` → `databricks-dabs`, etc.). |

**App templates worth cloning patterns from:** [databricks/app-templates](https://github.com/databricks/app-templates) (AppKit serving, agent kits, Lakebase kit) — not as product fork, as deploy/auth/resource examples.

---

## 4. Links cheat sheet (skills / MCP / marketplaces)

### Official skills & plugins
- Docs: https://docs.databricks.com/aws/en/agent-skills/
- Repo: https://github.com/databricks/databricks-agent-skills
- Cursor marketplace: https://cursor.com/marketplace/databricks (`/add-plugin databricks`)
- Claude marketplace: https://claude.com/plugins/databricks
- Agent Skills standard: https://agentskills.io/
- Skills CLI (third-party GitHub skills): https://github.com/vercel-labs/skills

### AI Dev Kit (installer + extras; skills moved)
- https://github.com/databricks-solutions/ai-dev-kit  
  - Skills → now via `databricks aitools` / official repo  
  - Still useful: `install.sh`, Builder App, `databricks-tools-core`, `databricks-mcp-server/`  
  - Rename table: `databricks-bundles`→`databricks-dabs`, lakebase skills merged, `databricks-config`→`databricks-core`

### MCP
- Managed: https://docs.databricks.com/aws/en/agents/mcp-tools/built-in-mcp-services  
- Wire Cursor/Claude: https://docs.databricks.com/aws/en/ai-gateway/coding-agent-supported-agents  
- Custom host / auth: https://docs.databricks.com/aws/en/agents/mcp-tools/  
- Field MCP (best-effort): https://github.com/databricks-solutions/ai-dev-kit/tree/main/databricks-mcp-server

### Apps / DAB / IDE / SDKs
- Apps: https://docs.databricks.com/aws/en/dev-tools/databricks-apps/
- Apps + DAB tutorial: https://docs.databricks.com/aws/en/dev-tools/bundles/apps-tutorial
- Apps CI/CD: https://docs.databricks.com/aws/en/dev-tools/databricks-apps/cicd-github-actions
- Lakebase resource on App: https://learn.microsoft.com/en-us/azure/databricks/dev-tools/databricks-apps/lakebase
- IDE ext: https://docs.databricks.com/aws/en/dev-tools/vscode-ext/
- Cursor+DBX walkthrough (community): https://dustinvannoy.com/2025/09/29/cursor-with-databricks-ai-enhanced-development/

---

## 5. Gaps — custom Project skills / workflows to write

Official packs cover **platform** well; they do **not** cover BricksBot product shape. Worth authoring Project skills (or Cursor rules) for:

| Gap | Custom skill / workflow |
| --- | --- |
| **OpenAI-compatible + Serving dual path** | Skill: env/secrets for OpenRouter-like base URL vs Databricks Serving; feature flag; no xAI hard-code. |
| **Grok Bot–like App UX** | Skill: roster/presence/transcript chrome constraints; AppKit component mapping; “no computer in MVP.” |
| **Lakebase schema for Bots/Spaces** | Skill: tables for bots, chats, memories, spaces, sharing; migration via DAB/Alembic. |
| **Marketplace / PartnerOps install** | Checklist skill: egress allowlists, required secrets, UC grants, App resources (Lakebase, Serving, SQL). |
| **Agent harness choice** | Skill: Pi Durable vs thin loop decision; tool interface contracts without Daytona/E2B yet. |
| **Deploy recipe** | Project workflow: `bundle validate` → deploy → smoke URL; profile naming `dev`/`prod`. |
| **Tenancy mapping** | Skill: Databricks groups → Space membership; user-owned bots. |

Do **not** reinvent `databricks-apps` / `databricks-dabs` / `databricks-lakebase` — compose them.

---

## Top 5 recommendations for Matheus

1. **Install official AI Tools today** — `databricks aitools install` (CLI ≥1.0) **or** Cursor `/add-plugin databricks`; uninstall any old AI Dev Kit skill copies first.  
2. **Prioritize five skills:** `databricks-core` → `databricks-apps` (+ `app-design`) → `databricks-dabs` → `databricks-lakebase` → `databricks-model-serving`.  
3. **Greenfield on AppKit (TS+React)** with DAB deploy; use [app-templates](https://github.com/databricks/app-templates) as reference only — not a product fork.  
4. **Treat AI Dev Kit as onboarding + optional Builder/MCP**, not the skill source of truth ([ai-dev-kit](https://github.com/databricks-solutions/ai-dev-kit) explicitly hands skills to engineering-owned AI Tools).  
5. **Write 2–3 BricksBot Project skills next** (dual LLM path, Lakebase bot schema, Marketplace install/egress) — biggest leverage gap vs official packs; defer Connect, Jobs, and managed MCP until needed.
