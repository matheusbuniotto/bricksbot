import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { PluginHost } from '../host/plugin-host.js';
import { RegistryPluginLoader } from '../loaders/registry-loader.js';
import { MemoryPluginRegistryStore } from './memory-store.js';

describe('Plugin Registry and Loader', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bb-registry-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('MemoryPluginRegistryStore', () => {
    test('upserts, retrieves, enables, and deletes plugin records', async () => {
      const store = new MemoryPluginRegistryStore();

      const created = await store.upsertPlugin({
        name: 'test-plugin',
        source: 'volume',
        sourcePath: '/Volumes/cat/schema/vol/test-plugin',
        enabled: true,
        config: { apiKey: 'secret' },
      });

      expect(created.id).toBeDefined();
      expect(created.name).toBe('test-plugin');
      expect(created.enabled).toBe(true);

      const retrieved = await store.getPlugin('test-plugin');
      expect(retrieved).toEqual(created);

      const disabled = await store.setPluginEnabled('test-plugin', false);
      expect(disabled.enabled).toBe(false);

      const list = await store.listPlugins();
      expect(list).toHaveLength(1);
      expect(list[0].enabled).toBe(false);

      await store.deletePlugin('test-plugin');
      const afterDelete = await store.getPlugin('test-plugin');
      expect(afterDelete).toBeNull();
    });
  });

  describe('RegistryPluginLoader', () => {
    test('loads enabled plugins and skips disabled ones', async () => {
      const pluginDir = path.join(tempDir, 'active-plugin');
      await fs.mkdir(pluginDir, { recursive: true });
      await fs.writeFile(
        path.join(pluginDir, 'index.mjs'),
        `export default {
          metadata: { name: 'active-plugin', version: '1.0.0', description: 'Active' },
          tools: [
            {
              name: 'active_tool',
              description: 'Active tool',
              parameters: {},
              execute: async () => 'active',
            },
          ],
        };`,
        'utf-8'
      );

      const store = new MemoryPluginRegistryStore();
      await store.upsertPlugin({
        name: 'active-plugin',
        source: 'volume',
        sourcePath: pluginDir,
        enabled: true,
        config: {},
      });
      await store.upsertPlugin({
        name: 'disabled-plugin',
        source: 'volume',
        sourcePath: '/some/disabled/path',
        enabled: false,
        config: {},
      });

      const host = new PluginHost();
      const loader = new RegistryPluginLoader({ store, host });
      const result = await loader.loadEnabled();

      expect(result.errors).toHaveLength(0);
      expect(result.loaded).toHaveLength(1);
      expect(result.loaded[0].name).toBe('active-plugin');
      expect(result.skipped).toEqual(['disabled-plugin']);

      expect(host.hasTool('active_tool')).toBe(true);
    });

    test('captures errors for invalid plugin files without crashing', async () => {
      const store = new MemoryPluginRegistryStore();
      await store.upsertPlugin({
        name: 'missing-plugin',
        source: 'volume',
        sourcePath: path.join(tempDir, 'non-existent-dir'),
        enabled: true,
        config: {},
      });

      const host = new PluginHost();
      const loader = new RegistryPluginLoader({ store, host });
      const result = await loader.loadEnabled();

      expect(result.loaded).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].pluginName).toBe('missing-plugin');
    });
  });
});
