# BricksBot: Open-source community release map

**Updated:** 2026-11-18  
**Goal:** Share a **workspace-installable Databricks App** on GitHub that a community admin can clone, bind resources, and run, without PartnerOps or a closed Marketplace container.

This is the **distribution track** for "Databricks community thing." Product locks still live in [project-context.md](project-context.md). Full product research: [databricks-grokbot-marketplace-plan.md](databricks-grokbot-marketplace-plan.md).

## Distribution lock (2026-10-30)

| Was (Oct 28) | Now for OSS share |
| --- | --- |
| Partner Program + PartnerOps Apps listing first | **GitHub + DAB deploy** first; Marketplace Apps listing optional later |
| Closed-source Marketplace container assumed | **Open source** (Apache-2.0; ship source + `databricks.yml`) |
| Dev target may reuse clawhouse Lakebase/secrets | Community path is **self-contained** (`dev.local.yml` / BYO Lakebase) |

PartnerOps / public Apps category remain **nice-to-have**, not blockers for v0 community share.

## Already shipped (do not re-plan)

Treat Phase 0 to 4 **product core** as done for a credible demo:

| Area | Status |
| --- | --- |
| AppKit shell, Spaces chips, bot roster, brick faces | Done |
| Presence: `online` / `thinking` / `working` / **`waiting` / `blocked`** | Done |
| Durable chat on Lakebase (+ memory fallback), compaction, `requestId` | Done |
| Dual `ChatClient` (OpenAI-compatible → Serving → stub) | Done |
| Tools: `sql_query`, `lakehouse_catalog`, `volume_read`, `web_fetch`, handoff, `create_bot` | Done |
| Meta: remember/forget/list/save_skill/activate/read_resource; seed skills | Done |
| Approvals (3-way) + Ask-first `pin_artifact` + `ask_choice` | Done |
| Bot details sheet (Details / Library / Computer) | Done |
| Routines (cron metadata + webhook + Test) + thin setup status | Done |
| Parameterized Lakeflow Job → webhook | Done |
| Thin Pi-compatible harness (not `@earendil-works/pi-durable`) | Done, [durable-harness.md](durable-harness.md) |

## Must ship before public OSS announce (P0)

### 1. License + repo hygiene

- [x] Choose and add `LICENSE` (Apache-2.0; `package.json` matches)
- [x] `CONTRIBUTING.md` (dev loop, tests, no-secret rule, DAB profile notes)
- [x] Scrub personal/clawhouse-only assumptions from **default** docs path (`databricks.yml` uses BYO vars; `dev.local.yml` gitignored; stub + README)
- [x] Public-safe `.env.example` (placeholders, no personal endpoint)
- [x] Git history decision: **accepted as is**. Early commits contain the maintainer's workspace host, a Lakebase project name and a warehouse id. These are identifiers, not credentials (all access needs workspace auth), so history is not rewritten. HEAD is guarded by `scripts/check-no-workspace-ids.sh`.
- [x] Secret scan in CI (gitleaks over full history and tree; `.gitleaks.toml`)
- [x] `SECURITY.md`, issue and PR templates, `package.json` metadata (`0.1.0`)

### 2. Self-contained install story

- [x] Document **minimal resources**: App, Lakebase (or memory fallback for try-local), SQL warehouse optional, Secret for LLM
- [x] Lakebase BYO stub: `resources/lakebase.postgres.yml.stub` (Job: `resources/jobs/routine-webhook.job.yml`)
- [x] Install checklist: egress domains, `CAN_USE`, UC grants (README)
- [x] First-run: stub provider → clear "put secret / bind Serving" path (wizard + README)
- [x] Safe-by-default bundle: example Job deploys paused (UTC), `web_fetch` / `volume_write` opt-in, no hardcoded CLI profile
- [x] `npm run bootstrap -- -p <profile>`: Lakebase, warehouse, LLM secret, `dev.local.yml`, `bundle validate`
- [x] Operator trust model: [security.md](security.md)

### 3. README as the product homepage

