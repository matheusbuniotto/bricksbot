# BricksBot — Databricks platform integration plan

**Status:** plan / go slow (locked cost posture 2026-10-29).  
**Audience:** product + harness.  
**Parent:** [agent-improvement-plan.md](agent-improvement-plan.md) Track F · [project-context.md](project-context.md) · [databricks-grokbot-marketplace-plan.md](databricks-grokbot-marketplace-plan.md).

## Locked posture (cost & UX)

- **Default path stays cheap lakehouse tools:** `sql_query`, `lakehouse_catalog`, `volume_read`, seed skills, memory/meta tools. Do **not** route “most” turns through Genie.
- **Genie is opt-in and escalatory**, not the default brain. Costs (warehouse + Genie compound AI) and latency make “Genie for everything” a bad install experience.
- **Ontology has no partner API.** Consume only by calling Genie when the user (or a clearly labeled specialist Bot) chooses that path. Never invent `ontology_query`.
- **Ship Biblioteca / artifacts and MCP plumbing slowly** after the cheap path feels good; Genie can deep-link later.

BricksBot = Grok-shaped multi-bot harness. Genie family = optional governed analytics specialist — not the always-on router.

## Why go slow

| Risk | Mitigation |
| --- | --- |
| Genie / warehouse bill surprises on every chat | Genie tools **unregistered** until App resource + Gateway grants exist; Ask-first; never auto-allow Genie by default |
| Agents over-call Genie for trivial schema peeks | Capability prompt: prefer `sql_query` / catalog for known objects; Genie only for business meaning / KPI / “what does X mean?” **after** cheap tools fail or user asks |
| Confusing dual UIs (BricksBot chat + GenieChat) | Prefer **tool-call Genie** from a Bot first; embed `GenieChat` pane only if install explicitly enables it |
| Ontology confusion | Document: Ontology comes free *inside* Genie answers; BricksBot does not browse the graph |

## Architecture (consume, don’t reimplement)

```text
User → BricksBot Bot (Primary / specialist)
         ├─ default: sql_query / lakehouse_catalog / volume_read / web_fetch / meta
         ├─ opt-in:  genie_*  ──► Genie Agent API or system.ai.genie_one_mcp
         │                         └─ Genie Ontology (OntoRank + UC perms) under the hood
         └─ artifacts: Biblioteca (Volume / pins) … later deep-link Genie Documents
```

## Ontology

