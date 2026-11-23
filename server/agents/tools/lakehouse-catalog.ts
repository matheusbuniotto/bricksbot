import { z } from 'zod';
import type { ToolDefinition } from '../../../shared/agents/types.js';
import { executeReadOnlySql, type SqlQueryToolOptions } from './sql-query.js';
import { readText } from '../../lib/coerce.js';

export const lakehouseCatalogArgsSchema = z.object({
  action: z.enum(['list_catalogs', 'list_schemas', 'list_tables', 'describe_table', 'semantics']),
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
    'Explore Databricks Unity Catalog structure. List catalogs, schemas, tables, or describe columns for a specific table. ' +
    'Use semantics (catalog, schema, and table required) to read business meaning: table and column comments, tags (including system.certification_status), and the metric view definition when the object is one. Requires user approval.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      action: {
        type: 'string',
        enum: ['list_catalogs', 'list_schemas', 'list_tables', 'describe_table', 'semantics'],
        description: 'The metadata discovery action to perform.',
      },
      catalog: {
        type: 'string',
        description: 'Catalog name (for list_schemas, list_tables, describe_table, or semantics).',
      },
      schema: {
        type: 'string',
        description: 'Schema name (for list_tables, describe_table, or semantics).',
      },
      table: {
        type: 'string',
        description: 'Table name (required for describe_table and semantics).',
      },
      warehouse_id: {
        type: 'string',
        description: 'Optional SQL warehouse id. Defaults to configured warehouse.',
      },
    },
    required: ['action'],
  },
};

function bareIdentifier(ident: string | undefined): string | null {
  if (!ident) return null;
  const trimmed = ident.trim().replace(/^`+|`+$/g, '');
  if (!trimmed || /[\0\r\n\t;]/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function sanitizeIdentifier(ident: string | undefined): string | null {
  const bare = bareIdentifier(ident);
  return bare && `\`${bare.replace(/`/g, '``')}\``;
}

function sqlLiteral(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
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
    case 'describe_table':
    case 'semantics': {
      if (!args.table?.trim()) {
        return { error: `${action} requires a table name` };
      }
      if (action === 'semantics' && !(args.catalog?.trim() && args.schema?.trim())) {
        return { error: 'semantics requires catalog, schema, and table' };
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
      const name = parts.join('.');
      return {
        statement: action === 'semantics' ? `DESCRIBE TABLE EXTENDED ${name} AS JSON` : `DESCRIBE TABLE ${name}`,
      };
    }
    default: {
      const _exhaustive: never = action;
      return { error: `Unknown lakehouse_catalog action: ${String(_exhaustive)}` };
    }
  }
}

/** Tags live in the catalog's information_schema; the table name is a literal there, not an identifier. */
function tagStatements(args: LakehouseCatalogArgs): { table: string; columns: string } {
  const catalog = sanitizeIdentifier(args.catalog);
  const where = `WHERE schema_name = ${sqlLiteral(bareIdentifier(args.schema) ?? '')} AND table_name = ${sqlLiteral(bareIdentifier(args.table) ?? '')}`;
  return {
    table: `SELECT tag_name, tag_value FROM ${catalog}.information_schema.table_tags ${where}`,
    columns: `SELECT column_name, tag_name, tag_value FROM ${catalog}.information_schema.column_tags ${where} ORDER BY column_name, tag_name`,
  };
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
      const fromArgs = readText(args.warehouse_id);
      const run = (sql: string) =>
        executeReadOnlySql({ ...options, maxChars: options.maxChars ?? maxChars }, sql, fromArgs);
      if (parsedArgs.data.action === 'semantics') {
        return describeSemantics(run, statement, parsedArgs.data);
      }
      const result = await run(statement);
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

/**
 * Comments and the metric view definition come from DESCRIBE ... AS JSON (older runtimes get plain
 * DESCRIBE EXTENDED); tags come from information_schema. Each section degrades on its own, so a
 * workspace without metric views or tag access still returns what it can.
 */
async function describeSemantics(
  run: (statement: string) => Promise<string>,
  describeJson: string,
  args: LakehouseCatalogArgs
): Promise<string> {
  const tags = tagStatements(args);
  const [definition, tableTags, columnTags] = await Promise.all([
    run(describeJson).then((json) => (failed(json) ? run(describeJson.replace(/ AS JSON$/, '')) : json)),
    run(tags.table),
    run(tags.columns),
  ]);
  return [
    ['Comments and definition (metric views include their YAML in view_text)', definition],
    ['Table tags (certification is system.certification_status)', tableTags],
    ['Column tags', columnTags],
  ]
    .map(([title, body]) => `## ${title}\n${section(body)}`)
    .join('\n\n');
}

const failed = (result: string) => result.startsWith('sql_query ');

function section(result: string): string {
  if (failed(result)) return `(unavailable) ${result.replace(/^sql_query /, '')}`;
  return rowsEmptyPlaceholder(result) ? '(none)' : result;
}

function rowsEmptyPlaceholder(result: string): boolean {
  return result.trim() === '(no rows)';
}
