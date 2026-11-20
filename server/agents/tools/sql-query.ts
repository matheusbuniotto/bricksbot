import type { ToolDefinition } from '../../../shared/agents/types.js';
import { createDatabricksTokenProvider, normalizeHostUrl } from '../../chat/databricks-auth.js';
import { UnityGatewayMcpClient } from './mcp-client.js';
import { clip, readText } from '../../lib/coerce.js';
import { presentEnv } from '../../lib/env.js';
import type { HandoffTurnContext } from '../handoff.js';

export { normalizeHostUrl };

const ALLOWED_PREFIXES = new Set(['SELECT', 'WITH', 'SHOW', 'DESCRIBE', 'EXPLAIN']);
export const DEFAULT_DBSQL_SERVICE = 'system.ai.dbsql';

export interface SqlStatementRequest {
  statement: string;
  warehouseId: string;
}

export interface SqlQueryToolOptions {
  warehouseId?: string;
  host?: string;
  /** Workspace org id for Unity Gateway MCP (`?o=`). */
  workspaceId?: string;
  getToken?: () => Promise<string>;
  executeImpl?: (input: SqlStatementRequest) => Promise<string>;
  fetchImpl?: typeof fetch;
  maxChars?: number;
  /** MCP service used when no warehouse_id is configured. */
  dbsqlServiceName?: string;
  mcpPollSeconds?: number;
  mcpPollIntervalMs?: number;
}

export const sqlQueryToolDefinition: ToolDefinition = {
  name: 'sql_query',
  description:
    'Run one read-only SQL statement (SELECT, WITH, SHOW, DESCRIBE, or EXPLAIN) on Databricks SQL. ' +
    'Uses the signed-in user permissions when available. Prefer the bound warehouse; falls back to system.ai.dbsql when none is set. Requires user approval.',
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
        description:
          'SQL warehouse id. Defaults to DATABRICKS_WAREHOUSE_ID. Omit to use system.ai.dbsql when no warehouse is bound.',
      },
    },
    required: ['statement'],
  },
};

export function sqlQueryConfigFromEnv(
  env: Record<string, string | undefined>,
  options?: { fetchImpl?: typeof fetch }
): Pick<SqlQueryToolOptions, 'warehouseId' | 'host' | 'workspaceId' | 'getToken'> {
  const rawHost = presentEnv(env.DATABRICKS_HOST) ?? presentEnv(env.DATABRICKS_WORKSPACE_URL);
  const host = rawHost ? normalizeHostUrl(rawHost) : undefined;
  // Prefer request OBO → PAT → app SP M2M so Apps respect Unity Catalog user grants.
  const getToken = createDatabricksTokenProvider({ env, fetchImpl: options?.fetchImpl });
  return {
    warehouseId: presentEnv(env.DATABRICKS_WAREHOUSE_ID),
    host,
    workspaceId: presentEnv(env.DATABRICKS_WORKSPACE_ID),
    getToken,
  };
}

const MUTATING_KEYWORDS = new RegExp(
  '\\b(' +
    [
      'INSERT',
      'UPDATE',
      'DELETE',
      'MERGE',
      'DROP',
      'ALTER',
      'CREATE',
      'TRUNCATE',
      'OVERWRITE',
      'GRANT',
      'REVOKE',
      'COPY',
      'OPTIMIZE',
      'VACUUM',
      'RESTORE',
    ].join('|') +
    ')\\b',
  'i'
);

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
  if (keyword === 'WITH' && MUTATING_KEYWORDS.test(stripped)) {
    return 'sql_query only allows read-only statements (mutating keywords inside WITH are blocked)';
  }
  return null;
}

/** Blank out comments, string literals, and quoted identifiers, following Databricks SQL quoting rules. */
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
    if (ch === "'" || ch === '"' || ch === '`') {
      const backslashEscapes = ch !== '`' && !isRawStringPrefix(sql, i);
      i = skipQuoted(sql, i, backslashEscapes);
      out += `${ch}${ch}`;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** `r'...'` / `R"..."` raw literals do not treat backslash as an escape. */
function isRawStringPrefix(sql: string, quoteIndex: number): boolean {
  return /[rR]/.test(sql[quoteIndex - 1] ?? '') && !/\w/.test(sql[quoteIndex - 2] ?? '');
}

/** Index just past the quoted run that opens at `start` (doubled quotes and, optionally, `\` escape). */
function skipQuoted(sql: string, start: number, backslashEscapes: boolean): number {
  const quote = sql[start];
  let i = start + 1;
  while (i < sql.length) {
    if (backslashEscapes && sql[i] === '\\') {
      i += 2;
      continue;
    }
    if (sql[i] === quote) {
      if (sql[i + 1] !== quote) return i + 1;
      i += 2;
      continue;
    }
    i += 1;
  }
  return i;
}

interface StatementBody {
  status?: { state?: string; error?: { message?: string } };
  manifest?: { schema?: { columns?: Array<{ name?: string }> } };
  result?: {
    data_array?: unknown[][];
    data_typed_array?: Array<{ values?: Array<Record<string, unknown> | null> }>;
  };
  statement_id?: string;
}

function cleanCellText(text: string): string {
  return text.replace(/[\r\n\t]+/g, ' ');
}

function cellText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return cleanCellText(value);
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return cleanCellText(JSON.stringify(value) ?? '');
}

