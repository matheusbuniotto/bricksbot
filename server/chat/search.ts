/** Rules shared by the Lakebase and in-memory ChatStore search. */

export const SEARCH_LIMIT = 20;

const SNIPPET_RADIUS = 60;

/** The lowercase words of a query. */
export function searchTerms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/** The text around the first matching word, flattened to one line. */
export function snippetAround(content: string, query: string): string {
  const flat = content.replace(/\s+/g, ' ').trim();
  const lower = flat.toLowerCase();
  const matches = searchTerms(query)
    .map((term) => lower.indexOf(term))
    .filter((at) => at >= 0);
  const start = matches.length ? Math.max(0, Math.min(...matches) - SNIPPET_RADIUS) : 0;
  const end = start + SNIPPET_RADIUS * 2;
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
}
