# Spec: Typed artifacts, Vega-Lite charts, Mermaid, code blocks, `pin_chart` tool, `dataviz` skill

**Status:** implemented (2026-10-30)
**Date:** 2026-10-30
**Why:** Pins were text only. Bots need to show lakehouse results as tables and interactive charts without re-typing rows into the prompt, and without Genie (cost lock).

## Prototype already in the tree

- `ARTIFACT_PIN_KINDS` adds `table` and `chart` in [`shared/chat/artifact-pin-notice.ts`](../../shared/chat/artifact-pin-notice.ts).
- `pin_artifact` accepts both kinds in [`server/agents/tools/pin-artifact.ts`](../../server/agents/tools/pin-artifact.ts).
- Client rendering in [`ArtifactRender.tsx`](../../client/src/components/ArtifactRender.tsx): table, legacy `{type,x,y}` SVG, and Vega-Lite via lazy `vega-embed`.
- `parseVegaBody` rejects remote `url` data in [`artifact-render.ts`](../../client/src/lib/artifact-render.ts).
- Stub-client `/demo table` and `/demo chart` triggers for local checks. Remove or gate behind a dev flag before release.

## Goals

1. **Renderer.** Pins of kind `table` and `chart` render below the title chip, centered. Charts are interactive (tooltip, export) via Vega-Lite.
2. **Tool.** `pin_chart` builds a chart from a **prior `sql_query` result** so the model writes only the encoding, never the rows.
3. **Skill.** Seed skill `dataviz` teaches when to chart, how to pick marks, and how to keep specs small and safe.
4. **Mermaid.** `mermaid` pins and ```` ```mermaid ```` fences in chat markdown render as diagrams (flows, sequences, ERDs of lakehouse tables).
5. **Code blocks.** Fenced code in chat markdown and `sql` pins render with a language label, syntax highlighting, and a copy button.
6. **Trust.** Specs are inline-data only. No remote fetch, no secrets, Ask-first like every pin.

## Out of scope

- Genie, MCP, Plotly, Lets-Plot.
- Sandboxed `html` artifact kind (follow-up spec; covers sandbox-made Plotly or Lets-Plot output).
- Library tab drawing charts (labels only today; follow-up).
- Live or scheduled artifacts, artifact versioning.

## Data shapes

### Pin kinds

| kind | body |
| --- | --- |
| `table` | JSON `{ columns: string[], rows: (string \| number \| boolean \| null)[][] }`, max 200 rows rendered |
| `chart` | Vega-Lite v5 JSON with inline `data.values`, or legacy `{ type: "bar" \| "line", x[], y[] }` |
| `mermaid` | Mermaid source text (flowchart, sequence, state, class, ER). Max 16,000 chars |

`ArtifactPinNotice` is unchanged. `artifactKind` stays the discriminant.

### Body size

`MAX_PIN_BODY_CHARS` is 8,000 and is too small for a chart with data. Make the limit per kind:

| kind | max chars |
| --- | --- |
| `note`, `sql`, `volume_path`, `link` | 8,000 |
| `table`, `chart` | 64,000 |
| `mermaid` | 16,000 |

Put the table in `ARTIFACT_BODY_LIMITS: Record<ArtifactPinKind, number>` in `shared/chat/artifact-pin-notice.ts` so the tool and client read one source. Over the limit means the tool returns an error that tells the model to aggregate in SQL (`GROUP BY`, `LIMIT`) or pin a Volume path.

## Tool: `pin_chart`

Ask-first, every bot, **not** Primary-only. Not in `DEFAULT_META_TOOL_NAMES`. Registered in the `ChatService` constructor next to `pin_artifact`.

### Args

```json
{
  "title": "string",
  "source_tool_call_id": "toolCallId of an earlier sql_query in this chat",
  "spec": { "mark": "...", "encoding": { } },
  "summary": "optional one-line preview"
}
```

### Behavior

1. Load the tool row with `toolCallId === source_tool_call_id` from the current chat. Reject if missing or not from `sql_query`.
2. Parse its rows into `{ field: value }[]` using the column names from the result. Reject on parse failure.
3. Validate `spec` (below). Reject a spec that already contains `data`.
4. Build `{ $schema, ...spec, data: { values: rows } }` and cap rows at 1,000. Over the cap returns an error telling the model to aggregate.
5. Write the same `artifact_pin` system message as `pin_artifact` with `artifactKind: "chart"`.
6. Return `{ ok, title, rows, messageId }`.

`pin_artifact` with `kind: "chart"` stays for hand-written small specs. `pin_chart` is the preferred path when rows came from SQL.

### Spec validation (`validateVegaLiteSpec`, shared)

- Must be an object with one of `mark`, `layer`, `facet`, `hconcat`, `vconcat`.
- Reject any `url` key anywhere, and any `data` key in the model-supplied spec for `pin_chart`.
- Allowed marks: `bar`, `line`, `area`, `point`, `circle`, `square`, `tick`, `rect`, `rule`, `text`, `boxplot`, `arc`.
- Reject `$schema` values that are not the `vega.github.io` Vega-Lite v5 URL (or drop the field and set it server-side).
- Reject specs larger than 16,000 chars before data injection.
- Run on **both** server (tool) and client (`parseVegaBody` calls the same function). Move the check to `shared/chat/` so the two cannot drift.

### Open risk to check first

The current `sql_query` result is a string. Confirm its shape (`columns` plus `rows`, or JSON) before wiring step 2. If it is truncated by `maxChars`, a chart built from it would be silently partial. In that case `pin_chart` must refuse truncated results.

## Mermaid

- Add `mermaid` to `ARTIFACT_PIN_KINDS`. `pin_artifact` accepts it. No new tool, the body is just source text.
- Client: lazy `import('mermaid')`, `securityLevel: 'strict'`, `startOnLoad: false`, render to an SVG string with `mermaid.render(id, source)` and mount it. Never use `innerHTML` on unsanitized output beyond what `strict` mode returns. Re-theme from the current color scheme.
- Failure (parse error): show the code block fallback below with the error text as a caption.
- Supported types are an allowlist: `flowchart`, `graph`, `sequenceDiagram`, `stateDiagram`, `classDiagram`, `erDiagram`. Reject others and any `%%{init` directive (blocks config injection).
- Inline fences: ```` ```mermaid ```` in assistant markdown render through the same component via `ChatMarkdown`.

## Code blocks

[`ChatMarkdown.tsx`](../../client/src/components/ChatMarkdown.tsx) has no `code` override today, so fences render as plain `<pre>`. Add a `CodeBlock` component:

- Override `code`/`pre` in `ChatMarkdown` `components`. Inline code stays as is.
- Header row: language label (from the fence, default `text`) and a copy button. Copy uses `navigator.clipboard.writeText` and shows a short "Copied" state.
- Highlighting: use `highlight.js` core with only `sql`, `python`, `json`, `bash`, `yaml`, `typescript` registered, lazy-loaded, to keep the bundle small. Unknown languages render unhighlighted. Pick `highlight.js` over `shiki` because it has no WASM or grammar loading at runtime. Revisit if token quality matters.
- Long blocks: `max-height` with scroll, no wrapping by default.
- Routing: ` ```mermaid ` goes to the Mermaid renderer, ` ```vega-lite ` or ` ```json ` with a Vega-Lite spec stays a code block (charts only render from pins, so that unreviewed model text cannot trigger a render).
- `sql` pins use `CodeBlock` with language `sql` instead of the bare chip.
- Security: output goes through React text nodes or `highlight.js` `highlight()` result escaped by the library. No `rehype-raw`, raw HTML stays escaped.

## Skill: `dataviz`

Add to `SEED_SKILLS` in [`shared/agents/seed-skills.ts`](../../shared/agents/seed-skills.ts), following the Grok six-part contract used by `pin-finding`.

- **When to use.** The user asks for a trend, comparison, distribution, or ranking over a SQL result, or a small result is clearer as a table than as prose.
- **Inputs.** A finished `sql_query` already aggregated to at most a few hundred rows.
- **Sequence.**
  1. Aggregate in SQL first (`GROUP BY`, date truncation, `LIMIT`).
  2. Pick the form: `table` for lookup, `mermaid` for process, schema, or lineage diagrams, `line` for time, `bar` for category compare, `point` for relationships, `rect` for two-dimensional density.
  3. Call `pin_chart` with only the Vega-Lite encoding. Set `tooltip: true`, label axes, use `ordinal` with explicit `sort` for months or ranks.
  4. State the takeaway in one sentence in the reply.
- **Validate.** Row count is under the cap, field names match the SQL aliases, no remote data, no secrets or raw PII columns.
- **Return.** The takeaway plus the pin chip. Do not paste the spec in the reply.
- **Approval.** Every `pin_chart` and `pin_artifact` call is Ask-first.

### Catalog and prompt

- Register the tool so `buildCapabilityCatalog` lists `pin_chart`.
- `formatCapabilityPrompt` gets one line: prefer `pin_chart` over typing rows into `pin_artifact`.
- Add a label in [`shared/agents/tool-labels.ts`](../../shared/agents/tool-labels.ts).

## Rendering behavior

- Layout: title chip on top, artifact centered below (`.artifact-pin`).
- Vega: lazy `import('vega-embed')`, SVG renderer, transparent background, export action only. Cleanup with `view.finalize()` on unmount.
- Failure: any validation or embed error falls back to a `<pre>` of the spec.
- Dark mode: pass the Vega `config` theme from the current color scheme (follow-up if colors clash in the prototype).

## Files

| Path | Change |
| --- | --- |
| `shared/chat/artifact-pin-notice.ts` | Kinds const, per-kind body limits |
| `shared/chat/vega-spec.ts` (new) | `validateVegaLiteSpec`, shared by server and client |
| `server/agents/tools/pin-chart.ts` (new) | Tool definition, plan, execute |
| `server/agents/tools/pin-artifact.ts` | Use per-kind limits |
| `server/chat/service.ts` | Register `pin_chart`, Ask-first |
| `shared/agents/seed-skills.ts` | `dataviz` seed |
| `shared/agents/tool-labels.ts`, `capability-catalog.ts` | Label and prompt line |
| `client/src/components/ArtifactRender.tsx`, `client/src/lib/artifact-render.ts` | Call shared validator, add `mermaid` and `sql` branches |
| `client/src/components/CodeBlock.tsx` (new) | Language label, highlight, copy |
| `client/src/components/MermaidDiagram.tsx` (new) | Lazy mermaid render with allowlist and fallback |
| `client/src/components/ChatMarkdown.tsx` | `code`/`pre` overrides, route `mermaid` fences |
| `shared/chat/mermaid-source.ts` (new) | `validateMermaidSource` (type allowlist, no `%%{init`), shared with the tool |
| `server/agents/clients/stub-client.ts` | Gate `/demo` triggers behind a dev env flag |

## Acceptance

- [x] Unit: `validateVegaLiteSpec` accepts a valid bar/line spec, rejects `url`, `data`, unknown marks, oversize.
- [x] Unit: `pin_chart` injects rows from a prior `sql_query` tool row, rejects unknown or non-SQL `source_tool_call_id`, rejects truncated results, caps rows.
- [x] Unit: pin body limits per kind.
- [x] Unit: seed `dataviz` activates via `activate_skill`; catalog lists `pin_chart`.
- [x] Unit: `validateMermaidSource` accepts the six allowed types, rejects `%%{init`, unknown types, and oversize.
- [x] Unit: `ChatMarkdown` renders a fenced `sql` block with label and copy button, and a `mermaid` fence through the diagram component.
- [x] Unit: raw HTML inside a code fence stays escaped.
- [x] Unit: client parser and server validator agree on the same fixture set.
- [x] Manual (localhost): chart, table, mermaid diagram and a highlighted SQL block render, tooltip and copy work, bad spec or bad mermaid falls back to a code block.
- [x] `npm run typecheck` and `npm test` pass.
- [x] Bundle: record the `vega-embed`, `mermaid` and `highlight.js` chunk sizes and confirm each loads only when needed.
- [x] No Genie or MCP changes.

## Non-goals

Always-allow for `pin_chart` by default, server-side rendering to PNG, user-editable specs or diagrams, Mermaid directives and click callbacks.
