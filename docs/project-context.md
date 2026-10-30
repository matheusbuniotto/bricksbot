# BricksBot — Project context

Databricks Marketplace App aiming for near 1:1 Grok Bot product shape (Bot roster, durable agents, lakehouse tools, routines). Canonical plan: [databricks-grokbot-marketplace-plan.md](databricks-grokbot-marketplace-plan.md).

## Locked decisions (2026-10-28)

- **Computer**: Defer full persistent desktop. Phase 5 default lean Daytona (free-ish credits); E2B Desktop as alt. No Playwright-in-App as “real” computer.
- **Codebase**: Slim greenfield Databricks App with a strongly cloned Grok Bot UI — not Rakazo-based.
- **Models**: OpenAI-compatible primary (OpenRouter-like); Databricks Model Serving as an option.
- **Marketplace**: Apply for Partner / PartnerOps now; do not block MVP on public Apps listing clarity.
- **Tenancy**: User-owned Bots; Spaces/folders; team sharing. Egress allowlists for LLM, connectors, and future sandbox.

## Locked later (2026-10-29)

- **Agent loop**: **Thin Pi-compatible harness** (compaction, `CapabilityCatalog`, skills index + `activate_skill` / `read_skill_resource`, memory tools, durable approvals, requestId) — not embedding `@earendil-works/pi-durable` until a Lakebase adapter exists. See [durable-harness.md](durable-harness.md).
- **Genie / Ontology (cost)**: Default remains cheap lakehouse tools (`sql_query`, catalog, volume, seeds). **Genie is opt-in / Ask-first**, not the default router — Genie Agent experiment before Genie One MCP. Ontology has **no partner API**; consume only via Genie when enabled. Canonical plan: [databricks-platform-integration-plan.md](databricks-platform-integration-plan.md).

## Agent improvement track (2026-10-29)

- Behaviors / Grok UI: [agent-improvement-plan.md](agent-improvement-plan.md) (Track B skills + `pin_artifact` shipped; Track F points at platform plan).
- Platform (Genie, Ontology, `system.ai` MCP, Biblioteca): [databricks-platform-integration-plan.md](databricks-platform-integration-plan.md).
- **Next must-do:** [roadmap-next.md](roadmap-next.md) — (1) Bot details sheet, (2) presence waiting/blocked, (3) choice cards, (4) routine trust. Genie not next.

## Still open

- Who owns PartnerOps apply
- Websocket / scaling approach for the App
- Daytona vs E2B when Phase 5 computer starts
- Genie kill switch / per-Bot Genie grant UX (see platform plan open questions)
