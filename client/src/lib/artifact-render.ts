import { validateVegaLiteSpec, type VegaSpec } from '../../../shared/chat/vega-spec';

export interface TableData {
  columns: string[];
  rows: (string | number | boolean | null)[][];
}

export interface ChartData {
  type: 'bar' | 'line';
  x: string[];
  y: number[];
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/** Columns are names, or `{ name, type }` objects as `sql_query` returns them. */
function columnName(column: unknown): string | null {
  if (typeof column === 'string') return column;
  if (column && typeof column === 'object' && 'name' in column && typeof column.name === 'string') {
    return column.name;
  }
  return null;
}

export function parseTableBody(body: string): TableData | null {
  const v = parseJson(body) as { columns?: unknown; rows?: unknown } | null;
  if (!v || !Array.isArray(v.columns) || !Array.isArray(v.rows)) return null;
  const columns = v.columns.map(columnName);
  if (!columns.every((c) => c !== null)) return null;
  if (!v.rows.every((r) => Array.isArray(r))) return null;
  return { columns, rows: (v.rows as TableData['rows']).slice(0, 200) };
}

export function parseChartBody(body: string): ChartData | null {
  const v = parseJson(body) as Partial<ChartData> | null;
  if (!v || (v.type !== 'bar' && v.type !== 'line')) return null;
  if (!Array.isArray(v.x) || !Array.isArray(v.y) || v.x.length !== v.y.length) return null;
  if (v.x.length === 0 || !v.y.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return null;
  }
  return { type: v.type, x: v.x.map(String), y: v.y };
}

export type { VegaSpec };

/** Stored chart pins hold inline data; reuse the shared server-side validator. */
export function parseVegaBody(body: string): VegaSpec | null {
  const checked = validateVegaLiteSpec(parseJson(body), { allowData: true });
  return checked.ok ? checked.spec : null;
}
