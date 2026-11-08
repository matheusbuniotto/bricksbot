import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { PluginHost } from '../host/plugin-host.js';
import { VolumePluginLoader } from './volume-loader.js';

describe('VolumePluginLoader', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bb-plugins-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test('returns empty results when volumeRoot is not set', async () => {
    const host = new PluginHost();
    const loader = new VolumePluginLoader({ host });
    const result = await loader.loadAll();

    expect(result.loaded).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  test('returns empty results when volumeRoot directory does not exist', async () => {
    const host = new PluginHost();
    const loader = new VolumePluginLoader({
      volumeRoot: path.join(tempDir, 'does-not-exist'),
      host,
    });
    const result = await loader.loadAll();

    expect(result.loaded).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  test('loads plugin object from directory with index.mjs', async () => {
    const pluginDir = path.join(tempDir, 'sample-plugin');
    await fs.mkdir(pluginDir, { recursive: true });

    const code = `
export default {
  metadata: {
    name: 'sample-plugin',
    version: '1.2.0',
    description: 'Sample volume plugin',
  },
  tools: [
    {
      name: 'sample_tool',
      description: 'A sample tool',
      parameters: {},
      execute: async () => 'hello from sample',
    },
  ],
};
`;
    await fs.writeFile(path.join(pluginDir, 'index.mjs'), code, 'utf-8');

    const host = new PluginHost();
    const loader = new VolumePluginLoader({ volumeRoot: tempDir, host });
    const result = await loader.loadAll();

    expect(result.errors).toHaveLength(0);
    expect(result.loaded).toHaveLength(1);
    expect(result.loaded[0].name).toBe('sample-plugin');
    expect(result.loaded[0].version).toBe('1.2.0');

    expect(host.hasTool('sample_tool')).toBe(true);
  });

  test('loads initializer function using manifest.json metadata', async () => {
    const pluginDir = path.join(tempDir, 'init-plugin');
    await fs.mkdir(pluginDir, { recursive: true });

    const manifest = {
      name: 'manifest-plugin',
      version: '2.0.0',
      description: 'Plugin with manifest',
      author: 'Databricks Engineer',
    };
    await fs.writeFile(path.join(pluginDir, 'manifest.json'), JSON.stringify(manifest), 'utf-8');

    const code = `
export default function init(api) {
  api.registerTool({
    name: 'manifest_tool',
    description: 'Tool registered via API',
    parameters: {},
    annotations: { readOnly: true },
    execute: async () => 'manifest result',
  });
}
`;
    await fs.writeFile(path.join(pluginDir, 'index.mjs'), code, 'utf-8');

    const host = new PluginHost();
    const loader = new VolumePluginLoader({ volumeRoot: tempDir, host });
    const result = await loader.loadAll();

    expect(result.errors).toHaveLength(0);
    expect(result.loaded).toHaveLength(1);
    expect(result.loaded[0].name).toBe('manifest-plugin');
    expect(result.loaded[0].version).toBe('2.0.0');

    expect(host.hasTool('manifest_tool')).toBe(true);
    expect(host.isAskFirst('manifest_tool')).toBe(false);
  });

  test('isolates failing plugins so valid plugins still load', async () => {
    const validDir = path.join(tempDir, 'valid-plugin');
    await fs.mkdir(validDir, { recursive: true });
    await fs.writeFile(
      path.join(validDir, 'index.mjs'),
      `export default {
        metadata: { name: 'valid-plugin', version: '1.0.0', description: 'valid' },
        tools: [{ name: 'valid_tool', description: 'valid', parameters: {}, execute: async () => 'ok' }]
      };`,
      'utf-8'
    );

    const brokenDir = path.join(tempDir, 'broken-plugin');
    await fs.mkdir(brokenDir, { recursive: true });
    await fs.writeFile(
      path.join(brokenDir, 'index.mjs'),
      `export default {
        metadata: { name: 'broken-plugin', version: '1.0.0', description: 'broken' },
        tools: [{ name: 'broken_tool', description: 'broken', parameters: {} }]
      };`,
      'utf-8'
    );

    const host = new PluginHost();
    const loader = new VolumePluginLoader({ volumeRoot: tempDir, host });
    const result = await loader.loadAll();

    expect(result.loaded).toHaveLength(1);
    expect(result.loaded[0].name).toBe('valid-plugin');
    expect(host.hasTool('valid_tool')).toBe(true);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].pluginName).toBe('broken-plugin');
  });

  test('skips directories without entry files', async () => {
    const emptyDir = path.join(tempDir, 'empty-dir');
    await fs.mkdir(emptyDir, { recursive: true });

    const host = new PluginHost();
    const loader = new VolumePluginLoader({ volumeRoot: tempDir, host });
    const result = await loader.loadAll();

    expect(result.loaded).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });
});
