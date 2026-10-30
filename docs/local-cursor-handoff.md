# Local Cursor handoff, BricksBot

**For:** Matheus working in local Cursor (machine + workspace)  
**From:** cloud research agents (BB-1 plan, BB-2 skills research)  
**Date:** 2026-10-28 (America/Sao_Paulo)  
**Updated:** 2026-10-30, Phase 0 to 4 product core + trust UI shipped; next = OSS community share ([oss-community-release.md](oss-community-release.md)).  
**Original goal:** bootstrap local toolchain + greenfield App skeleton; do **not** re-research product strategy.

---

## Paste this into a new local Cursor Agent chat

```text
You are continuing BricksBot — a slim greenfield Databricks Marketplace App that clones Grok Bot UX (roster, presence, transcript), NOT a Rakazo fork.

Read these Project docs first (in order):
1. docs/project-context.md
2. docs/databricks-grokbot-marketplace-plan.md (§0 locked decisions + §6 MVP/build order)
3. docs/databricks-dev-skills-research.md
4. This handoff: docs/local-cursor-handoff.md

Locked:
- OpenAI-compatible LLM primary (OpenRouter-like); Databricks Model Serving optional
- No persistent computer in MVP (Daytona later)
- AppKit TypeScript + React greenfield; DAB for deploy
- Lakebase for bots/chats/memory/spaces

Your job this session (Phase 0 → start of Phase 1):
1. Install Databricks CLI ≥1.0 + auth a profile
2. Install official Databricks AI Tools (Cursor plugin and/or `databricks aitools install`)
3. Scaffold a greenfield AppKit app + DAB (reference databricks/app-templates; do not fork as product)
4. Wire app.yaml + minimal Lakebase resource stub
5. Document deploy commands in README

Do not: fork Rakazo; add computer/sandbox; invent custom Databricks platform skills that duplicate official ones.
```

---

## Canonical docs (Project store)

| Doc | Path |
| --- | --- |
| Context / locks | `docs/project-context.md` |
| Full product plan | `docs/databricks-grokbot-marketplace-plan.md` |
| OSS community share | `docs/oss-community-release.md` |
| Next must-do | `docs/roadmap-next.md` |
| Skills / tooling research | `docs/databricks-dev-skills-research.md` |
| This handoff | `docs/local-cursor-handoff.md` |

Preferences (already set): greenfield + Grok UI clone; OpenAI-compatible default; defer computer.

---

## Local setup checklist (do first)

### 1. CLI + auth
- [ ] Install/update [Databricks CLI](https://docs.databricks.com/aws/en/dev-tools/cli/install) **≥ 1.0.0** (`databricks -v`)
- [ ] `databricks auth login --profile bricksbot-dev` (or reuse DEFAULT)
- [ ] Confirm workspace reachability: `databricks current-user me -p bricksbot-dev`

### 2. Cursor Databricks plugin + skills
- [ ] In Cursor: `/add-plugin databricks`  
  **or** `databricks aitools install` (CLI is source of truth for latest skills)
- [ ] If you previously installed AI Dev Kit skills: uninstall old copies first  
  (`bash <(curl -sL https://raw.githubusercontent.com/databricks-solutions/ai-dev-kit/main/install.sh) --uninstall` then reinstall official)
- [ ] Prefer these skills loaded: `databricks-core`, `databricks-apps`, `databricks-app-design`, `databricks-dabs`, `databricks-lakebase`, `databricks-model-serving`
- [ ] Optional: IDE extension [Databricks for VS Code/Cursor](https://marketplace.visualstudio.com/items?itemName=databricks.databricks)
- [ ] Skip Databricks Connect for MVP App shell
- [ ] Skip managed MCP until you need live SQL/Genie from the IDE

### 3. Repo bootstrap (greenfield)
- [ ] New private git repo (empty), **not** a clone of Rakazo as the product tree
- [ ] Create via AppKit path (follow `databricks-apps` skill / [app-templates](https://github.com/databricks/app-templates) as **reference**)
- [ ] Add Declarative Automation Bundle with an `apps` resource ([tutorial](https://docs.databricks.com/aws/en/dev-tools/bundles/apps-tutorial))
- [ ] Minimal `app.yaml` + README with: `databricks bundle validate|deploy|run`
- [ ] Stub Lakebase as App resource (schema for bots/chats can land next session)

Suggested first commit message: `chore: scaffold BricksBot AppKit + DAB skeleton`

---

## Build order reminder (do not jump ahead)

| Phase | Focus | Local now? |
| --- | --- | --- |
| **0** | Partner apply + App skeleton | **Yes, this handoff** |
| **1** | Grok-like UI shell + Lakebase + one-Bot durable chat | Next local session |
| **2** | Dual ChatClient + SQL/UC tools + approvals | After 1 |
| **3 to 4** | Multi-Bot, Spaces, Jobs routines, install wizard | Later |
| **5** | Computer (Daytona) | Explicitly out |

MVP **out**: graphical computer, mobile/desktop clients, X @bot, full connector catalog.

---

## Custom Project skills to author locally (after scaffold)

Official packs cover platform; write thin Project skills under the repo (e.g. `.cursor/skills/` or Project `docs/skills/`):

1. **`bricksbot-llm-paths`**, OpenAI-compatible env/secrets vs Databricks Serving flag  
2. **`bricksbot-lakebase-schema`**, bots, chats, memories, spaces, sharing  
3. **`bricksbot-marketplace-install`**, egress allowlist, secrets, UC grants, App resources  

Do not reinvent `databricks-apps` / `databricks-dabs` / `databricks-lakebase`.

---

## Open decisions (do not block Phase 0)

- Pi Durable vs thin harness  
- License for public GitHub (see oss-community-release)  
- Websocket / horizontal scaling  
- Phase 5 Daytona vs E2B (lean Daytona when the time comes)  
- PartnerOps Apps listing, optional after OSS v0

---

## Done when (this local session)

1. CLI authenticated to a real workspace profile  
2. Databricks Cursor plugin or `aitools` skills installed  
3. Greenfield AppKit + DAB repo builds/validates locally  
4. README has deploy steps; Lakebase stub present or ticketed  
5. No Rakazo product fork; no computer runtime code  

---

## Links (quick)

- Skills docs: https://docs.databricks.com/aws/en/agent-skills/  
- Official skills repo: https://github.com/databricks/databricks-agent-skills  
- Cursor plugin: https://cursor.com/marketplace/databricks  
- AI Dev Kit (installer only): https://github.com/databricks-solutions/ai-dev-kit  
- Apps: https://docs.databricks.com/aws/en/dev-tools/databricks-apps/  
- Apps + DAB: https://docs.databricks.com/aws/en/dev-tools/bundles/apps-tutorial  
- App templates: https://github.com/databricks/app-templates  
