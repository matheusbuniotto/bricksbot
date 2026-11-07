import { randomUUID } from 'node:crypto';
import type { PluginRecord, PluginRegistryStore, PluginSource } from '../../../shared/plugins/types.js';
import type { LakebaseQuery } from '../../chat/lakebase-store.js';

function asString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function asBool(value: unknown): boolean {
  return value === true || value === 't' || value === 'true';
}

function asConfig(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

function mapPluginRecord(row: Record<string, unknown>): PluginRecord {
  return {
    id: asString(row.id),
    name: asString(row.name),
    source: asString(row.source) as PluginSource,
    sourcePath: asString(row.source_path),
    enabled: asBool(row.enabled),
    config: asConfig(row.config),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
  };
}

export class LakebasePluginRegistryStore implements PluginRegistryStore {
  constructor(private readonly query: LakebaseQuery) {}

  async listPlugins(): Promise<PluginRecord[]> {
    const result = await this.query(
      `SELECT id, name, source, source_path, enabled, config, created_at, updated_at
       FROM bricksbot.plugins
       ORDER BY name ASC`
    );
    return result.rows.map(mapPluginRecord);
  }

  async getPlugin(name: string): Promise<PluginRecord | null> {
    const result = await this.query(
      `SELECT id, name, source, source_path, enabled, config, created_at, updated_at
       FROM bricksbot.plugins
       WHERE name = $1`,
      [name]
    );
    return result.rows[0] ? mapPluginRecord(result.rows[0]) : null;
  }

  async upsertPlugin(
    input: Omit<PluginRecord, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
  ): Promise<PluginRecord> {
    const id = input.id ?? randomUUID();
    const result = await this.query(
      `INSERT INTO bricksbot.plugins (id, name, source, source_path, enabled, config, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       ON CONFLICT (name) DO UPDATE SET
         source = EXCLUDED.source,
         source_path = EXCLUDED.source_path,
         enabled = EXCLUDED.enabled,
         config = EXCLUDED.config,
         updated_at = NOW()
       RETURNING id, name, source, source_path, enabled, config, created_at, updated_at`,
      [id, input.name, input.source, input.sourcePath, input.enabled ?? true, JSON.stringify(input.config ?? {})]
    );
    return mapPluginRecord(result.rows[0]);
  }

  async setPluginEnabled(name: string, enabled: boolean): Promise<PluginRecord> {
    const result = await this.query(
      `UPDATE bricksbot.plugins
       SET enabled = $1, updated_at = NOW()
       WHERE name = $2
       RETURNING id, name, source, source_path, enabled, config, created_at, updated_at`,
      [enabled, name]
    );
    if (!result.rows[0]) {
      throw new Error(`Plugin "${name}" not found`);
    }
    return mapPluginRecord(result.rows[0]);
  }

  async deletePlugin(name: string): Promise<void> {
    await this.query(
      `DELETE FROM bricksbot.plugins WHERE name = $1`,
      [name]
    );
  }
}
