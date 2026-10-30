/**
 * Built-in lakehouse skills (Grok “account-wide skills” analogue).
 * Available to every bot via the Skills index + activate_skill.
 * A bot_skills row with the same name overrides the seed body.
 */

export interface SeedSkill {
  name: string;
  body: string;
}

const SQL_EXPLORE = `# sql-explore

## When to use
User wants to find or understand tables, row samples, or answer a lakehouse question with SQL. Prefer this over guessing schemas from memory.

## Required inputs and access
- Unity Catalog / warehouse available (\`sql_query\`, \`lakehouse_catalog\`)
- Clear question or object name (catalog.schema.table or keyword)

## Sequence of work
1. Call \`activate_skill\` only if you need this full body again mid-task.
2. Use \`lakehouse_catalog\` to locate catalogs → schemas → tables → columns (narrow with identifiers).
3. Run read-only \`sql_query\` (\`SELECT\` / \`WITH\` / \`SHOW\` / \`DESCRIBE\` / \`EXPLAIN\` only). Prefer \`LIMIT\` (e.g. 20–100) for samples.
4. Cite the exact SQL and object names in the reply.

## How to validate
- Statement is a single read-only query; no DDL/DML.
- Results match the user’s question; if empty, say so and suggest a narrower catalog path.

## What to return
- Short answer first, then key columns / sample rows, then the SQL used.
- If blocked by approvals, stop and wait — do not invent data.

## What requires approval
- Every \`sql_query\` / \`lakehouse_catalog\` call until the user allows the tool for this chat.
- Never write tables, never remember secrets from query results.
`;

const CATALOG_RECON = `# catalog-recon

## When to use
User asks what exists in the metastore, how a domain is modeled, or to map ownership of tables across catalogs/schemas.

## Required inputs and access
- \`lakehouse_catalog\` (and \`sql_query\` for \`DESCRIBE\` / \`SHOW\` when needed)
- Optional: domain keyword, catalog, or schema name

## Sequence of work
1. Start wide: list catalogs (or the named catalog).
2. Drill into relevant schemas, then tables, then columns for the objects that matter.
3. Summarize relationships in plain language (fact vs dim, naming patterns).
4. Offer 1–3 follow-up \`sql_query\` samples the user can approve.

## How to validate
- Every object name came from a tool result, not memory alone.
- If memory contradicts catalog, trust catalog and \`forget\` or correct the memory key.

## What to return
- A compact map: catalog → schema → tables (with 1-line purpose when obvious from names/columns).
- Gaps / unknowns called out explicitly.

## What requires approval
- Catalog and SQL tools as usual (Ask-first until allowed).
- Do not export PII samples beyond small \`LIMIT\` peeks the user asked for.
`;

const WEEKLY_TABLE_HEALTH = `# weekly-table-health

## When to use
Recurring or one-off “is this table healthy?” checks — row volume, freshness, null spikes — suitable to save as a Routine after a successful Test.

## Required inputs and access
- Fully qualified table name(s)
- Freshness rule (e.g. max lag on a date/timestamp column) stated by the user
- \`sql_query\` read-only access

## Sequence of work
1. Confirm table + columns via \`lakehouse_catalog\` or \`DESCRIBE\`.
2. Run bounded aggregates: row count, min/max of the freshness column, null rates on critical columns (\`LIMIT\` not needed for aggregates; keep statements single and read-only).
3. Compare to the user’s threshold. If source data is missing or query fails, **report failure** — do not reuse last week’s numbers from memory.
4. Optionally \`save_skill\` a tightened variant after a good run; only then suggest a Routine.

## How to validate
- Freshness column exists and is the one the user named.
- Failure path is explicit (no silent stale substitute).

## What to return
- Pass / warn / fail with metrics and the SQL used.
- One-line recommendation (investigate / ok for automation).

## What requires approval
- All SQL until auto-allowed.
- Never contact users, never mutate tables, never schedule a Routine without the user confirming the schedule and approval boundary.
`;

