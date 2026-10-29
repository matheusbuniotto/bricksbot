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

  test('returns a warehouse error instead of throwing when warehouse_id is missing', async () => {
    const executeImpl = vi.fn(async () => 'should not run');
    const tool = createSqlQueryTool({ executeImpl });

    const result = await tool.execute({ statement: 'SELECT 1' });

    expect(result).toMatch(/warehouse_id is required/);
    expect(executeImpl).not.toHaveBeenCalled();
  });

  test('returns a config error when the workspace host or token is missing', async () => {
    const tool = createSqlQueryTool({ warehouseId: 'wh' });
    const result = await tool.execute({ statement: 'SELECT 1' });
    expect(result).toMatch(/DATABRICKS_HOST and DATABRICKS_TOKEN/);
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

  test('omits getToken when no token is configured', () => {
    expect(sqlQueryConfigFromEnv({}).getToken).toBeUndefined();
    expect(sqlQueryConfigFromEnv({ DATABRICKS_TOKEN: '__UNSET__' }).getToken).toBeUndefined();
  });
});
