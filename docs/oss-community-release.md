# BricksBot: Open-source community release map

**Updated:** 2026-10-30  
**Goal:** Share a **workspace-installable Databricks App** on GitHub that a community admin can clone, bind resources, and run, without PartnerOps or a closed Marketplace container.

This is the **distribution track** for "Databricks community thing." Product locks still live in [project-context.md](project-context.md). Full product research: [databricks-grokbot-marketplace-plan.md](databricks-grokbot-marketplace-plan.md).

## Distribution lock (2026-10-30)

| Was (Oct 28) | Now for OSS share |
| --- | --- |
| Partner Program + PartnerOps Apps listing first | **GitHub + DAB deploy** first; Marketplace Apps listing optional later |
| Closed-source Marketplace container assumed | **Open source** (pick license; ship source + `databricks.yml`) |
| Dev target may reuse clawhouse Lakebase/secrets | Community path must be **self-contained** (own project/branch or documented BYO) |

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
| Bot details sheet (Details / Library / Computer asleep) | Done |
| Routines (cron metadata + webhook + Test) + thin setup status | Done |
| Thin Pi-compatible harness (not `@earendil-works/pi-durable`) | Done, [durable-harness.md](durable-harness.md) |

Specs closed: [specs/](specs/) (`pin-artifact`, `bot-details-sheet`, `presence-waiting`, `choice-cards`, `routine-trust`).

## Must ship before public OSS announce (P0)

Ordered for a stranger who clones the repo.

### 1. License + repo hygiene

- [x] Choose and add `LICENSE` (Apache-2.0; `package.json` matches)
- [x] `CONTRIBUTING.md` (dev loop, tests, no-secret rule, DAB profile notes)
- [ ] Scrub personal/clawhouse-only assumptions from **default** docs path (code strings, `.env.example`, README secrets prose done; `databricks.yml` dev branch, `resources/lakebase.postgres.yml.stub`, and README Lakebase section move with step 2)
- [x] Public-safe `.env.example` (placeholders, no personal endpoint)

### 2. Self-contained install story

Community admin should not need "reuse clawhouse Lakebase."

- [ ] Document **minimal resources**: App, Lakebase (or memory fallback for try-local), SQL warehouse optional, Secret for LLM
- [ ] Promote or replace stubs: `resources/lakebase.postgres.yml.stub` (Job wiring shipped: [specs/2026-10-30-lakeflow-routine-job.md](specs/2026-10-30-lakeflow-routine-job.md) → `resources/jobs/routine-webhook.job.yml`)
- [ ] Install checklist: egress domains, `CAN_USE`, UC grants for warehouse/volume tools
- [ ] First-run: stub provider → clear "put secret / bind Serving" path (wizard or README, both OK)

### 3. README as the product homepage

Rewrite so first screen answers: what it is, what it is not (no computer), how to run local, how to deploy to a workspace, where plans live.

- [ ] Drop "intentionally out: no UC volume tools" (stale, `volume_read` shipped)
- [ ] Point next work at this file + [roadmap-next.md](roadmap-next.md)
- [ ] Screenshot or short GIF optional but high use for community

### 4. Smoke path that greenlights "it works"

- [ ] Documented: `npm test` + `npm run build` + local `npm run dev` with stub
- [ ] Documented: one workspace deploy with OpenAI-compatible secret **or** Serving
- [ ] One happy-path chat: Primary answers; optional `sql_query` if warehouse bound

## In flight (P1: parallel to OSS P0)

| Item | Why |
| --- | --- |
| [Parameterized Lakeflow Job → webhook](specs/2026-10-30-lakeflow-routine-job.md) | Finishes Phase 4 schedule path; bundle vars + example Job (spec drafted 2026-10-30) |

## Should ship soon after announce (P1)

| Item | Why |
| --- | --- |
| Space invite / members UI (API already exists) | Team story without curling APIs |
| ~~Parameterized Lakeflow Job example~~ | **In flight**, see spec above |
| `volume_write` (Ask-first) | Biblioteca / pin-to-Volume without leaving chat |
| Deny-until-new-message semantics | Trust polish Grok-shaped |
| Audit trail of tool approvals → UC table or log | Enterprise community ask |

## Explicitly later (P2+): do not block OSS v0

| Item | Pointer |
| --- | --- |
| Genie Agent / Genie One MCP | [databricks-platform-integration-plan.md](databricks-platform-integration-plan.md), opt-in, cost-locked |
| Broad `system.ai.*` MCP | After first Genie experiment |
| Vector Search memory | Nice; not required for announce |
| Phase 5 computer / Daytona / E2B | Locked defer |
| Auto Review (second model) | Track B later |
| PartnerOps Marketplace Apps listing | Parallel non-code; optional for OSS |
| Voice, X @bot, SaaS connector pack | Full 1:1 track |

## MVP matrix: status vs marketplace plan §6

| MVP line (marketplace plan) | Reality 2026-10-30 |
| --- | --- |
| High-fidelity UI + approvals + Spaces | **Done** (sharing UI thin) |
| Durable harness on Lakebase | **Done** (thin Pi-compatible) |
| OpenAI-compatible + Serving option | **Done** |
| SQL / UC volume / Vector / web_fetch / optional Genie | **Partial**, SQL + catalog + `volume_read` + web_fetch; no `volume_write`, no Vector, Genie not registered |
| Per-Bot memory; Space sharing | **Partial**, memory + seeds done; Space members API, weak UI |
| Routines via Job → webhook | **Partial**, App webhook + UI done; Job still stub/manual |
| Bot-to-Bot + Primary router | **Done** (`handoff_to_bot`, `create_bot`) |
| Install wizard + Partner listing | **Partial**, setup status / stub wizard; Partner listing → **OSS GitHub instead** |
| Audit log to UC / MLflow | **Not started** |

## Success checks for "community ready"

- [ ] LICENSE present and `package.json` `license` matches
- [ ] Cold clone → `npm ci` → `npm test` → `npm run build` without private deps
- [ ] README deploy section works on a **fresh** workspace (no clawhouse names required)
- [ ] Admin can bind LLM secret or Serving and chat with Primary
- [ ] Docs say Genie/computer are opt-in/deferred; cheap lakehouse tools are the default
- [ ] [roadmap-next.md](roadmap-next.md) lists only post-announce product work (not re-listing shipped UI)

## Related

- Next product queue after OSS hygiene: [roadmap-next.md](roadmap-next.md)
- Agent behavior backlog: [agent-improvement-plan.md](agent-improvement-plan.md)
- Genie cost posture: [databricks-platform-integration-plan.md](databricks-platform-integration-plan.md)
