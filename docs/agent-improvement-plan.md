# BricksBot — Agent improvement & Grok parity plan

**Status:** living plan (saved 2026-10-29).  
**Sources:** marketplace plan, live Grok Bot Mac UI (Zelador), `docs/durable-harness.md`, codebase inventory.

## Goal

Improve **agent behavior** (tools, skills, prompts, trust loops) toward Grok Bot quality **without** Phase 5 computer. Lakehouse tools stay the wedge.

## Current baseline (shipped)

- Tools: `sql_query`, `lakehouse_catalog`, `volume_read`, conditional `web_fetch`, Primary `handoff_to_bot` / `create_bot`, meta tools (`remember` / `forget` / `list_memories` / `save_skill` / `activate_skill` / `read_skill_resource`)
- Durable: compaction, approvals, `requestId`, per-bot memory/skills stores
- UI: roster, chat, approval cards; **MemoryPanel / RoutinesPanel / InstallWizard exist but are not mounted in `App.tsx`**
- `skills/` empty; no seed skill pack; presence = `thinking` | `working` | `online` only

## Live Grok UI double-check (2026-10-29)

| Pattern | Note for BricksBot |
| --- | --- |
| Choice / action cards in transcript | Agent asks A/B; answer persists as “Sua resposta” / “Dispensado” — **not** only tool approvals |
| Bot details sheet | Tabs: Detalhes (routines + pause), Biblioteca (artifacts), Computador |
| Routines live on Bot details | Human schedule + pause; not a global-only sidebar |
| Biblioteca empty copy | Artifacts: pages/files/apps the Bot creates |
| `Rascunho:` roster preview | Draft / needs-attention prefix |
| `Acordando…` + computer sleep/wake | Richer presence; computer → Phase 5 |
| Skill chips in prose | Named skills called out inline |
| Authority rules | Bot cannot delete bots; some actions need typed confirm, not card tap |
| Personal bots: no memory screen | Chat + remember/forget; a Memory panel is optional lakehouse extra |

## Workstreams (parallel-safe)

```text
A — Phase 4 UI        Wire Memory / Routines / Wizard; prefer Bot details sheet
B — Agent quality     Seed skills, prompt habits, choice cards, presence  ← NOW
C — Lakehouse tools   volume_write, Vector Search (thin)
D — Distribution      PartnerOps / Marketplace (non-code)
E — Ops routines      Lakeflow Job → webhook
F — Databricks platform  See docs/databricks-platform-integration-plan.md (Genie opt-in / cost-aware)
5 — Computer          Daytona/E2B later (sandbox MCP is related but separate)
6 — Connectors/voice  Prefer system.ai.* external MCPs when ready
```

## Track B — Agent quality (this epic)

### B1. Seed lakehouse skills (in progress / first slice)

Built-in skills available to every bot (Account-wide Grok pattern → shared seed pack + per-bot overrides):

| Skill | Purpose |
| --- | --- |
| `sql-explore` | Safe read-only exploration with `sql_query` + `lakehouse_catalog` |
| `catalog-recon` | Map UC catalogs → schemas → tables → columns |
| `weekly-table-health` | Routine-ready health check; stale-data + approval boundaries |

Each skill body follows Grok’s contract: **when / inputs / steps / validate / return / approvals**.

Bot `save_skill` rows **override** a seed with the same name. `activate_skill` / Skills index merge seed + bot.

### B2. Capability prompt habits

- Prefer live `sql_query` / catalog / volume over memory for consequential decisions
- After a successful multi-step lakehouse workflow, nudge `save_skill` with the 6-part contract
- `create_bot` job = operational (goal, sources, style, approval boundary)
- Soft limits unchanged (no computer, SQL read-only, web_fetch allowlist)

### B3. Next (planned, not this slice)

1. **Choice / action cards** — structured message type or tool that blocks until the user picks; transcript keeps the decision
2. **Presence** — `waiting` (pending approval / choice), `blocked` (needs user); optional `Rascunho:` preview prefix
3. **Bot details sheet** — Detalhes (routines), Biblioteca stub (artifact pins), Computador deferred empty state
4. **Wire / relocate** Memory + Routines UI into details (don’t rely on orphan panels)
5. **Auto Review lite** — second model pass on risky tools
6. **Space-scoped skill publish** — later team copy of skills
7. **Deny semantics** — no auto-retry until a new user message

### Explicitly out of Track B

Computer / teach-by-demo / shell / browser, voice, Connect apps catalog, X @bot, Playwright-in-App as security boundary.

## Track F — Databricks platform (pointer)

Canonical write-up (Ontology, Genie, `system.ai` MCP, artifacts/canvas, **cost-aware Genie opt-in**):

→ **[databricks-platform-integration-plan.md](databricks-platform-integration-plan.md)**

Summary locks: cheap lakehouse tools stay default; Genie is Ask-first / opt-in (Genie Agent experiment before Genie One MCP); Ontology only via Genie; Biblioteca can ship without Genie.

## Success checks

### Track B (skills slice)

- [x] Skills index lists seed skills on a fresh Primary with empty `bot_skills`
- [x] `activate_skill` returns seed body; bot override wins on same name
- [x] Capability prompt mentions cite-fresh-data + save_skill contract
- [x] `create_bot` / `save_skill` tool descriptions encode operational / 6-part templates
- [x] Tests cover merge + prompt + activate seed

### Track F

See success checks in [databricks-platform-integration-plan.md](databricks-platform-integration-plan.md).

## Related docs

- [project-context.md](project-context.md)
- [durable-harness.md](durable-harness.md)
- [databricks-grokbot-marketplace-plan.md](databricks-grokbot-marketplace-plan.md)
- [databricks-platform-integration-plan.md](databricks-platform-integration-plan.md)
