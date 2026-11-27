import { clip } from '../lib/coerce.js';

/** Thin clients for the two Databricks APIs the knowledge base uses. Every call takes the token to send. */

export type TokenSource = () => Promise<string>;

export interface SqlParam {
  name: string;
  value: string | null;
  type?: 'STRING' | 'INT';
}

export interface StatementResult {
  columns: string[];
  rows: unknown[][];
}

export interface StatementRunner {
  run(statement: string, parameters?: SqlParam[]): Promise<StatementResult>;
}

const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'CANCELED', 'CLOSED']);

interface StatementResponse {
  statement_id?: string;
  status?: { state?: string; error?: { message?: string } };
  manifest?: { schema?: { columns?: Array<{ name?: string }> } };
  result?: { data_array?: unknown[][] };
}

/** SQL Statement Execution API on one warehouse. Polls until the statement ends (documents can take minutes). */
export function statementRunner(options: {
  host: string;
  warehouseId: string;
  getToken: TokenSource;
  fetchImpl?: typeof fetch;
  maxWaitMs?: number;
  pollIntervalMs?: number;
}): StatementRunner {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const maxWaitMs = options.maxWaitMs ?? 10 * 60 * 1000;
  const pollIntervalMs = options.pollIntervalMs ?? 2000;

  async function call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<StatementResponse> {
    const res = await fetchImpl(`${options.host}${path}`, {
      method,
      headers: { Authorization: `Bearer ${await options.getToken()}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`SQL API ${res.status}: ${clip(text, 400)}`);
    return JSON.parse(text) as StatementResponse;
  }

  return {
    async run(statement, parameters = []) {
      let response = await call('POST', '/api/2.0/sql/statements', {
        warehouse_id: options.warehouseId,
        statement,
        parameters: parameters.map(({ name, value, type }) => ({ name, value, type: type ?? 'STRING' })),
        wait_timeout: '50s',
        on_wait_timeout: 'CONTINUE',
        disposition: 'INLINE',
        format: 'JSON_ARRAY',
      });
      const deadline = Date.now() + maxWaitMs;
      while (!TERMINAL.has(response.status?.state ?? '') && response.statement_id) {
        if (Date.now() > deadline) throw new Error('The SQL statement is still running; try again later');
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        response = await call('GET', `/api/2.0/sql/statements/${encodeURIComponent(response.statement_id)}`);
      }
      if (response.status?.state !== 'SUCCEEDED') {
        throw new Error(response.status?.error?.message ?? `SQL statement ${response.status?.state ?? 'failed'}`);
      }
      return {
        columns: (response.manifest?.schema?.columns ?? []).map((column) => column.name ?? ''),
        rows: response.result?.data_array ?? [],
      };
    },
  };
}

export interface VectorSearchClient {
  query(input: {
    queryText: string;
    columns: string[];
    numResults: number;
    filters: Record<string, string>;
  }): Promise<Array<Record<string, unknown>>>;
  /** Asks a TRIGGERED Delta Sync index to pick up new rows. */
  sync(): Promise<void>;
}

/** Vector Search REST API for one index, called with the given token (the signed-in user's for queries). */
export function vectorSearchClient(options: {
  host: string;
  indexName: string;
  getToken: TokenSource;
  fetchImpl?: typeof fetch;
}): VectorSearchClient {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const base = `${options.host}/api/2.0/vector-search/indexes/${encodeURIComponent(options.indexName)}`;

  async function post(path: string, body: unknown) {
    const res = await fetchImpl(`${base}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await options.getToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Vector Search ${res.status}: ${clip(text, 400)}`);
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  }

  return {
    async query({ queryText, columns, numResults, filters }) {
      const body = (await post('/query', {
        query_text: queryText,
        columns,
        num_results: numResults,
        filters_json: JSON.stringify(filters),
      })) as {
        manifest?: { columns?: Array<{ name?: string }> };
        result?: { data_array?: unknown[][] };
      };
      const names = (body.manifest?.columns ?? []).map((column) => column.name ?? '');
      return (body.result?.data_array ?? []).map((row) =>
        Object.fromEntries(names.map((name, index) => [name, row[index]]))
      );
    },
    async sync() {
      await post('/sync', {});
    },
  };
}

/** `catalog.schema.name`, each part a plain identifier. Returns it back-quoted for SQL, or null. */
export function quoteThreePartName(name: string): string | null {
  const parts = name.trim().split('.');
  if (parts.length !== 3 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) return null;
  return parts.map((part) => `\`${part}\``).join('.');
}
