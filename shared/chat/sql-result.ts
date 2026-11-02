export const SQL_TRUNCATION_MARKER = '…[truncated]';

export type SqlRow = Record<string, string | number | null>;

export type SqlResultParse = { ok: true; columns: string[]; rows: SqlRow[] } | { ok: false; error: string };

function cell(text: string): string | number | null {
  if (text === '') return null;
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(text)) {
    const n = Number(text);
    if (Number.isFinite(n)) return n;
  }
  return text;
}

/**
 * Parse the tab-separated text that `sql_query` returns (header line, then one line per row).
 * Refuses truncated or error output so a chart is never built from partial data.
 */
export function parseSqlQueryResult(text: string): SqlResultParse {
  if (text.includes(SQL_TRUNCATION_MARKER)) {
    return { ok: false, error: 'sql_query result was truncated; aggregate or LIMIT the query and run it again' };
  }
  if (/^sql_query /.test(text)) {
    return { ok: false, error: 'source sql_query did not succeed' };
  }
  if (text.trim() === '(no rows)') return { ok: false, error: 'source sql_query returned no rows' };
  const lines = text.split('\n');
  const columns = (lines[0] ?? '').split('\t');
  if (columns.length === 0 || columns.some((c) => !c.trim())) {
    return { ok: false, error: 'source result has no usable header' };
  }
  const rows: SqlRow[] = [];
  for (const line of lines.slice(1)) {
    if (!line) continue;
    const parts = line.split('\t');
    if (parts.length !== columns.length) {
      return { ok: false, error: 'source result rows do not match the header (values with tabs or newlines)' };
    }
    const row: SqlRow = {};
    columns.forEach((name, i) => {
      row[name] = cell(parts[i] ?? '');
    });
    rows.push(row);
  }
  if (rows.length === 0) return { ok: false, error: 'source sql_query returned no rows' };
  return { ok: true, columns, rows };
}
