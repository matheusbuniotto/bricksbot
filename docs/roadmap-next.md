# BricksBot — Next must-do roadmap

**Updated:** 2026-10-30  
**Shipped (2026-10-29 → 30):** seed skills, `pin_artifact`, Bot details sheet, presence `waiting`/`blocked`, choice cards (`ask_choice`), routine trust polish. Genie stays opt-in only.

**Distribution north star:** [oss-community-release.md](oss-community-release.md) — GitHub + DAB, not PartnerOps-first.

## Must-do now (ordered) — OSS community share

Product UX batch is **done**. Next blockers are packaging and a stranger-safe install.

### 1. License + CONTRIBUTING + scrub clawhouse-only defaults

See OSS map P0 §1. `package.json` is still `Unlicensed`.

### 2. Self-contained deploy docs + resource stubs

Own Lakebase / BYO path; egress + secrets checklist; Job stub usable with App URL + webhook secret. OSS map P0 §2.

### 3. README rewrite as community homepage

What / not / local / deploy / smoke path. Fix stale “no UC volume tools.” OSS map P0 §3–4.

### 4. Smoke greenlight

`npm test` + build + stub local chat + one documented workspace deploy with LLM secret or Serving.

## In flight (P1 product — implement now)

| Priority | Item | Notes |
| --- | --- | --- |
| 1 | **Lakeflow Job → routine webhook** | Spec: [specs/2026-10-30-lakeflow-routine-job.md](specs/2026-10-30-lakeflow-routine-job.md) — bundle vars + Job resource + ping script; finishes Phase 4 schedule path |

## After announce (P1 product)

| Priority | Item | Notes |
| --- | --- | --- |
| 1 | Space members UI | API exists; roster/share UX missing |
| 2 | ~~Lakeflow Job example wired~~ | → **in flight** (spec above) |
| 3 | `volume_write` Ask-first | Biblioteca / Volume pins |
| 4 | Deny-until-new-message | Track B trust |
| 5 | Approval trail | Approvals → UC or structured log |

## Explicitly not next

| Item | When |
| --- | --- |
| Genie Agent / Genie One MCP | After cheap path + OSS share feel solid — [databricks-platform-integration-plan.md](databricks-platform-integration-plan.md) |
| `system.ai.*` broad MCP | After first opt-in Genie experiment |
| Desktop / Playwright “computer” UI | Still deferred; **sandbox exec is shipped behind `SANDBOX_BACKEND=off`** — [specs/2026-10-30-phase5-sandbox-execution.md](specs/2026-10-30-phase5-sandbox-execution.md) |
| PartnerOps / Marketplace Apps listing | Optional parallel; OSS GitHub is the primary share path |
| Vector Search | Nice; after `volume_write` / audit if needed |

## Closed specs (do not reopen as “next”)

- [specs/2026-10-29-pin-artifact.md](specs/2026-10-29-pin-artifact.md)
- [specs/2026-10-29-bot-details-sheet.md](specs/2026-10-29-bot-details-sheet.md)
- [specs/2026-10-29-presence-waiting.md](specs/2026-10-29-presence-waiting.md)
- [specs/2026-10-29-choice-cards.md](specs/2026-10-29-choice-cards.md)
- [specs/2026-10-29-routine-trust.md](specs/2026-10-29-routine-trust.md)

**Open (implement next):**

- [specs/2026-10-30-lakeflow-routine-job.md](specs/2026-10-30-lakeflow-routine-job.md)

**Closed (Phase 5 sandbox exec — flagged off by default):**

- [specs/2026-10-30-phase5-sandbox-execution.md](specs/2026-10-30-phase5-sandbox-execution.md)

## One-line north star

**Make a cold clone installable and trustworthy for the Databricks community** before spending Genie money or building computer.
