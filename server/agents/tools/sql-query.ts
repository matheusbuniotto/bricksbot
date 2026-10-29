import type { ToolDefinition } from '../../../shared/agents/types.js';

const ALLOWED_PREFIXES = new Set(['SELECT', 'WITH', 'SHOW', 'DESCRIBE', 'EXPLAIN']);

export interface SqlStatementRequest {
  statement: string;
  warehouseId: string;
}

export interface SqlQueryToolOptions {
  warehouseId?: string;
  host?: string;
  getToken?: () => Promise<string>;
  executeImpl?: (input: SqlStatementRequest) => Promise<string>;
  fetchImpl?: typeof fetch;
  maxChars?: number;
}

export const sqlQueryToolDefinition: ToolDefinition = {
  name: 'sql_query',
  description:
    'Run one read-only SQL statement (SELECT, WITH, SHOW, DESCRIBE, or EXPLAIN) on a Databricks SQL warehouse. Requires user approval.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      statement: {
        type: 'string',
        description: 'A single SELECT, WITH, SHOW, DESCRIBE, or EXPLAIN statement',
      },
      warehouse_id: {
        type: 'string',
        description: 'SQL warehouse id. Defaults to DATABRICKS_WAREHOUSE_ID when omitted.',
      },
    },
    required: ['statement'],
  },
};

function presentEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === '__UNSET__') return undefined;
  return trimmed;
}

export function sqlQueryConfigFromEnv(
  env: Record<string, string | undefined>
): Pick<SqlQueryToolOptions, 'warehouseId' | 'host' | 'getToken'> {
  const token = presentEnv(env.DATABRICKS_TOKEN);
  return {
    warehouseId: presentEnv(env.DATABRICKS_WAREHOUSE_ID),
    host: presentEnv(env.DATABRICKS_HOST) ?? presentEnv(env.DATABRICKS_WORKSPACE_URL),
    getToken: token ? () => Promise.resolve(token) : undefined,
  };
}

/**
 * Reject anything that is not one read-only statement.
 * Comments and string literals are ignored so a semicolon inside a literal is not a second statement.
 */
export function readOnlySqlError(statement: string): string | null {
  if (!statement.trim()) {
    return 'sql_query requires a statement';
  }
  const stripped = stripSqlForCheck(statement)
    .trim()
    .replace(/;+\s*$/u, '')
    .trim();
  if (!stripped) {
    return 'sql_query requires a statement';
  }
  if (stripped.includes(';')) {
    return 'sql_query allows one statement';
  }
  const keyword = /^([A-Za-z]+)/.exec(stripped)?.[1]?.toUpperCase();
  if (!keyword || !ALLOWED_PREFIXES.has(keyword)) {
    return 'sql_query only allows SELECT, WITH, SHOW, DESCRIBE, or EXPLAIN';
  }
  return null;
}

function stripSqlForCheck(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === '-' && next === '-') {
      const newline = sql.indexOf('\n', i + 2);
      i = newline === -1 ? sql.length : newline + 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 2;
      out += ' ';
      continue;
    }
    if (ch === "'") {
      i += 1;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          i += 1;
          break;
        }
        i += 1;
      }
      out += "''";
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function clip(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n…[truncated]` : text;
}

interface StatementBody {
  status?: { state?: string; error?: { message?: string } };
  manifest?: { schema?: { columns?: Array<{ name?: string }> } };
  result?: { data_array?: unknown[][] };
}

function cellText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return JSON.stringify(value) ?? '';
}

function formatStatementResult(body: unknown, maxChars: number): string {
  const row = (body && typeof body === 'object' ? body : {}) as StatementBody;
  const state = row.status?.state ?? 'UNKNOWN';
  if (state !== 'SUCCEEDED') {
    const detail = row.status?.error?.message ?? 'statement did not finish';
    return clip(`sql_query ${state}: ${detail}`, maxChars);
  }
  const columns = (row.manifest?.schema?.columns ?? []).map((column) => column.name ?? '');
  const data = row.result?.data_array ?? [];
  const lines = [columns.join('\t'), ...data.map((record) => record.map((value) => cellText(value)).join('\t'))].filter(
    (line) => line.length > 0
  );
  return clip(lines.join('\n') || '(no rows)', maxChars);
}

async function executeSqlStatement(
  input: SqlStatementRequest & {
    host: string;
    getToken: () => Promise<string>;
    fetchImpl: typeof fetch;
    maxChars: number;
  }
): Promise<string> {
  const host = input.host.replace(/\/+$/, '');
  const token = await input.getToken();
  const response = await input.fetchImpl(`${host}/api/2.0/sql/statements`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      warehouse_id: input.warehouseId,
      statement: input.statement,
      wait_timeout: '30s',
      disposition: 'INLINE',
      format: 'JSON_ARRAY',
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    return clip(`sql_query failed (${response.status}): ${text}`, input.maxChars);
  }
  try {
    return formatStatementResult(JSON.parse(text) as unknown, input.maxChars);
  } catch {
    return 'sql_query error: response was not JSON';
  }
}

export function createSqlQueryTool(options: SqlQueryToolOptions = {}) {
  const maxChars = options.maxChars ?? 20_000;

  return {
    definition: sqlQueryToolDefinition,
    preflight(args: Record<string, unknown>): string | null {
      const statement = typeof args.statement === 'string' ? args.statement : '';
      return readOnlySqlError(statement);
    },
    async execute(args: Record<string, unknown>): Promise<string> {
      const statement = typeof args.statement === 'string' ? args.statement : '';
      const refusal = readOnlySqlError(statement);
      if (refusal) return refusal;

      const fromArgs = typeof args.warehouse_id === 'string' ? args.warehouse_id.trim() : '';
      const warehouseId = fromArgs || options.warehouseId?.trim() || '';
      if (!warehouseId) {
        return 'sql_query error: warehouse_id is required. Pass warehouse_id or set DATABRICKS_WAREHOUSE_ID.';
      }

      const trimmed = statement.trim();
      if (options.executeImpl) {
        return options.executeImpl({ statement: trimmed, warehouseId });
      }

      const host = options.host?.trim();
      if (!host || !options.getToken) {
        return 'sql_query error: Databricks workspace is not configured. Set DATABRICKS_HOST and DATABRICKS_TOKEN.';
      }

      try {
        return await executeSqlStatement({
          host,
          warehouseId,
          statement: trimmed,
          getToken: options.getToken,
          fetchImpl: options.fetchImpl ?? globalThis.fetch,
          maxChars,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown error';
        return `sql_query error: ${message}`;
      }
    },
  };
}
