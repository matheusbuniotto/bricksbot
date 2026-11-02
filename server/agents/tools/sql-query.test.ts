import { describe, expect, test, vi } from 'vitest';
import { createSqlQueryTool, readOnlySqlError, sqlQueryConfigFromEnv } from './sql-query.js';

describe('readOnlySqlError', () => {
  test.each([
    ['SELECT 1', null],
    ['  with cte as (select 1) select * from cte', null],
    ['SHOW TABLES', null],
    ['DESCRIBE catalog.schema.table', null],
    ['EXPLAIN SELECT 1', null],
    ['/* note */ SELECT 1', null],
    ["SELECT ';'", null],
    ['SELECT 1;', null],
    ['DROP TABLE t', 'only allows'],
    ['insert into t values (1)', 'only allows'],
    ['UPDATE t SET a = 1', 'only allows'],
    ['DELETE FROM t', 'only allows'],
    ['ALTER TABLE t ADD COLUMN a INT', 'only allows'],
    ['CREATE TABLE t (a INT)', 'only allows'],
    ['SELECT 1; DROP TABLE t', 'one statement'],
    ['', 'requires a statement'],
    ['   ', 'requires a statement'],
    ['-- hi\nDELETE FROM t', 'only allows'],
    ['WITH t AS (DELETE FROM foo) SELECT * FROM t', 'mutating keywords inside WITH are blocked'],
    ['WITH t AS (SELECT 1) INSERT INTO foo SELECT * FROM t', 'mutating keywords inside WITH are blocked'],
    ['WITH t AS (UPDATE foo SET bar = 1) SELECT 1', 'mutating keywords inside WITH are blocked'],
    ['WITH t AS (SELECT 1 AS col) SELECT * FROM t', null],
  ])('classifies %j', (statement, pattern) => {
    const error = readOnlySqlError(statement);
    if (pattern === null) {
      expect(error).toBeNull();
    } else {
      expect(error).toMatch(new RegExp(pattern, 'i'));
    }
  });
});

