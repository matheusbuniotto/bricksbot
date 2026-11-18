import { describe, expect, it } from 'vitest';
import { McpDiscoveryService } from './mcp-discovery.js';
import { buildConnectedMcpTools, createGenericMcpTools, isConnectedMcpTool, mcpToolName } from './mcp-tools.js';
import { UnityGatewayMcpClient } from './mcp-client.js';

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function requestBody(init?: RequestInit): string {
  return typeof init?.body === 'string' ? init.body : '{}';
}

describe('mcp-tools', () => {
  it('namespaced tool ids and detects connected MCP tools', () => {
    expect(mcpToolName('system.ai.web_search', 'web_search')).toBe('mcp_system_ai_web_search_web_search');
    expect(isConnectedMcpTool('mcp_system_ai_web_search_web_search')).toBe(true);
    expect(isConnectedMcpTool('genie_ask')).toBe(false);
    expect(isConnectedMcpTool('sql_query')).toBe(false);
  });

  it('createGenericMcpTools forwards tools/call and returns text', async () => {
    const calls: Array<{ service: string; tool: string; args: Record<string, unknown> }> = [];
    const mockFetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = requestUrl(input);
      const body = JSON.parse(requestBody(init)) as {
        id: number;
        method: string;
        params?: { name?: string; arguments?: Record<string, unknown> };
      };
      const service = decodeURIComponent(url.match(/\/ai-gateway\/mcp-services\/([^?]+)/)?.[1] ?? '');
      if (body.method === 'tools/call') {
        calls.push({ service, tool: body.params?.name ?? '', args: body.params?.arguments ?? {} });
        return Promise.resolve(
          new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: body.id,
              result: { content: [{ type: 'text', text: 'search hits' }] },
            }),
            { status: 200 }
          )
        );
      }
      return Promise.resolve(new Response('Not Found', { status: 404 }));
    }) as typeof fetch;

    const client = new UnityGatewayMcpClient({
      host: 'https://workspace.cloud.databricks.com',
      getToken: () => Promise.resolve('tok'),
      fetchImpl: mockFetch,
    });

    const tools = createGenericMcpTools(client, 'system.ai.web_search', [
      {
        name: 'web_search',
        description: 'Search',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      },
    ]);

    expect(tools).toHaveLength(1);
    expect(tools[0].definition.name).toBe('mcp_system_ai_web_search_web_search');
    const result = await tools[0].execute(
      { query: 'lakehouse' },
      {
        chatId: 'c1',
        bot: null,
      }
    );
    expect(result).toBe('search hits');
    expect(calls).toEqual([{ service: 'system.ai.web_search', tool: 'web_search', args: { query: 'lakehouse' } }]);
  });

  it('buildConnectedMcpTools registers Genie specialists and generic MCP tools', async () => {
    const mockFetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = requestUrl(input);
      const body = JSON.parse(requestBody(init)) as { id: number; method: string };
      const service = decodeURIComponent(url.match(/\/ai-gateway\/mcp-services\/([^?]+)/)?.[1] ?? '');

      if (body.method === 'tools/list' && service === 'system.ai.web_search') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: body.id,
              result: { tools: [{ name: 'web_search', description: 'Search the public web' }] },
            }),
            { status: 200 }
          )
        );
      }
      return Promise.resolve(new Response('Not Found', { status: 404 }));
    }) as typeof fetch;

    const discovery = new McpDiscoveryService({
      host: 'https://workspace.cloud.databricks.com',
      getToken: () => Promise.resolve('tok'),
      fetchImpl: mockFetch,
    });
    discovery.markDefaultConnected('system.ai.genie_one_mcp');
    discovery.markDefaultConnected('system.ai.web_search');

    const tools = await buildConnectedMcpTools(discovery, 'alice', discovery.getClientConfig());
    const names = tools.map((t) => t.definition.name);
    expect(names).toContain('genie_ask');
    expect(names).toContain('mcp_system_ai_web_search_web_search');
  });
});
