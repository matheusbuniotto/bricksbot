# BricksBot — Agent improvement & Grok parity plan

**Status:** living plan (updated 2026-10-30).  
**Sources:** marketplace plan, live Grok Bot Mac UI, `docs/durable-harness.md`, codebase.

## Goal

Improve **agent behavior** (tools, skills, prompts, trust loops) toward Grok Bot quality **without** Phase 5 computer. Lakehouse tools stay the wedge. Distribution for community share is tracked separately: [oss-community-release.md](oss-community-release.md).

## Current baseline (shipped)

- Tools: `sql_query`, `lakehouse_catalog`, `volume_read`, conditional `web_fetch`, Primary `handoff_to_bot` / `create_bot`, Ask-first `pin_artifact` + `ask_choice`, meta tools (`remember` / `forget` / `list_memories` / `save_skill` / `activate_skill` / `read_skill_resource`)
- Seed skills: `sql-explore`, `catalog-recon`, `weekly-table-health`, `pin-finding` (merged via `effective-skills`)
- Durable: compaction, approvals, `requestId`, per-bot memory/skills stores
- UI: roster, chat, approval + choice cards, pin chips, **Bot details sheet** (Details = routines, Library = pins, Computer = asleep)
- Presence: `thinking` | `working` | `online` | **`waiting`** | **`blocked`**
- Routines: human cron copy, webhook trust banner, **Test** run from details
- **Next ordered work:** [roadmap-next.md](roadmap-next.md) (OSS share first) · [oss-community-release.md](oss-community-release.md)

## Live Grok UI double-check (2026-10-29)

| Pattern | Note for BricksBot |
| --- | --- |
| Choice / action cards in transcript | **Shipped** — `ask_choice` + “Sua resposta” |
| Bot details sheet | **Shipped** — Details / Library / Computer |
| Routines live on Bot details | **Shipped** |
| Biblioteca empty copy | **Shipped** (pins read-only) |
| `Rascunho:` / waiting roster preview | **Shipped** as `Aguardando:` when `waiting` |
| `Acordando…` + computer sleep/wake | Computer → Phase 5; sheet shows asleep |
| Skill chips in prose | Still nice-to-have |
| Authority rules | Typed confirm for destructive later; `create_bot` / `ask_choice` never Always-allow |
| Personal bots: no memory screen | Chat + remember/forget (kept) |

## Workstreams (parallel-safe)

```text
OSS — Community share   License, self-contained install, README  ← next (see oss-community-release.md)
A — Phase 4 UI          Bot details + routines trust             ← done
B — Agent quality       Seeds, pin, presence, choices            ← done slice; deny / Auto Review later
C — Lakehouse tools     volume_write, Vector Search (thin)
D — Distribution        OSS GitHub primary; PartnerOps optional
E — Ops routines        Lakeflow Job → webhook (parameterized)
F — Databricks platform See databricks-platform-integration-plan.md (Genie opt-in)
5 — Computer            Databricks Sandbox + E2B later (no Daytona)
6 — Connectors/voice    Prefer system.ai.* external MCPs when ready
```

## Track B — Agent quality

### B1–B2 — Done

Seed skills, capability prompt habits (`sql_query` / catalog prefer, `save_skill` contract, operational `create_bot`), soft limits documented.

### B3 — Remaining (not blocking OSS announce)

1. ~~Choice / action cards~~ **done**
2. ~~Presence `waiting` / `blocked`~~ **done**
3. ~~Bot details sheet~~ **done**
4. ~~Wire Routines into details~~ **done** (Memory stays chat-driven; no orphan MemoryPanel mount)
5. **Auto Review lite** — second model pass on risky tools
6. **Space-scoped skill publish** — later team copy of skills
7. **Deny semantics** — no auto-retry until a new user message

### Explicitly out of Track B

Computer / teach-by-demo / shell / browser, voice, Connect apps catalog, X @bot, Playwright-in-App as security boundary.

## Track F — Databricks platform (pointer)

→ **[databricks-platform-integration-plan.md](databricks-platform-integration-plan.md)**

Cheap lakehouse tools default; Genie Ask-first / opt-in; Ontology only via Genie; Biblioteca can ship without Genie (pins already).

## Success checks

### Track B (skills + UI trust slice)

- [x] Skills index lists seed skills on a fresh Primary with empty `bot_skills`
- [x] `activate_skill` returns seed body; bot override wins on same name
- [x] Capability prompt mentions cite-fresh-data + save_skill contract
- [x] `create_bot` / `save_skill` tool descriptions encode operational / 6-part templates
- [x] Tests cover merge + prompt + activate seed
- [x] Bot details + presence waiting/blocked + ask_choice + routine trust

### Track B (still open)

- [ ] Deny-until-new-message
- [ ] Auto Review lite
- [ ] Space-scoped skill publish

### Track F

See [databricks-platform-integration-plan.md](databricks-platform-integration-plan.md).

## Related docs

- [project-context.md](project-context.md)
- [oss-community-release.md](oss-community-release.md)
- [roadmap-next.md](roadmap-next.md)
- [durable-harness.md](durable-harness.md)
- [databricks-grokbot-marketplace-plan.md](databricks-grokbot-marketplace-plan.md)
- [databricks-platform-integration-plan.md](databricks-platform-integration-plan.md)