describe('createSqlQueryTool', () => {
  test('does not call the executor for a non-select statement', async () => {
    const executeImpl = vi.fn(async () => 'should not run');
    const tool = createSqlQueryTool({ warehouseId: 'wh', executeImpl });

    expect(tool.preflight({ statement: 'DROP TABLE t' })).toMatch(/only allows/i);
    const result = await tool.execute({ statement: 'DROP TABLE t' });

    expect(result).toMatch(/only allows SELECT, WITH, SHOW, DESCRIBE, or EXPLAIN/);
    expect(executeImpl).not.toHaveBeenCalled();
  });

  test('falls back to executeImpl without a warehouse (MCP path uses warehouseId mcp)', async () => {
    const executeImpl = vi.fn(async (input: { statement: string; warehouseId: string }) => {
      return `${input.warehouseId}:${input.statement}`;
    });
    const tool = createSqlQueryTool({ executeImpl });

    await expect(tool.execute({ statement: 'SELECT 1' })).resolves.toBe('mcp:SELECT 1');
    expect(executeImpl).toHaveBeenCalledWith({ statement: 'SELECT 1', warehouseId: 'mcp' });
  });

  test('returns a config error when the workspace host or token is missing', async () => {
    const tool = createSqlQueryTool({ warehouseId: 'wh' });
    const result = await tool.execute({ statement: 'SELECT 1' });
    expect(result).toMatch(/Databricks workspace is not configured/i);
  });

  test('falls back to system.ai.dbsql when no warehouse is configured', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      expect(href).toContain('/ai-gateway/mcp-services/system.ai.dbsql');
      expect(JSON.parse(String(init?.body))).toMatchObject({
        method: 'tools/call',
        params: { name: 'execute_sql', arguments: { query: 'SELECT 1' } },
      });
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  status: { state: 'SUCCEEDED' },
                  manifest: { schema: { columns: [{ name: 'n' }] } },
                  result: { data_typed_array: [{ values: [{ str: '1' }] }] },
                }),
              },
            ],
            isError: false,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    });
    const tool = createSqlQueryTool({
      host: 'https://dbc.example.cloud.databricks.com',
      workspaceId: '123',
      getToken: async () => 'tok',
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(tool.execute({ statement: 'SELECT 1' })).resolves.toBe('n\n1');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('passes the statement and warehouse to the stub executor', async () => {
    const executeImpl = vi.fn(async (input: { statement: string; warehouseId: string }) => {
      return `${input.warehouseId}:${input.statement}`;
    });
    const tool = createSqlQueryTool({ warehouseId: 'default-wh', executeImpl });

    await expect(tool.execute({ statement: 'SELECT 1' })).resolves.toBe('default-wh:SELECT 1');
    await expect(tool.execute({ statement: 'SHOW TABLES', warehouse_id: 'other-wh' })).resolves.toBe(
      'other-wh:SHOW TABLES'
    );
    expect(executeImpl).toHaveBeenCalledTimes(2);
  });

  test('posts a read-only statement to the SQL Statement Execution API', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          status: { state: 'SUCCEEDED' },
          manifest: { schema: { columns: [{ name: 'n' }] } },
          result: { data_array: [[1]] },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    });
    const tool = createSqlQueryTool({
      warehouseId: 'wh',
      host: 'https://dbc.example.cloud.databricks.com/',
      getToken: async () => 'tok',
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(tool.execute({ statement: 'SELECT 1' })).resolves.toBe('n\n1');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://dbc.example.cloud.databricks.com/api/2.0/sql/statements');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer tok');
    expect(JSON.parse(String(init.body))).toMatchObject({
      warehouse_id: 'wh',
      statement: 'SELECT 1',
      wait_timeout: '30s',
      disposition: 'INLINE',
      format: 'JSON_ARRAY',
    });
  });

  test('returns the warehouse error string when the statement fails', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify({ status: { state: 'FAILED', error: { message: 'boom' } } }), { status: 200 });
    });
    const tool = createSqlQueryTool({
      warehouseId: 'wh',
      host: 'https://dbc.example.cloud.databricks.com',
      getToken: async () => 'tok',
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(tool.execute({ statement: 'SELECT missing' })).resolves.toBe('sql_query FAILED: boom');
  });

  test('returns an HTTP failure string without throwing', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 400 }));
    const tool = createSqlQueryTool({
      warehouseId: 'wh',
      host: 'https://dbc.example.cloud.databricks.com',
      getToken: async () => 'tok',
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(tool.execute({ statement: 'SELECT 1' })).resolves.toMatch(/sql_query failed \(400\)/);
  });

  test('polls statement until SUCCEEDED when initial state is PENDING', async () => {
    let callCount = 0;
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      callCount += 1;
      const href = String(url);
      if (callCount === 1) {
        expect(href).toContain('/api/2.0/sql/statements');
        return new Response(
          JSON.stringify({
            statement_id: 'stmt_123',
            status: { state: 'PENDING' },
          }),
          { status: 200 }
        );
      }
      expect(href).toContain('/api/2.0/sql/statements/stmt_123');
      return new Response(
        JSON.stringify({
          statement_id: 'stmt_123',
          status: { state: 'SUCCEEDED' },
          manifest: { schema: { columns: [{ name: 'val' }] } },
          result: { data_array: [['hello world']] },
        }),
        { status: 200 }
      );
    });

    const tool = createSqlQueryTool({
      warehouseId: 'wh',
      host: 'https://dbc.example.cloud.databricks.com',
      getToken: async () => 'tok',
      fetchImpl: fetchImpl as typeof fetch,
      mcpPollIntervalMs: 5,
    });

    const result = await tool.execute({ statement: 'SELECT "hello world"' });
    expect(result).toBe('val\nhello world');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('decodes typed cell formats and sanitizes newlines and tabs', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          status: { state: 'SUCCEEDED' },
          manifest: {
            schema: {
              columns: [{ name: 'dt' }, { name: 'ts' }, { name: 'amt' }, { name: 'notes' }],
            },
          },
          result: {
            data_typed_array: [
              {
                values: [
                  { date_value: '2026-11-01' },
                  { timestamp_value: '2026-11-01T12:00:00Z' },
                  { decimal_value: '123.45' },
                  { str: 'line1\nline2\titem' },
                ],
              },
            ],
          },
        }),
        { status: 200 }
      );
    });

    const tool = createSqlQueryTool({
      warehouseId: 'wh',
      host: 'https://dbc.example.cloud.databricks.com',
      getToken: async () => 'tok',
      fetchImpl: fetchImpl as typeof fetch,
    });

    const result = await tool.execute({ statement: 'SELECT * FROM metrics' });
    expect(result).toBe(
      'dt\tts\tamt\tnotes\n2026-11-01\t2026-11-01T18:34:00Z\t123.45\tline1 line2 item'.replace('18:34:00Z', '12:00:00Z')
    );
  });

  test('normalizes bare host without scheme to https URL', async () => {
    let requestedUrl = '';
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      requestedUrl = String(url);
      return new Response(
        JSON.stringify({
          status: { state: 'SUCCEEDED' },
          manifest: { schema: { columns: [{ name: 'test' }] } },
          result: { data_array: [['1']] },
        }),
        { status: 200 }
      );
    });

    const tool = createSqlQueryTool({
      warehouseId: 'wh',
      host: 'dbc-example.cloud.databricks.com',
      getToken: async () => 'tok',
      fetchImpl: fetchImpl as typeof fetch,
    });

    const result = await tool.execute({ statement: 'SELECT 1 AS test' });
    expect(result).toBe('test\n1');
    expect(requestedUrl).toBe('https://dbc-example.cloud.databricks.com/api/2.0/sql/statements');
  });
});

describe('sqlQueryConfigFromEnv', () => {
  test('reads warehouse, host, and token and ignores unset placeholders', async () => {
    const config = sqlQueryConfigFromEnv({
      DATABRICKS_WAREHOUSE_ID: ' wh ',
      DATABRICKS_HOST: '__UNSET__',
      DATABRICKS_WORKSPACE_URL: 'https://dbc.example.cloud.databricks.com',
      DATABRICKS_TOKEN: 'tok',
    });

    expect(config.warehouseId).toBe('wh');
    expect(config.host).toBe('https://dbc.example.cloud.databricks.com');
    await expect(config.getToken?.()).resolves.toBe('tok');
  });

  test('normalizes bare DATABRICKS_HOST without protocol to https', () => {
    const config = sqlQueryConfigFromEnv({
      DATABRICKS_HOST: 'dbc-example.cloud.databricks.com',
    });
    expect(config.host).toBe('https://dbc-example.cloud.databricks.com');
  });

  test('still provides getToken so request OBO can authenticate without a PAT', async () => {
    const config = sqlQueryConfigFromEnv({
      DATABRICKS_HOST: 'https://dbc.example.cloud.databricks.com',
      DATABRICKS_TOKEN: '__UNSET__',
    });
    expect(config.getToken).toBeTypeOf('function');
    await expect(config.getToken?.()).rejects.toThrow(/No Databricks credentials/i);
  });
});
