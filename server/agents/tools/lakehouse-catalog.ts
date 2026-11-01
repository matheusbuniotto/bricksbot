import { z } from 'zod';
import type { ToolDefinition } from '../../../shared/agents/types.js';
import { executeReadOnlySql, type SqlQueryToolOptions } from './sql-query.js';

export const lakehouseCatalogArgsSchema = z.object({
  action: z.enum(['list_catalogs', 'list_schemas', 'list_tables', 'describe_table']),
  catalog: z.string().optional(),
  schema: z.string().optional(),
  table: z.string().optional(),
  warehouse_id: z.string().optional(),
});

export type LakehouseCatalogArgs = z.infer<typeof lakehouseCatalogArgsSchema>;

export type CatalogStatementResult =
  | { readonly statement: string; readonly error?: never }
  | { readonly error: string; readonly statement?: never };

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

function sanitizeIdentifier(ident: string | undefined): string | null {
  if (!ident) return null;
  const trimmed = ident.trim().replace(/^`+|`+$/g, '');
  if (!trimmed || /[\0\r\n\t;]/.test(trimmed)) {
    return null;
  }
  return `\`${trimmed.replace(/`/g, '``')}\``;
}

export function buildCatalogStatement(args: LakehouseCatalogArgs): CatalogStatementResult {
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
    default: {
      const _exhaustive: never = action;
      return { error: `Unknown lakehouse_catalog action: ${String(_exhaustive)}` };
    }
  }
}

export function createLakehouseCatalogTool(options: SqlQueryToolOptions = {}) {
  const maxChars = options.maxChars ?? 20_000;

  return {
    definition: lakehouseCatalogToolDefinition,
    preflight(args: Record<string, unknown>): string | null {
      const parsedArgs = lakehouseCatalogArgsSchema.safeParse(args);
      if (!parsedArgs.success) {
        return parsedArgs.error.issues[0]?.message ?? 'Invalid arguments for lakehouse_catalog';
      }
      const parsed = buildCatalogStatement(parsedArgs.data);
      return parsed.error ?? null;
    },
    async execute(args: Record<string, unknown>): Promise<string> {
      const parsedArgs = lakehouseCatalogArgsSchema.safeParse(args);
      if (!parsedArgs.success) {
        return `lakehouse_catalog error: ${parsedArgs.error.issues[0]?.message ?? 'invalid request'}`;
      }
      const parsed = buildCatalogStatement(parsedArgs.data);
      if (!parsed.statement) {
        return `lakehouse_catalog error: ${parsed.error ?? 'invalid request'}`;
      }
      const statement = parsed.statement;
      const fromArgs = typeof args.warehouse_id === 'string' ? args.warehouse_id.trim() : '';
      const result = await executeReadOnlySql(
        { ...options, maxChars: options.maxChars ?? maxChars },
        statement,
        fromArgs,
      );
      // Keep lakehouse_catalog label on shared executor errors.
      if (result.startsWith('sql_query ')) {
        return result.replace(/^sql_query /, 'lakehouse_catalog ');
      }
      if (rowsEmptyPlaceholder(result) && statement) {
        return `${statement}\n(no results found)`;
      }
      return result;
    },
  };
}

function rowsEmptyPlaceholder(result: string): boolean {
  return result.trim() === '(no rows)';
}
