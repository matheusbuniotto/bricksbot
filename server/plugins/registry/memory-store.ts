import { randomUUID } from 'node:crypto';
import type { PluginRecord, PluginRegistryStore } from '../../../shared/plugins/types.js';
import { nowIso } from '../../lib/coerce.js';

export class MemoryPluginRegistryStore implements PluginRegistryStore {
  private readonly records = new Map<string, PluginRecord>();

  listPlugins(): Promise<PluginRecord[]> {
    return Promise.resolve(Array.from(this.records.values()).sort((a, b) => a.name.localeCompare(b.name)));
  }

  getPlugin(name: string): Promise<PluginRecord | null> {
    return Promise.resolve(this.records.get(name) ?? null);
  }

  upsertPlugin(input: Omit<PluginRecord, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<PluginRecord> {
    const existing = this.records.get(input.name);
    const now = nowIso();
    const record: PluginRecord = {
      id: existing?.id ?? input.id ?? randomUUID(),
      name: input.name,
      source: input.source,
      sourcePath: input.sourcePath,
      enabled: input.enabled ?? true,
      config: input.config ?? {},
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.records.set(input.name, record);
    return Promise.resolve(record);
  }

  setPluginEnabled(name: string, enabled: boolean): Promise<PluginRecord> {
    const record = this.records.get(name);
    if (!record) {
      return Promise.reject(new Error(`Plugin "${name}" not found`));
    }
    const updated: PluginRecord = {
      ...record,
      enabled,
      updatedAt: nowIso(),
    };
    this.records.set(name, updated);
    return Promise.resolve(updated);
  }

  deletePlugin(name: string): Promise<void> {
    this.records.delete(name);
    return Promise.resolve();
  }
}
