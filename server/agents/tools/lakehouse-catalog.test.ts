import { describe, expect, test, vi } from 'vitest';
import {
  buildCatalogStatement,
  createLakehouseCatalogTool,
  lakehouseCatalogToolDefinition,
} from './lakehouse-catalog.js';

describe('buildCatalogStatement', () => {
  test('builds list_catalogs statement', () => {
    expect(buildCatalogStatement({ action: 'list_catalogs' })).toEqual({
      statement: 'SHOW CATALOGS',
    });
  });

  test('builds list_schemas statement with and without catalog', () => {
    expect(buildCatalogStatement({ action: 'list_schemas' })).toEqual({
      statement: 'SHOW SCHEMAS',
    });
    expect(buildCatalogStatement({ action: 'list_schemas', catalog: 'samples' })).toEqual({
      statement: 'SHOW SCHEMAS IN `samples`',
    });
  });

  test('builds list_tables statement with catalog and schema', () => {
    expect(buildCatalogStatement({ action: 'list_tables', catalog: 'samples', schema: 'nyctaxi' })).toEqual({
      statement: 'SHOW TABLES IN `samples`.`nyctaxi`',
    });
  });

  test('builds describe_table statement', () => {
    expect(
      buildCatalogStatement({
        action: 'describe_table',
        catalog: 'samples',
        schema: 'nyctaxi',
        table: 'trips',
      })
    ).toEqual({
      statement: 'DESCRIBE TABLE `samples`.`nyctaxi`.`trips`',
    });
  });

  test('rejects describe_table when table is missing', () => {
    const res = buildCatalogStatement({ action: 'describe_table' });
    expect(res.error).toMatch(/requires a table name/i);
  });

  test('rejects invalid identifier with unsafe characters', () => {
    const res = buildCatalogStatement({ action: 'list_schemas', catalog: 'cat; DROP TABLE t' });
    expect(res.error).toMatch(/invalid catalog name/i);
  });

  test('supports identifiers with hyphens and strips/escapes backticks', () => {
    expect(
      buildCatalogStatement({
        action: 'describe_table',
        catalog: 'dev-catalog',
        schema: 'sales-2024',
        table: '`trips-data`',
      })
    ).toEqual({
      statement: 'DESCRIBE TABLE `dev-catalog`.`sales-2024`.`trips-data`',
    });
  });
});

describe('createLakehouseCatalogTool', () => {
  test('has correct tool definition name and parameters', () => {
    expect(lakehouseCatalogToolDefinition.name).toBe('lakehouse_catalog');
    expect(lakehouseCatalogToolDefinition.parameters).toMatchObject({
      required: ['action'],
    });
  });

  test('preflight returns error for invalid input', () => {
    const tool = createLakehouseCatalogTool({ warehouseId: 'wh-1' });
    expect(tool.preflight({ action: 'describe_table' })).toMatch(/requires a table name/);
    expect(tool.preflight({ action: 'list_catalogs' })).toBeNull();
  });

  test('executes statement using executeImpl', async () => {
    const executeImpl = vi.fn(async (req: { statement: string; warehouseId: string }) => {
      return `executed: ${req.statement} on ${req.warehouseId}`;
    });
    const tool = createLakehouseCatalogTool({ warehouseId: 'wh-default', executeImpl });

    const result = await tool.execute({ action: 'list_catalogs' });
    expect(result).toBe('executed: SHOW CATALOGS on wh-default');
    expect(executeImpl).toHaveBeenCalledWith({
      statement: 'SHOW CATALOGS',
      warehouseId: 'wh-default',
    });
  });

  test('returns config error when workspace is not configured (MCP fallback needs host)', async () => {
    const tool = createLakehouseCatalogTool();
    const result = await tool.execute({ action: 'list_catalogs' });
    expect(result).toMatch(/Databricks workspace is not configured/i);
  });

  test('falls back to executeImpl without a warehouse', async () => {
    const executeImpl = vi.fn(async (req: { statement: string; warehouseId: string }) => {
      return `executed: ${req.statement} on ${req.warehouseId}`;
    });
    const tool = createLakehouseCatalogTool({ executeImpl });
    await expect(tool.execute({ action: 'list_catalogs' })).resolves.toBe('executed: SHOW CATALOGS on mcp');
  });
});