/** Value keys seen across Statement API / MCP typed-array encodings, in lookup order. */
const TYPED_CELL_KEYS = [
  'str',
  'string_value',
  'double',
  'double_value',
  'f64',
  'long',
  'long_value',
  'i64',
  'boolean',
  'boolean_value',
  'bool',
  'date_value',
  'date',
  'timestamp_value',
  'timestamp',
  'decimal_value',
  'decimal',
];

function typedCellText(cell: Record<string, unknown> | null | undefined): string {
  if (!cell) return '';
  if (cell.null === true || cell.is_null === true) return '';
  const key = TYPED_CELL_KEYS.find((candidate) => candidate in cell);
  return cellText(key ? cell[key] : cell);
}

const TERMINAL_STATES = new Set(['SUCCEEDED', 'FAILED', 'CANCELED', 'CLOSED']);

function isStatementPending(body: StatementBody | null): body is StatementBody & { statement_id: string } {
  const state = body?.status?.state;
  return Boolean(body?.statement_id && state && !TERMINAL_STATES.has(state));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function formatStatementResult(body: unknown, maxChars: number, label = 'sql_query'): string {
  const row = (body && typeof body === 'object' ? body : {}) as StatementBody;
  const state = row.status?.state ?? 'UNKNOWN';
  if (state !== 'SUCCEEDED') {
    const detail = row.status?.error?.message ?? 'statement did not finish';
    return clip(`${label} ${state}: ${detail}`, maxChars);
  }
  const columns = (row.manifest?.schema?.columns ?? []).map((column) => column.name ?? '');
  let data: string[][] = [];
  if (Array.isArray(row.result?.data_array)) {
    data = row.result.data_array.map((record) => record.map((value) => cellText(value)));
  } else if (Array.isArray(row.result?.data_typed_array)) {
    data = row.result.data_typed_array.map((record) => (record.values ?? []).map((value) => typedCellText(value)));
  }
  const lines = [columns.join('\t'), ...data.map((record) => record.join('\t'))].filter((line) => line.length > 0);
  return clip(lines.join('\n') || '(no rows)', maxChars);
}

async function executeSqlStatement(
  input: SqlStatementRequest & {
    host: string;
    getToken: () => Promise<string>;
    fetchImpl: typeof fetch;
    maxChars: number;
    pollSeconds?: number;
    pollIntervalMs?: number;
    /** Stop: ends the request and the polling (the warehouse statement itself is not cancelled). */
    signal?: AbortSignal;
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
    signal: input.signal,
  });
  const text = await response.text();
  if (!response.ok) {
    return clip(`sql_query failed (${response.status}): ${text}`, input.maxChars);
  }
  let body: StatementBody;
  try {
    body = JSON.parse(text) as StatementBody;
  } catch {
    return 'sql_query error: response was not JSON';
  }

  const pollDeadline = Date.now() + (input.pollSeconds ?? 50) * 1000;
  let interval = input.pollIntervalMs ?? 500;

  while (isStatementPending(body) && Date.now() < pollDeadline && !input.signal?.aborted) {
    await sleep(interval);
    interval = Math.min(Math.round(interval * 1.5), 2000);
    const pollRes = await input.fetchImpl(`${host}/api/2.0/sql/statements/${encodeURIComponent(body.statement_id)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: input.signal,
    });
    if (!pollRes.ok) break;
    try {
      body = (await pollRes.json()) as StatementBody;
    } catch {
      break;
    }
  }

  return formatStatementResult(body, input.maxChars);
}

function parseMcpPayload(text: string, structured?: unknown): StatementBody | null {
  if (structured && typeof structured === 'object') {
    return structured as StatementBody;
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === 'object') return parsed as StatementBody;
  } catch {
    // plain text
  }
  return null;
}

async function executeViaDbsqlMcp(input: {
  statement: string;
  host: string;
  workspaceId?: string;
  getToken: () => Promise<string>;
  fetchImpl: typeof fetch;
  maxChars: number;
  serviceName: string;
  pollSeconds: number;
  pollIntervalMs: number;
}): Promise<string> {
  const client = new UnityGatewayMcpClient({
    host: input.host,
    workspaceId: input.workspaceId,
    getToken: input.getToken,
    fetchImpl: input.fetchImpl,
    timeoutMs: Math.max(30_000, input.pollSeconds * 1000),
  });

  const call = await client.callTool(input.serviceName, 'execute_sql', { query: input.statement });
  if (call.isError) {
    return clip(`sql_query error (system.ai.dbsql): ${call.content[0]?.text ?? 'unknown error'}`, input.maxChars);
  }

  let text = call.content[0]?.text ?? '';
  let payload = parseMcpPayload(text, (call as { structuredContent?: unknown }).structuredContent);

  const pollDeadline = Date.now() + input.pollSeconds * 1000;
  while (isStatementPending(payload) && Date.now() < pollDeadline) {
    await sleep(input.pollIntervalMs);
    const poll = await client.callTool(input.serviceName, 'poll_sql_result', {
      statement_id: payload.statement_id,
    });
    if (poll.isError) {
      return clip(
        `sql_query error (system.ai.dbsql poll): ${poll.content[0]?.text ?? 'unknown error'}`,
        input.maxChars
      );
    }
    text = poll.content[0]?.text ?? '';
    payload = parseMcpPayload(text, (poll as { structuredContent?: unknown }).structuredContent);
  }

  if (!payload) {
    return clip(text || '(no rows)', input.maxChars);
  }
  return formatStatementResult(payload, input.maxChars, 'sql_query');
}

/**
 * Shared executor for sql_query / lakehouse_catalog: warehouse Statements API,
 * else system.ai.dbsql MCP when no warehouse is bound.
 */
export async function executeReadOnlySql(
  options: SqlQueryToolOptions,
  statement: string,
  warehouseIdFromArgs?: string,
  signal?: AbortSignal
): Promise<string> {
  const maxChars = options.maxChars ?? 20_000;
  const trimmed = statement.trim();
  const warehouseId = (warehouseIdFromArgs ?? '').trim() || options.warehouseId?.trim() || '';

  if (options.executeImpl) {
    return options.executeImpl({ statement: trimmed, warehouseId: warehouseId || 'mcp' });
  }

  const rawHost = options.host?.trim();
  if (!rawHost || !options.getToken) {
    return (
      'sql_query error: Databricks workspace is not configured. ' +
      'Set DATABRICKS_HOST and bind a SQL warehouse (DATABRICKS_WAREHOUSE_ID), ' +
      'or enable system.ai.dbsql via host + user/app credentials. ' +
      'Auth uses the signed-in user token on Apps, or DATABRICKS_TOKEN / CLIENT_ID+SECRET locally.'
    );
  }
  const host = normalizeHostUrl(rawHost);

  try {
    if (warehouseId) {
      return await executeSqlStatement({
        host,
        warehouseId,
        statement: trimmed,
        getToken: options.getToken,
        fetchImpl: options.fetchImpl ?? globalThis.fetch,
        maxChars,
        pollSeconds: options.mcpPollSeconds ?? 50,
        pollIntervalMs: options.mcpPollIntervalMs ?? 1000,
        signal,
      });
    }

    return await executeViaDbsqlMcp({
      statement: trimmed,
      host,
      workspaceId: options.workspaceId,
      getToken: options.getToken,
      fetchImpl: options.fetchImpl ?? globalThis.fetch,
      maxChars,
      serviceName: options.dbsqlServiceName ?? DEFAULT_DBSQL_SERVICE,
      pollSeconds: options.mcpPollSeconds ?? 30,
      pollIntervalMs: options.mcpPollIntervalMs ?? 1000,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return `sql_query error: ${message}`;
  }
}

export function createSqlQueryTool(options: SqlQueryToolOptions = {}) {
  return {
    definition: sqlQueryToolDefinition,
    preflight(args: Record<string, unknown>): string | null {
      const statement = typeof args.statement === 'string' ? args.statement : '';
      return readOnlySqlError(statement);
    },
    async execute(args: Record<string, unknown>, ctx?: HandoffTurnContext): Promise<string> {
      const statement = typeof args.statement === 'string' ? args.statement : '';
      const refusal = readOnlySqlError(statement);
      if (refusal) return refusal;
      const fromArgs = readText(args.warehouse_id);
      return executeReadOnlySql(options, statement, fromArgs, ctx?.run?.signal);
    },
  };
}