- [x] What / not / local / deploy; no stale "no UC volume tools"
- [x] Point next work at this file + [roadmap-next.md](roadmap-next.md)
- [x] Screenshot or short GIF (`docs/assets/bricksbot-demo.gif`)

### 4. Smoke path that greenlights "it works"

- [x] Documented: `npm test` + `npm run build` + local `npm run dev` with stub
- [x] Documented: one workspace deploy with OpenAI-compatible secret **or** Serving
- [x] Operator confirmation (2026-11-18): new App + empty Lakebase database deployed from a clean clone with a separate target; Primary answered and an approved `sql_query` ran as the user

## Should ship soon after announce (P1)

| Item | Why |
| --- | --- |
| ~~Space invite / members UI~~ | **Done** (roster share + dialog) |
| ~~`volume_write` + per-bot Volume namespaces~~ | **Done** — [specs/2026-11-02-volume-write-bot-namespaces.md](specs/2026-11-02-volume-write-bot-namespaces.md) |
| ~~Deny-until-new-message semantics~~ | **Done** — [specs/2026-11-02-deny-until-new-message.md](specs/2026-11-02-deny-until-new-message.md) |
| ~~Audit trail of tool approvals~~ | **Done** (Lakebase `approval_events`; UC export later) — [specs/2026-11-02-approval-trail.md](specs/2026-11-02-approval-trail.md) |

## Explicitly later (P2+): do not block OSS v0

| Item | Pointer |
| --- | --- |
| Genie Agent / Genie One MCP | [databricks-platform-integration-plan.md](databricks-platform-integration-plan.md), opt-in, cost-locked |
| Broad `system.ai.*` MCP | After first Genie experiment |
| Vector Search memory | Nice; not required for announce |
| Phase 5 computer / Daytona / E2B | Sandbox exec shipped; desktop UI locked defer |
| Auto Review (second model) | Track B later |
| PartnerOps Marketplace Apps listing | Parallel non-code; optional for OSS |
| Voice, X @bot, SaaS connector pack | Full 1:1 track |

## MVP matrix: status vs marketplace plan §6

| MVP line (marketplace plan) | Reality 2026-11-02 |
| --- | --- |
| High-fidelity UI + approvals + Spaces | **Done** (sharing UI thin) |
| Durable harness on Lakebase | **Done** (thin Pi-compatible) |
| OpenAI-compatible + Serving option | **Done** |
| SQL / UC volume / Vector / web_fetch / optional Genie | **Partial**, SQL + catalog + `volume_read` + `volume_write` (when `BRICKSBOT_VOLUME_ROOT` is set) + web_fetch; no Vector, Genie not registered |
| Per-Bot memory; Space sharing | **Partial**, memory + seeds done; Space members API, weak UI |
| Routines via Job → webhook | **Done** (App webhook + example Job) |
| Bot-to-Bot + Primary router | **Done** (`handoff_to_bot`, `create_bot`) |
| Install wizard + Partner listing | **Partial**, setup status / wizard; Partner listing → **OSS GitHub instead** |
| Audit log to UC / MLflow | **Partial** — Lakebase `approval_events`; UC/MLflow export later |

## Success checks for "community ready"

- [x] LICENSE present and `package.json` `license` matches
- [x] Cold clone → `npm ci` → `npm test` → `npm run build` without private deps (documented; re-run before announce)
- [x] README deploy section works on a **fresh** install (new App and database in an existing workspace; see §4)
- [x] Admin can bind LLM secret or Serving and chat with Primary (documented)
- [x] Docs say Genie/computer are opt-in/deferred; cheap lakehouse tools are the default
- [x] [roadmap-next.md](roadmap-next.md) lists only post-announce product work (not re-listing shipped UI)
- [x] Screenshot/GIF added (`docs/assets/bricksbot-demo.gif`); confirmed local smoke path

## Related

- Next product queue after OSS hygiene: [roadmap-next.md](roadmap-next.md)
- Agent behavior backlog: [agent-improvement-plan.md](agent-improvement-plan.md)
- Genie cost posture: [databricks-platform-integration-plan.md](databricks-platform-integration-plan.md)
