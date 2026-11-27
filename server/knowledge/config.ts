import { resolveVolumeRoot } from '../agents/tools/volume-namespace.js';
import { presentEnv } from '../lib/env.js';
import { quoteThreePartName } from './databricks.js';

export interface KnowledgeEnvConfig {
  root: string;
  /** Back-quoted for SQL. */
  table: string;
  indexName: string;
  host: string;
  warehouseId: string;
}

/**
 * The knowledge base is on only when the chunk table, the index, a Volume, the workspace host and a warehouse are
 * all set. `problem` says what is missing when some but not all are; it stays undefined when none are.
 */
export function knowledgeConfigFromEnv(
  env: Record<string, string | undefined>,
  base: { host?: string; warehouseId?: string }
): { config?: KnowledgeEnvConfig; problem?: string } {
  const tableName = presentEnv(env.BRICKSBOT_KB_TABLE);
  const indexName = presentEnv(env.BRICKSBOT_KB_INDEX);
  if (!tableName && !indexName) return {};
  if (/^(false|0|off|no)$/i.test(presentEnv(env.BRICKSBOT_KB_ENABLED) ?? '')) return {};
  const own = presentEnv(env.BRICKSBOT_KB_VOLUME_ROOT);
  let root: string | undefined;
  try {
    root = resolveVolumeRoot(own ? { BRICKSBOT_VOLUME_ROOT: own } : env);
  } catch (err) {
    return { problem: err instanceof Error ? err.message : 'invalid Volume root' };
  }
  const table = tableName ? quoteThreePartName(tableName) : null;
  const missing = [
    !table && 'BRICKSBOT_KB_TABLE (catalog.schema.table)',
    !(indexName && quoteThreePartName(indexName)) && 'BRICKSBOT_KB_INDEX (catalog.schema.index)',
    !root && 'BRICKSBOT_KB_VOLUME_ROOT or BRICKSBOT_VOLUME_ROOT',
    !base.host && 'DATABRICKS_HOST',
    !base.warehouseId && 'DATABRICKS_WAREHOUSE_ID',
  ].filter(Boolean);
  if (missing.length > 0) return { problem: `missing ${missing.join(', ')}` };
  return {
    config: { root: root!, table: table!, indexName: indexName!, host: base.host!, warehouseId: base.warehouseId! },
  };
}