| Fact | BricksBot implication |
| --- | --- |
| Ontology = UC semantics (metric views, domains, Pages) + inferred snippets; OntoRank; UC-gated | Public Preview |
| **No direct Ontology API for partners** ([partner agent integrations](https://databrickslabs.github.io/partner-architecture/isv-partners/product-categories/ai/agent-integrations)) | Integration path = Genie only |
| Enrich write surfaces: Metric Views, Domains, Pages, Business Glossary | Far future optional “propose metric view” tools — not MVP |

When Genie tools are registered, prompt guidance is **escalation**, not “always Genie first”:

1. Prefer cheap tools for exploration and known SQL.  
2. Escalate to Genie when the user asks for business definitions/KPIs, or cheap tools are insufficient.  
3. Memory never overrides Genie/Ontology for consequential metrics **once Genie was used**.

## Genie Agents vs Genie One

| Path | Use when | Notes |
| --- | --- | --- |
| **Genie Agent** App resource + Conversation API / Agent MCP | One curated domain; predictable cost envelope | Install bind `genie-space`; AppKit plugin already in `appkit.plugins.json` |
| **Genie One MCP** `system.ai.genie_one_mcp` | Workspace-wide NL + Ontology | Higher blast radius / cost; Gateway + OBO; **later** than a single Agent |
| AppKit `GenieChat` embed | Explicit “Genie pane” install option | Not default chrome |

**Bot mapping (optional, admin-configured):** specialist Bot → one Genie Agent. Primary does **not** auto-call Genie One on every message.

## `system.ai` / managed MCP

URL: `https://<host>/ai-gateway/mcp-services/<fqn>?o=<workspace_id>` · scope `ai-gateway`.

| MCP | Role | Pace |
| --- | --- | --- |
| `system.ai.genie_one_mcp` | Ontology-backed NL | Slow / opt-in after Genie Agent experiment |
| `system.ai.dbsql` | Governed SQL vs homemade `sql_query` | Evaluate; may stay on Statements API longer (cost clarity) |
| `system.ai.web_search` | Cited web vs allowlisted `web_fetch` | Later |
| `system.ai.sandbox` | Isolated code | Align with Phase 5; not a Genie substitute |
| External Slack/GitHub/Gmail/… | Connect-apps analogue | Track 6 |

Harness phases (when we start coding):

1. **F-a** — Optional Genie Agent tool (Ask-first, never Always-allow by default) + citations in transcript.  
2. **F-b** — Thin MCP client for explicitly enabled `system.ai.*` servers.  
3. **F-c** — `tool_search` / deferred tools when the surface is large ([durable-harness.md](durable-harness.md)).

Prefer Unity Gateway over legacy `/api/2.0/mcp/*` when both exist.

## Artifacts / canvas (three concepts)

| Surface | BricksBot landing |
| --- | --- |
| Genie One Documents ([docs](https://docs.databricks.com/aws/en/genie-one/documents)) | Deep-link only; don’t fork the editor |
| MCP Apps View (Genie charts in MCP hosts) | Skip until we know AppKit can host MCP Apps |
| **Biblioteca** (Grok-like Bot artifacts) | Own store: Lakebase + UC Volume pins — **can ship without Genie** |

MVP Biblioteca without Genie: SQL result pin, Volume markdown brief, later Genie conversation link.

## Sequencing (deliberate)

```text
F0  Docs + cost posture locked (this file)                          ← done
F1  Biblioteca chrome + cheap artifact types (no Genie)            ← mostly done (Library tab + pin_artifact); volume_write / richer kinds later
F2  Optional Genie Agent resource + Ask-first tool (single space)  ← first Genie spend (after OSS share)
F3  Measure cost/UX; only then consider Genie One MCP
F4  Broader system.ai registry / external connectors
F5  Ontology enrich helpers (metric view drafts) — last
```

**Do not** reorder to “Genie One first for the platform wedge” — that fights the cost lock.

## Open questions

1. Per-workspace Genie budget / kill switch in install wizard?  
2. Per-Bot “may call Genie” flag vs Space-level grant?  
3. Show estimated Genie usage in transcript after each call?  
4. Does App-authored SQL history meaningfully enrich Ontology for that workspace?

## Success checks

- [x] Cost posture locked: Genie opt-in, cheap tools default  
- [x] Ontology = via Genie only (no fake API) documented here + project-context  
- [ ] Genie tools absent from default `toolsFor` until resource configured  
- [ ] Ask-first on Genie; no Always-allow default  
- [ ] Capability prompt escalation language (not Genie-first) when tool present  
- [x] Biblioteca ≥1 artifact type without Genie (`pin_artifact` + Library tab)  
- [ ] Install wizard / egress notes Genie cost + optional bind (when F2 starts)  

## References

- [Genie Ontology](https://docs.databricks.com/aws/en/genie/genie-ontology)  
- [Databricks-provided MCPs / system.ai](https://docs.databricks.com/aws/en/agents/mcp-tools/built-in-mcp-services)  
- [Genie One MCP](https://docs.databricks.com/aws/en/agents/mcp-tools/genie-mcp)  
- [Genie Agent MCP](https://docs.databricks.com/aws/en/agents/mcp-tools/genie-agent)  
- [Genie Agents Conversation API](https://docs.databricks.com/aws/en/genie-agents/conversation-api)  
- [Add Genie Agent to a Databricks App](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/genie)  
- [Genie One Documents](https://docs.databricks.com/aws/en/genie-one/documents)  
- [Partner agent integrations (Ontology via Genie One)](https://databrickslabs.github.io/partner-architecture/isv-partners/product-categories/ai/agent-integrations)  
- Repo: `appkit.plugins.json` (`genie` plugin), [durable-harness.md](durable-harness.md) (`tool_search` later), [agent-improvement-plan.md](agent-improvement-plan.md)
