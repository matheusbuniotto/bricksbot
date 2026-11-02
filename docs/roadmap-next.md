# BricksBot: Next must-do roadmap

**Updated:** 2026-11-02  
**Shipped (2026-10-29 → 30):** seed skills, `pin_artifact`, Bot details sheet, presence `waiting`/`blocked`, choice cards (`ask_choice`), routine trust polish, Lakeflow Job → webhook, dataviz pins. Genie stays opt-in only.

**Distribution north star:** [oss-community-release.md](oss-community-release.md), GitHub + DAB, not PartnerOps-first.

## Must-do now: OSS community share (P0)

| Step | Status |
| --- | --- |
| 1. License + CONTRIBUTING + scrub clawhouse-only defaults | **Done** (Apache-2.0; BYO via `dev.local.yml`) |
| 2. Self-contained deploy docs + Lakebase stub | **Done** (README install + `resources/lakebase.postgres.yml.stub`) |
| 3. README as community homepage | **Done** |
| 4. Smoke path documented | **Done** (`npm test` / build / stub local + workspace deploy section) |

Remaining before announce: run the smoke path once on a **fresh** workspace (or confirm with a cold clone) and tick success checks in [oss-community-release.md](oss-community-release.md).

## After announce (P1 product)

| Priority | Item | Notes |
| --- | --- | --- |
| 1 | Space members UI | API exists; roster/share UX missing |
| 2 | `volume_write` Ask-first | Biblioteca / Volume pins |
| 3 | Deny-until-new-message | Track B trust |
| 4 | Approval trail | Approvals → UC or structured log |

## Explicitly not next

| Item | When |
| --- | --- |
| Genie Agent / Genie One MCP | After cheap path + OSS share feel solid, [databricks-platform-integration-plan.md](databricks-platform-integration-plan.md) |
| `system.ai.*` broad MCP | After first opt-in Genie experiment |
| Desktop / Playwright "computer" UI | Still deferred; **sandbox exec shipped** behind `SANDBOX_BACKEND`, [specs/2026-10-30-phase5-sandbox-execution.md](specs/2026-10-30-phase5-sandbox-execution.md) |
| PartnerOps / Marketplace Apps listing | Optional parallel; OSS GitHub is the primary share path |
| Vector Search | Nice; after `volume_write` / audit if needed |

## Closed specs (do not reopen as "next")

- [specs/2026-10-29-pin-artifact.md](specs/2026-10-29-pin-artifact.md)
- [specs/2026-10-29-bot-details-sheet.md](specs/2026-10-29-bot-details-sheet.md)
- [specs/2026-10-29-presence-waiting.md](specs/2026-10-29-presence-waiting.md)
- [specs/2026-10-29-choice-cards.md](specs/2026-10-29-choice-cards.md)
- [specs/2026-10-29-routine-trust.md](specs/2026-10-29-routine-trust.md)
- [specs/2026-10-30-lakeflow-routine-job.md](specs/2026-10-30-lakeflow-routine-job.md)
- [specs/2026-10-30-phase5-sandbox-execution.md](specs/2026-10-30-phase5-sandbox-execution.md)
- [specs/2026-10-30-dataviz-artifacts.md](specs/2026-10-30-dataviz-artifacts.md)

## One-line north star

**Make a cold clone installable and trustworthy for the Databricks community** before spending Genie money or building computer.
