# BricksBot Documentation

This directory contains architectural specifications, decision records, product roadmaps, and platform integration plans for BricksBot.

---

## Architecture & System Design

- [**System Architecture (`architecture.md`)**](architecture.md) — System overview, layer-by-layer architectural breakdown, and core execution pillars.
- [**Interactive Architecture Reference (`system-architecture.html`)**](system-architecture.html) — Interactive HTML reference covering multi-user tenancy, the Pi harness loop, tool catalogs, approvals, routines, and sandbox execution.
- [**Durable Harness Design (`durable-harness.md`)**](durable-harness.md) — Specifications for the thin, Pi-compatible durable agent harness (compaction, idempotency, OpenAI message replay).
- [**Security & Trust Model (`security.md`)**](security.md) — Identities, OBO scopes, approvals, opt-in switches, and egress for operators.
- [**Project Context & Product Locks (`project-context.md`)**](project-context.md) — Canonical product constraints, domain vocabulary, and architectural locks.

---

## Architectural Decision Records (ADRs)

Architecture Decision Records live in [`adr/`](adr/):
- [**ADR 0001: Plugin and Extension Contract**](adr/0001-plugin-and-extension-contract.md) — Pluggable tools and dynamic UC Volume discovery without monorepo redeploys.

---

## Feature Specifications (`specs/`)

Detailed design and implementation specifications for shipped and planned capabilities:

| Specification | Focus |
| --- | --- |
| [**Plugin Extension System**](specs/2026-11-07-plugin-extension-system.md) | Dynamic UC Volume plugin loader and Lakebase registry |
| [**Volume Write & Bot Namespaces**](specs/2026-11-02-volume-write-bot-namespaces.md) | User/bot namespaced volume storage, quotas, and Ask-first policy |
| [**Deny-Until-New-Message**](specs/2026-11-02-deny-until-new-message.md) | Rejection flow and turn suspension until new user prompt |
| [**Approval Audit Trail**](specs/2026-11-02-approval-trail.md) | Append-only `approval_events` logging for compliance |
| [**Phase 5 Sandbox Execution**](specs/2026-10-30-phase5-sandbox-execution.md) | Isolated Linux container execution backends and artifact synchronization |
| [**Lakeflow Routine Job**](specs/2026-10-30-lakeflow-routine-job.md) | Automated scheduled routines via Databricks Jobs and webhooks |
| [**Data Visualization Pins**](specs/2026-10-30-dataviz-artifacts.md) | Vega-Lite and Mermaid chart artifact pinning in transcripts |
| [**Routine Trust & Polish**](specs/2026-10-29-routine-trust.md) | Granular execution feedback for scheduled runs |
| [**Presence State Machine (`waiting`)**](specs/2026-10-29-presence-waiting.md) | Real-time presence states (`online`, `thinking`, `working`, `waiting`, `blocked`) |
| [**Choice Prompt Cards**](specs/2026-10-29-choice-cards.md) | Multi-choice human-in-the-loop interaction cards (`ask_choice`) |
| [**Artifact Pinning**](specs/2026-10-29-pin-artifact.md) | Durable transcript artifact pinning (`pin_artifact`) |
| [**Bot Details Sheet**](specs/2026-10-29-bot-details-sheet.md) | Bot metadata, library, and sandbox management inspector |

---

## Product Roadmap & Plans

- [**Open-Source Community Release Map (`oss-community-release.md`)**](oss-community-release.md) — Checklist and distribution track for open-source GitHub release.
- [**Next Roadmap & Priorities (`roadmap-next.md`)**](roadmap-next.md) — Current priority queue and explicit non-goals.
- [**Agent Improvement Plan (`agent-improvement-plan.md`)**](agent-improvement-plan.md) — Agent harness, memory (OptMem), and skill improvement backlog.
- [**Platform Integration Plan (`databricks-platform-integration-plan.md`)**](databricks-platform-integration-plan.md) — Integration roadmap for Databricks Genie, Model Serving, and Unity Catalog.
- [**Marketplace Product Plan (`databricks-grokbot-marketplace-plan.md`)**](databricks-grokbot-marketplace-plan.md) — Original product blueprint and MVP feature matrix.
- [**Databricks Dev Skills Research (`databricks-dev-skills-research.md`)**](databricks-dev-skills-research.md) — Research on Databricks development patterns and SDK tooling.
