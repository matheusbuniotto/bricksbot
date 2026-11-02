import { describe, expect, it } from 'vitest';
import { McpDiscoveryService } from './mcp-discovery.js';

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

    const mockFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.includes('/api/2.1/unity-catalog/mcp-services')) {
        return new Response(
          JSON.stringify({
            mcp_services: [
              { name: 'genie_one_mcp', full_name: 'system.ai.genie_one_mcp' },
              { name: 'dbsql', full_name: 'system.ai.dbsql' },
              { name: 'slack', full_name: 'system.ai.slack' },
            ],
          }),
          { status: 200 }
        );
      }

      if (url.includes('/ai-gateway/mcp-services/')) {
        const bodyStr = init?.body ? String(init.body) : '{}';
        const parsed = JSON.parse(bodyStr);
        const serviceMatch = url.match(/\/ai-gateway\/mcp-services\/([^?]+)/);
        const serviceName = serviceMatch ? decodeURIComponent(serviceMatch[1]) : '';

        if (serviceName in fakeTools) {
          const tools = fakeTools[serviceName].map((t) => ({ name: t, description: `${t} tool` }));
          return new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: parsed.id ?? 1,
              result: { tools },
            }),
            { status: 200 }
          );
        }

        return new Response('Not Found', { status: 404 });
      }

      return new Response('Not Found', { status: 404 });
    };

    const discovery = new McpDiscoveryService({
      host: 'https://workspace.cloud.databricks.com',
      getToken: async () => 'test-token',
      fetchImpl: mockFetch as typeof fetch,
      cacheTtlMs: 50,
    });

    const initial = await discovery.listViableMcps({ refresh: true });
    expect(initial.map((m) => m.service)).toEqual(['system.ai.genie_one_mcp', 'system.ai.dbsql']);
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

  it('allows registering and removing custom user MCPs', async () => {
    const mockFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.includes('/ai-gateway/mcp-services/main.analytics.custom_mcp')) {
        const bodyStr = init?.body ? String(init.body) : '{}';
        const parsed = JSON.parse(bodyStr);
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: parsed.id ?? 1,
            result: { tools: [{ name: 'query_custom_data' }] },
          }),
          { status: 200 }
        );
      }

      return new Response('Not Found', { status: 404 });
    };

    const discovery = new McpDiscoveryService({
      host: 'https://workspace.cloud.databricks.com',
      getToken: async () => 'test-token',
      fetchImpl: mockFetch as typeof fetch,
    });

    const custom = await discovery.registerCustomMcp('main.analytics.custom_mcp', {
      name: 'Custom Analytics MCP',
      description: 'Internal analytics tools',
    });

    expect(custom.service).toBe('main.analytics.custom_mcp');
    expect(custom.source).toBe('custom');
    expect(custom.tools).toEqual(['query_custom_data']);

    const mcps = await discovery.listViableMcps({ refresh: true });
    expect(mcps.some((m) => m.service === 'main.analytics.custom_mcp')).toBe(true);

    const removed = discovery.removeCustomMcp('main.analytics.custom_mcp');
    expect(removed).toBe(true);

    const afterDelete = await discovery.listViableMcps({ refresh: true });
    expect(afterDelete.some((m) => m.service === 'main.analytics.custom_mcp')).toBe(false);
  });
});
