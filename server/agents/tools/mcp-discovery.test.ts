import { describe, expect, it } from 'vitest';
import { McpDiscoveryService } from './mcp-discovery.js';

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function requestBody(init?: RequestInit): string {
  return typeof init?.body === 'string' ? init.body : '{}';
}

describe('McpDiscoveryService', () => {
  it('returns default viable MCPs when host and token are absent (offline/local mode)', async () => {
    const service = new McpDiscoveryService({});
    const mcps = await service.listViableMcps();
    expect(mcps.length).toBeGreaterThan(0);
    expect(mcps.every((m) => m.isViable)).toBe(true);
    expect(mcps.some((m) => m.service === 'system.ai.genie_one_mcp')).toBe(true);
    expect(mcps.some((m) => m.service === 'system.ai.slack')).toBe(false);
  });

  it('only returns viable MCPs that respond to tools/list', async () => {
    const fakeTools: Record<string, string[]> = {
      'system.ai.genie_one_mcp': ['genie_ask', 'genie_poll_response'],
      'system.ai.dbsql': ['execute_sql'],
    };

    const mockFetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = requestUrl(input);

      if (url.includes('/api/2.1/unity-catalog/mcp-services')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              mcp_services: [
                { name: 'genie_one_mcp', full_name: 'system.ai.genie_one_mcp' },
                { name: 'dbsql', full_name: 'system.ai.dbsql' },
                { name: 'slack', full_name: 'system.ai.slack' },
              ],
            }),
            { status: 200 }
          )
        );
      }

      if (url.includes('/ai-gateway/mcp-services/')) {
        const parsed = JSON.parse(requestBody(init)) as { id?: number };
        const serviceMatch = url.match(/\/ai-gateway\/mcp-services\/([^?]+)/);
        const serviceName = serviceMatch ? decodeURIComponent(serviceMatch[1]) : '';

        if (serviceName in fakeTools) {
          const tools = fakeTools[serviceName].map((t) => ({ name: t, description: `${t} tool` }));
          return Promise.resolve(
            new Response(
              JSON.stringify({
                jsonrpc: '2.0',
                id: parsed.id ?? 1,
                result: { tools },
              }),
              { status: 200 }
            )
          );
        }

        return Promise.resolve(new Response('Not Found', { status: 404 }));
      }

      return Promise.resolve(new Response('Not Found', { status: 404 }));
    }) as typeof fetch;

    const discovery = new McpDiscoveryService({
      host: 'https://workspace.cloud.databricks.com',
      getToken: () => Promise.resolve('test-token'),
      fetchImpl: mockFetch,
      cacheTtlMs: 50,
    });

    const initial = await discovery.listViableMcps({ refresh: true });
    expect(initial.map((m) => m.service)).toEqual(['system.ai.genie_one_mcp', 'system.ai.dbsql', 'plugin.teatools']);
    expect(initial.find((m) => m.service === 'system.ai.slack')).toBeUndefined();

    fakeTools['system.ai.slack'] = ['search_messages', 'read_channel'];

    const afterAdd = await discovery.listViableMcps({ refresh: true });
    expect(afterAdd.map((m) => m.service)).toContain('system.ai.slack');
    const slack = afterAdd.find((m) => m.service === 'system.ai.slack');
    expect(slack?.isViable).toBe(true);
    expect(slack?.tools).toEqual(['search_messages', 'read_channel']);

    delete fakeTools['system.ai.dbsql'];

    const afterRemove = await discovery.listViableMcps({ refresh: true });
    expect(afterRemove.map((m) => m.service)).not.toContain('system.ai.dbsql');
    expect(afterRemove.map((m) => m.service)).toContain('system.ai.slack');
  });

  it('caches the catalog per user and never pins a refused listing', async () => {
    let token = 'alice';
    const granted: Record<string, string[]> = { alice: ['main.default.alice_only'], bob: [] };
    const mockFetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = requestUrl(input);
      const auth = new Headers(init?.headers).get('Authorization')?.replace('Bearer ', '') ?? '';
      if (url.includes('/api/2.1/unity-catalog/mcp-services')) {
        if (auth === 'bob' && !granted.bob.length) return Promise.resolve(new Response('Forbidden', { status: 403 }));
        const services = url.includes('main.default') ? (granted[auth] ?? []) : [];
        return Promise.resolve(
          new Response(
            JSON.stringify({
              mcp_services: services.map((full_name) => ({ name: full_name.split('.')[2], full_name })),
            }),
            { status: 200 }
          )
        );
      }
      const service = /mcp-services\/([^/?]+)/.exec(url)?.[1] ?? '';
      if (granted[auth]?.includes(service)) {
        const parsed = JSON.parse(requestBody(init)) as { id?: number };
        return Promise.resolve(
          new Response(JSON.stringify({ jsonrpc: '2.0', id: parsed.id ?? 1, result: { tools: [{ name: 't' }] } }), {
            status: 200,
          })
        );
      }
      return Promise.resolve(new Response('Forbidden', { status: 403 }));
    }) as typeof fetch;

    const discovery = new McpDiscoveryService({
      host: 'https://workspace.cloud.databricks.com',
      getToken: () => Promise.resolve(token),
      fetchImpl: mockFetch,
      cacheTtlMs: 60_000,
    });
    const services = async (userId: string) => (await discovery.listViableMcps({ userId })).map((m) => m.service);

    expect(await services('alice')).toContain('main.default.alice_only');
    token = 'bob';
    expect(await services('bob')).not.toContain('main.default.alice_only');

    // Bob's listing was refused (403): a later grant must show up without waiting for the TTL.
    granted.bob = ['main.default.alice_only'];
    expect(await services('bob')).toContain('main.default.alice_only');
  });

  it('allows registering and removing custom user MCPs', async () => {
    const mockFetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = requestUrl(input);

      if (url.includes('/ai-gateway/mcp-services/main.analytics.custom_mcp')) {
        const parsed = JSON.parse(requestBody(init)) as { id?: number };
        return Promise.resolve(
          new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: parsed.id ?? 1,
              result: { tools: [{ name: 'query_custom_data' }] },
            }),
            { status: 200 }
          )
        );
      }

      return Promise.resolve(new Response('Not Found', { status: 404 }));
    }) as typeof fetch;

    const discovery = new McpDiscoveryService({
      host: 'https://workspace.cloud.databricks.com',
      getToken: () => Promise.resolve('test-token'),
      fetchImpl: mockFetch,
    });

    const custom = await discovery.registerCustomMcp('alice', 'main.analytics.custom_mcp', {
      name: 'Custom Analytics MCP',
      description: 'Internal analytics tools',
    });

    expect(custom.service).toBe('main.analytics.custom_mcp');
    expect(custom.source).toBe('custom');
    expect(custom.tools).toEqual(['query_custom_data']);

    const mcps = await discovery.listViableMcps({ refresh: true, userId: 'alice' });
    expect(mcps.some((m) => m.service === 'main.analytics.custom_mcp')).toBe(true);

    const removed = await discovery.removeCustomMcp('alice', 'main.analytics.custom_mcp');
    expect(removed).toBe(true);

    const afterDelete = await discovery.listViableMcps({ refresh: true, userId: 'alice' });
    expect(afterDelete.some((m) => m.service === 'main.analytics.custom_mcp')).toBe(false);
  });

  it('connect marks service connected and disconnect clears it', async () => {
    const mockFetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.includes('/ai-gateway/mcp-services/system.ai.web_search')) {
        const parsed = JSON.parse(requestBody(init)) as { id?: number };
        return Promise.resolve(
          new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: parsed.id ?? 1,
              result: { tools: [{ name: 'web_search', description: 'Search the web' }] },
            }),
            { status: 200 }
          )
        );
      }
      return Promise.resolve(new Response('Not Found', { status: 404 }));
    }) as typeof fetch;

    const discovery = new McpDiscoveryService({
      host: 'https://workspace.cloud.databricks.com',
      getToken: () => Promise.resolve('test-token'),
      fetchImpl: mockFetch,
    });

    expect(await discovery.isConnected('alice', 'system.ai.web_search')).toBe(false);
    const connected = await discovery.connect('alice', 'system.ai.web_search');
    expect(connected.connected).toBe(true);
    expect(connected.tools).toEqual(['web_search']);
    expect(await discovery.listConnectedServices('alice')).toEqual(['system.ai.web_search']);

    expect(await discovery.disconnect('alice', 'system.ai.web_search')).toBe(true);
    expect(await discovery.isConnected('alice', 'system.ai.web_search')).toBe(false);
  });

  it('env default connectors are per user: one user disconnecting does not affect others', async () => {
    const discovery = new McpDiscoveryService({});
    discovery.markDefaultConnected('system.ai.genie_one_mcp');

    expect(await discovery.isConnected('alice', 'system.ai.genie_one_mcp')).toBe(true);
    expect(await discovery.disconnect('alice', 'system.ai.genie_one_mcp')).toBe(true);
    expect(await discovery.removeCustomMcp('alice', 'system.ai.genie_one_mcp')).toBe(false);

    expect(await discovery.listConnectedServices('alice')).toEqual([]);
    expect(await discovery.listConnectedServices('bob')).toEqual(['system.ai.genie_one_mcp']);
    const bobList = await discovery.listViableMcps({ userId: 'bob' });
    expect(bobList.find((m) => m.service === 'system.ai.genie_one_mcp')?.connected).toBe(true);
    const aliceList = await discovery.listViableMcps({ userId: 'alice' });
    expect(aliceList.find((m) => m.service === 'system.ai.genie_one_mcp')?.connected).toBe(false);
  });
});
