# BricksBot durable harness (Pi Durable semantics)

**Decision (2026-10-29):** ship a **thin Pi-compatible harness** inside BricksBot — do **not** embed `@earendil-works/pi-durable` yet. Pi Durable has Memory / SQLite / JSONL / DO storage only (no Lakebase/Postgres adapter), and BricksBot must keep OpenAI-valid message replay + AppKit routes. Patterns below mirror [Pi Durable](https://earendil.com/posts/pi-durable/) and Grok Bot behavior.

## Must-have map

| Pattern | Grok / Pi meaning | BricksBot landing | Status |
| --- | --- | --- | --- |
| Lakehouse storage | Survive App restart | Lakebase `bricksbot.*` (+ memory fallback) | Done (chats) |
| Compaction | Summarize older turns; **never delete** transcript | `compactionsitions` + LLM summary injected ahead of keep-from | Done |
| Per-bot memory | Lasting facts the bot keeps / “remember…” | `bot_memories` + `remember` / `forget` / `list_memories` | Done |
| Skills / auto-improve | Save a successful method as reusable skill | `bot_skills` + `save_skill` + index in prompt + `activate_skill` / `read_skill_resource` | Done |
| Approvals that survive restart | Ask-first decisions + auto-allow lists | Persist pending + auto-approved tools | Done |
| Exactly-once submit | Client retry must not double-run | `requestId` → idempotency table | Done |
| Checkpointed turns | Resume mid-tool after crash | Soft: durable approvals + presence; full task graph later | Partial |
| Documents (todos/plans) | App state co-committed with transcript | Defer | Later |
| Conversation fork | Branch from a message | Defer | Later |
| Multiplayer SSE | Many clients on one run | Defer (poll for now) | Later |
| Computer / sandbox | Persistent desktop | Phase 5 | Out |
| Pi CodingTools / browser | `read` / `write` / `edit` / `bash` / browser | Phase 5 | Out |
| Full Pi Harness embed | `@earendil-works/pi-durable` runtime | Needs Lakebase/Postgres storage adapter first | Deferred |

## Pi reuse matrix

Prefer Pi / Agent Skills contracts over BricksBot-only names. Sources: [Pi Durable README (Extensions & Tools)](https://github.com/earendil-works/pi/blob/main/packages/durable/README.md), [Cloudflare Agent Skills](https://developers.cloudflare.com/agents/runtime/execution/agent-skills/).

| Contract | Status | Notes |
| --- | --- | --- |
| Extension-shaped registration (`defineExtension`-like bundles) | Done (thin) | Comments/types in `shared/agents/capability-catalog.ts`; no npm import of pi-durable |
| `CapabilityCatalog` + system **Capabilities** / **Skills** index | Done | Built from `toolsFor(bot)` + store indexes; OpenAI schemas stay on `complete()` |
| Skills index (name + description) in prompt | Done | Full bodies are not always-on |
| `activate_skill` | Done | Loads Lakebase `bot_skills` body + resource list |
| `read_skill_resource` | Done | `SKILL.md` = body; other paths miss until UC Volume packs |
| `run_skill_script` | Out | No sandbox in MVP |
| `tool_search` / deferred MCP tools | Later | Revisit when deferred tools arrive; use Pi semantics, not a custom `list_capabilities` |
| `remember` / `forget` / `save_skill` | Done | Auto-approved |
| `list_memories` | Done | Overflow keys outside the prompt window; not `pi-memory` npm |
| CodingTools / browser tools | Out | Phase 5 |
| Embed `@earendil-works/pi-durable` Harness | Deferred | No Lakebase storage adapter yet |

## Compaction policy (Pi-shaped)

- Full transcript always retained in `messages`.
- When estimated prompt tokens exceed `contextWindow - reserveTokens`, run a summarizer and store a compaction row (`summary`, `keepFromMessageId`).
- Model sees: system prompt + `[compaction summary]` + messages from `keepFrom` onward (tool-call pairs kept valid).
- Manual compact via API optional; auto before `complete()` when over threshold.
- UI still shows the full history (summary may appear as a system note).

Defaults: `contextWindow=128000`, `reserveTokens=16384`, `keepRecentMessages≈24`.

## Memory & skills (Grok + Agent Skills)

- Bot uses tools (not only the Memory panel):
  - `remember` — upsert a durable fact (`key`, `content`)
  - `forget` — remove a fact by key
  - `list_memories` — list keys/content when outside the prompt window
  - `save_skill` — capture a reusable procedure (name + markdown body)
  - `activate_skill` — load full skill instructions on demand
  - `read_skill_resource` — read `SKILL.md` (body) or miss clearly for other paths
- Meta tools above are **default on every bot** (Primary and teammates) and auto-run without Ask-first approval. See `DEFAULT_META_TOOL_NAMES`.
- System prompt carries a **Capabilities** section and a **Skills** index (name + description). Full skill markdown loads only via `activate_skill`.
- Windowed memory values still append via `formatBotContext` (memories only).

## Where to register new tools

Add the factory under `server/agents/tools/`, push it in the `ChatService` constructor tool list, and let `buildCapabilityCatalog` / `toolsFor` surface it. Do not add a one-off `if` in the old hand-written toolInstructions path (removed). Soft limits (no computer, SQL read-only, web_fetch allowlist) live in `shared/agents/capability-catalog.ts`.

## Approvals & idempotency

- Pending approvals and per-chat auto-allow lists live in Lakebase so App restart does not lose Ask-first state.
- `POST /api/chats/:id/messages` accepts `requestId`; duplicates return the first turn’s result.

## Out of scope for this epic

Embedding Pi’s full task ownership tree, entry kinds (`pi.*`), fork, documents, websocket fan-out, CodingTools, and `run_skill_script`. Revisit if a Lakebase storage adapter for Pi lands or we accept a dual runtime.