const PIN_FINDING = `# pin-finding

## When to use
After a successful lakehouse explore when the user (or you) should keep a **shareable finding** visible in this chat — a SQL snippet, small table summary, Volume path to a report, or external link. Not for private rules or preferences.

## Required inputs and access
- A clear title and \`pin_artifact\` kind: \`note\` | \`sql\` | \`volume_path\` | \`link\`
- Short \`body\` (markdown, SQL, path, or URL). Large blobs belong on a Volume — pin the path with kind \`volume_path\`.
- Tool access to \`pin_artifact\` (Ask-first until the user allows it for this chat)

## Sequence of work
1. Finish the explore with tools (\`sql_query\`, \`lakehouse_catalog\`, \`volume_read\`) and validate the answer.
2. Choose pin vs memory: use \`remember\` for lasting rules; use \`pin_artifact\` for findings others should see in the transcript.
3. Call \`pin_artifact\` with title, kind, body, and optional one-line \`summary\` for roster preview.
4. Tell the user the pin is on the chat once approved.

## How to validate
- Body is short and non-secret (no tokens, passwords, or raw PII dumps).
- SQL pins are read-only snippets that matched the explore; paths are real Volume locations when used.

## What to return
- Confirm what was pinned (title + kind) and point to the pin chip in the transcript.

## What requires approval
- Every \`pin_artifact\` call until the user allows the tool for this chat.
- Never pin secrets; never skip approval by stuffing large content into \`body\` — use a Volume path instead.
`;

const DATAVIZ = `# dataviz

## When to use
The user wants a trend, comparison, distribution, histogram, ranking, or process/schema diagram, or a result reads better as an interactive chart or table than as prose.

## Required inputs and access
- Either a successful \`sql_query\` aggregated to at most a few hundred rows, OR summary bins/series computed in \`python_exec\`.
- Tool access to \`pin_chart\` (charts from SQL) and \`pin_artifact\` (kind \`chart\`, \`table\`, or \`mermaid\`); both are Ask-first.

## Sequence of work
1. Aggregate first: in SQL (GROUP BY, date truncation, LIMIT) or in Python (bin histograms/bootstrap distributions into 15-50 summary rows and print JSON).
2. Pick the form: \`table\` for lookup; \`line\` for time; \`bar\` for category comparison or histograms; \`point\` for relationships; \`rect\` for two-dimensional density; \`mermaid\` for process, lineage, or ER diagrams.
3. If the rows came from \`sql_query\`, call \`pin_chart\` with title, \`source_tool_call_id\`, and a Vega-Lite v5 spec with only mark and encoding (no data or url).
4. If the rows came from \`python_exec\` or in-turn calculations, call \`pin_artifact\` with kind \`chart\` and body set to a Vega-Lite v5 JSON string including inline \`data: { values: [...] }\`, \`mark\`, and \`encoding\` (plus optional \`layer\` with a \`rule\` mark for observed means or confidence intervals). Never say you cannot attach images or fall back to ASCII/Unicode bar charts.
5. For tables or diagrams call \`pin_artifact\` with kind \`table\` ({columns, rows}) or \`mermaid\` (flowchart, sequenceDiagram, stateDiagram, classDiagram, erDiagram only).
6. State the takeaway in one sentence.

## How to validate
- Row count is small; field names match the data keys; no secrets or raw PII columns.
- If pin_chart reports truncation or too many rows, tighten the query and run it again.

## What to return
- The one-sentence takeaway and a pointer to the pin in the transcript. Do not paste the spec or draw text bars.

## What requires approval
- Every \`pin_chart\` and \`pin_artifact\` call until the user allows the tool for this chat.
`;

/** Stable pack — add new seeds carefully; name changes orphan overrides. */
export const SEED_SKILLS: readonly SeedSkill[] = [
  { name: 'sql-explore', body: SQL_EXPLORE.trim() + '\n' },
  { name: 'catalog-recon', body: CATALOG_RECON.trim() + '\n' },
  { name: 'weekly-table-health', body: WEEKLY_TABLE_HEALTH.trim() + '\n' },
  { name: 'pin-finding', body: PIN_FINDING.trim() + '\n' },
  { name: 'dataviz', body: DATAVIZ.trim() + '\n' },
] as const;

export function seedSkillByName(name: string): SeedSkill | undefined {
  const needle = name.trim().toLowerCase();
  if (!needle) return undefined;
  return SEED_SKILLS.find((skill) => skill.name.toLowerCase() === needle);
}
