# BricksBot: Project context

Databricks App aiming for near 1:1 Grok Bot product shape (Bot roster, durable agents, lakehouse tools, routines). Canonical research plan: [databricks-grokbot-marketplace-plan.md](databricks-grokbot-marketplace-plan.md). **Community share path:** [oss-community-release.md](oss-community-release.md).

## Locked decisions (2026-10-28)

- **Computer.** Defer full persistent desktop / Playwright-in-App. **Updated 2026-10-30:** Phase 5 **execution sandbox is implemented** behind `SANDBOX_BACKEND` (default `off`): **Databricks Sandbox first**, then `python_exec` / E2B; **no Daytona**. Spec: [specs/2026-10-30-phase5-sandbox-execution.md](specs/2026-10-30-phase5-sandbox-execution.md).
- **Codebase.** Slim greenfield Databricks App with a strongly cloned Grok Bot UI, not Rakazo-based.
- **Models.** OpenAI-compatible primary (OpenRouter-like); Databricks Model Serving as an option.
- **Tenancy.** User-owned Bots; Spaces/folders; team sharing. Egress allowlists for LLM, connectors, and future sandbox.
- **Chats (2026-11-19, lifts "one chat per bot").** Many chats per (bot, user). Routines get one chat per routine and handoffs one per (teammate, caller); history labels them by `kind`. "Always allow" stays per chat. Memories and skills stay per (bot, user), shared by its chats.

## Locked later (2026-10-29)

- **Agent loop.** **Thin Pi-compatible harness** (compaction, `CapabilityCatalog`, skills index + `activate_skill` / `read_skill_resource`, memory tools, durable approvals, requestId), not embedding `@earendil-works/pi-durable` until a Lakebase adapter exists. See [durable-harness.md](durable-harness.md).
- **Genie / Ontology (cost).** Default remains cheap lakehouse tools (`sql_query`, catalog, volume, seeds). **Genie is opt-in / Ask-first**, not the default router, Genie Agent experiment before Genie One MCP. Ontology has **no partner API**; consume only via Genie when enabled. Canonical plan: [databricks-platform-integration-plan.md](databricks-platform-integration-plan.md).

## Locked (2026-10-30): distribution

- **Primary share path.** **Open-source GitHub + workspace DAB deploy** for the Databricks community.
- **Marketplace Apps / PartnerOps.** Optional later; do **not** block OSS announce on public Apps listing or closed-source packaging.
- **Dev convenience** (personal Lakebase/secret reuse) must not be the **only** documented install path — community path is BYO via `dev.local.yml` (see README).

## Shipped product core (through 2026-10-30)

Roster + presence (`waiting` / `blocked`), durable chat, dual ChatClient, lakehouse tools + meta/seeds, approvals, handoff/`create_bot`, `pin_artifact`, `ask_choice`, Bot details (Details / Library / Computer), routines + webhook + trust polish, Phase 5 sandbox exec (flagged off by default).

## Agent / platform tracks

- Behaviors / Grok UI: [agent-improvement-plan.md](agent-improvement-plan.md), Track B UI batch + deny-until-new-message done; remaining = Auto Review lite, space skill publish. Approval trail: Lakebase `approval_events`.
- Platform (Genie, Ontology, `system.ai` MCP): [databricks-platform-integration-plan.md](databricks-platform-integration-plan.md), still go slow.
- **Next:** P1 after OSS announce — [roadmap-next.md](roadmap-next.md); release checklist [oss-community-release.md](oss-community-release.md).

## Still open

- Websocket / scaling approach for the App
- Genie kill switch / per-Bot Genie grant UX (see platform plan open questions)
- Whether to pursue PartnerOps Apps listing **after** OSS v0
- Fresh-workspace smoke confirmation + optional README screenshot (see [oss-community-release.md](oss-community-release.md))
