import express from 'express';
import { describe, expect, test } from 'vitest';
import { PluginHost } from './host/plugin-host.js';
import { MemoryPluginRegistryStore } from './registry/memory-store.js';
import { registerPluginRoutes } from './routes.js';

async function withPluginApp(
  setup: (host: PluginHost, store: MemoryPluginRegistryStore) => Promise<void>,
  run: (baseUrl: string) => Promise<void>
) {
  const host = new PluginHost();
  const store = new MemoryPluginRegistryStore();
  await setup(host, store);

  const app = express();
  app.use(express.json());
  registerPluginRoutes(app, {
    pluginHost: host,
    registryStore: store,
  });

  const server = await new Promise<import('node:http').Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind test server');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await run(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

describe('Plugin HTTP Routes', () => {
  test('GET /api/plugins returns empty array when no plugins are registered', async () => {
    await withPluginApp(
      async () => {},
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/plugins`);
        expect(res.status).toBe(200);
        const data = (await res.json()) as { plugins: unknown[] };
        expect(data.plugins).toHaveLength(0);
      }
    );
  });

  test('GET /api/plugins returns list of registered plugins with tools and sections', async () => {
    await withPluginApp(
      async (host, store) => {
        await host.registerPlugin({
          metadata: {
            name: 'crm-plugin',
            version: '1.0.0',
            description: 'CRM connector',
          },
          tools: [
            {
              name: 'crm_get',
              description: 'Fetch CRM data',
              parameters: {},
              execute: () => Promise.resolve('data'),
            },
          ],
          promptSections: [
            {
              name: 'crm-rules',
              render: () => 'CRM active',
            },
          ],
        });

        await store.upsertPlugin({
          name: 'crm-plugin',
          source: 'volume',
          sourcePath: '/Volumes/cat/sch/vol/crm-plugin',
          enabled: true,
          config: {},
        });
      },
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/plugins`);
        expect(res.status).toBe(200);
        const data = (await res.json()) as {
          plugins: Array<{
            metadata: { name: string; version: string };
            tools: Array<{ name: string; askFirst: boolean }>;
            promptSections: string[];
            enabled: boolean;
            source: string;
          }>;
        };

        expect(data.plugins).toHaveLength(1);
        expect(data.plugins[0].metadata.name).toBe('crm-plugin');
        expect(data.plugins[0].enabled).toBe(true);
        expect(data.plugins[0].source).toBe('volume');
        expect(data.plugins[0].tools).toHaveLength(1);
        expect(data.plugins[0].tools[0].name).toBe('crm_get');
        expect(data.plugins[0].tools[0].askFirst).toBe(true);
        expect(data.plugins[0].promptSections).toEqual(['crm-rules']);
      }
    );
  });

  test('POST /api/plugins/reload responds with reload results', async () => {
    await withPluginApp(
      async () => {},
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/plugins/reload`, {
          method: 'POST',
        });
        expect(res.status).toBe(200);
        const data = (await res.json()) as { ok: boolean; loaded: unknown[]; errors: unknown[] };
        expect(data.ok).toBe(true);
        expect(data.loaded).toEqual([]);
        expect(data.errors).toEqual([]);
      }
    );
  });
});
