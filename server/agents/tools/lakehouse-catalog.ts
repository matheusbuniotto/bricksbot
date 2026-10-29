import type { ToolDefinition } from '../../../shared/agents/types.js';
import type { SqlQueryToolOptions } from './sql-query.js';

export interface LakehouseCatalogArgs {
  action: 'list_catalogs' | 'list_schemas' | 'list_tables' | 'describe_table';
  catalog?: string;
  schema?: string;
  table?: string;
  warehouse_id?: string;
}

export const lakehouseCatalogToolDefinition: ToolDefinition = {
  name: 'lakehouse_catalog',
  description:
    'Explore Databricks Unity Catalog structure. List catalogs, schemas, tables, or describe columns for a specific table. Requires user approval.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      action: {
        type: 'string',
        enum: ['list_catalogs', 'list_schemas', 'list_tables', 'describe_table'],
        description: 'The metadata discovery action to perform.',
      },
      catalog: {
        type: 'string',
        description: 'Catalog name (for list_schemas, list_tables, or describe_table).',
      },
      schema: {
        type: 'string',
        description: 'Schema name (for list_tables or describe_table).',
      },
      table: {
        type: 'string',
        description: 'Table name (required for describe_table).',
      },
      warehouse_id: {
        type: 'string',
        description: 'Optional SQL warehouse id. Defaults to configured warehouse.',
      },
    },
    required: ['action'],
  },
};

const SAFE_IDENTIFIER = /^[A-Za-z0-9_]+$/;

function sanitizeIdentifier(ident: string | undefined): string | null {
  if (!ident) return null;
  const trimmed = ident.trim();
  if (!trimmed || !SAFE_IDENTIFIER.test(trimmed)) {
    return null;
  }
  return `\`${trimmed}\``;
}

export function buildCatalogStatement(args: LakehouseCatalogArgs): { error?: string; statement?: string } {
  const action = args.action;
  switch (action) {
    case 'list_catalogs':
      return { statement: 'SHOW CATALOGS' };
    case 'list_schemas': {
      if (args.catalog) {
        const cat = sanitizeIdentifier(args.catalog);
        if (!cat) return { error: `Invalid catalog name: ${args.catalog}` };
        return { statement: `SHOW SCHEMAS IN ${cat}` };
      }
      return { statement: 'SHOW SCHEMAS' };
    }
    case 'list_tables': {
      if (args.catalog && args.schema) {
        const cat = sanitizeIdentifier(args.catalog);
        const sch = sanitizeIdentifier(args.schema);
        if (!cat) return { error: `Invalid catalog name: ${args.catalog}` };
        if (!sch) return { error: `Invalid schema name: ${args.schema}` };
        return { statement: `SHOW TABLES IN ${cat}.${sch}` };
      }
      if (args.schema) {
        const sch = sanitizeIdentifier(args.schema);
        if (!sch) return { error: `Invalid schema name: ${args.schema}` };
        return { statement: `SHOW TABLES IN ${sch}` };
      }
      return { statement: 'SHOW TABLES' };
    }
    case 'describe_table': {
      if (!args.table?.trim()) {
        return { error: 'describe_table requires a table name' };
      }
      const parts: string[] = [];
      if (args.catalog) {
        const cat = sanitizeIdentifier(args.catalog);
        if (!cat) return { error: `Invalid catalog name: ${args.catalog}` };
        parts.push(cat);
      }
      if (args.schema) {
        const sch = sanitizeIdentifier(args.schema);
        if (!sch) return { error: `Invalid schema name: ${args.schema}` };
        parts.push(sch);
      }
      const tbl = sanitizeIdentifier(args.table);
      if (!tbl) return { error: `Invalid table name: ${args.table}` };
      parts.push(tbl);
      return { statement: `DESCRIBE TABLE ${parts.join('.')}` };
    }
    default:
      return { error: `Unknown lakehouse_catalog action: ${String(action)}` };
  }
}

export function createLakehouseCatalogTool(options: SqlQueryToolOptions = {}) {
  const maxChars = options.maxChars ?? 20_000;

  return {
    definition: lakehouseCatalogToolDefinition,
    preflight(args: Record<string, unknown>): string | null {
      const parsed = buildCatalogStatement(args as unknown as LakehouseCatalogArgs);
      return parsed.error ?? null;
    },
    async execute(args: Record<string, unknown>): Promise<string> {
      const parsed = buildCatalogStatement(args as unknown as LakehouseCatalogArgs);
      if (parsed.error || !parsed.statement) {
        return `lakehouse_catalog error: ${parsed.error ?? 'invalid request'}`;
      }

      const fromArgs = typeof args.warehouse_id === 'string' ? args.warehouse_id.trim() : '';
      const warehouseId = fromArgs || options.warehouseId?.trim() || '';
      if (!warehouseId) {
        return 'lakehouse_catalog error: warehouse_id is required. Pass warehouse_id or set DATABRICKS_WAREHOUSE_ID.';
      }

      if (options.executeImpl) {
        return options.executeImpl({ statement: parsed.statement, warehouseId });
      }

      const host = options.host?.trim();
      if (!host || !options.getToken) {
        return 'lakehouse_catalog error: Databricks workspace is not configured. Set DATABRICKS_HOST and DATABRICKS_TOKEN.';
      }

      const fetchImpl = options.fetchImpl ?? globalThis.fetch;
      const token = await options.getToken();
      const cleanHost = host.replace(/\/+$/, '');

      try {
        const response = await fetchImpl(`${cleanHost}/api/2.0/sql/statements`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            warehouse_id: warehouseId,
            statement: parsed.statement,
            wait_timeout: '30s',
            disposition: 'INLINE',
            format: 'JSON_ARRAY',
          }),
        });

        const text = await response.text();
        if (!response.ok) {
          return `lakehouse_catalog failed (${response.status}): ${text.slice(0, maxChars)}`;
        }

        const body = JSON.parse(text) as {
          status?: { state?: string; error?: { message?: string } };
          manifest?: { schema?: { columns?: Array<{ name?: string }> } };
          result?: { data_array?: unknown[][] };
        };

        if (body.status?.state !== 'SUCCEEDED') {
          return `lakehouse_catalog ${body.status?.state ?? 'FAILED'}: ${body.status?.error?.message ?? 'statement did not finish'}`;
        }

        const columns = (body.manifest?.schema?.columns ?? []).map((col) => col.name ?? '');
        const rows = body.result?.data_array ?? [];
        if (rows.length === 0) {
          return `${parsed.statement}\n(no results found)`;
        }

        const lines = [columns.join('\t'), ...rows.map((r) => r.map((c) => String(c ?? '')).join('\t'))];
        const resultText = lines.join('\n');
        return resultText.length > maxChars ? `${resultText.slice(0, maxChars)}\n…[truncated]` : resultText;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error';
        return `lakehouse_catalog error: ${msg}`;
      }
    },
  };
}
