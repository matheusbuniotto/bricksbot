import { describe, expect, test } from 'vitest';
import { UnityGatewayMcpClient } from './mcp-client.js';
import {
  createSystemAiMcpTools,
  GENIE_ASK_TOOL_NAME,
  GENIE_CANCEL_TOOL_NAME,
  GENIE_GET_QUERY_RESULT_TOOL_NAME,
  GENIE_POLL_TOOL_NAME,
  systemAiMcpConfigFromEnv,
} from './system-ai-mcp.js';

describe('UnityGatewayMcpClient', () => {
  test('lists tools using JSON-RPC 2.0 tools/list with bearer auth and workspace query param', async () => {
    let capturedUrl = '';
    let capturedHeaders: HeadersInit | undefined;
    let capturedBody = '';

    const mockFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedHeaders = init?.headers;
      capturedBody = String(init?.body);
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {
            tools: [
              {
                name: 'genie_ask',
                description: 'Ask Genie',
                inputSchema: { type: 'object' },
              },
            ],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    const client = new UnityGatewayMcpClient({
      host: 'https://test-workspace.databricks.com',
      getToken: async () => 'dapi-token-123',
      workspaceId: '123456789',
      fetchImpl: mockFetch,
    });

    const tools = await client.listTools('system.ai.genie_one_mcp');
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe('genie_ask');
    expect(capturedUrl).toBe(
      'https://test-workspace.databricks.com/ai-gateway/mcp-services/system.ai.genie_one_mcp?o=123456789'
    );
    expect((capturedHeaders as Record<string, string>)?.['Authorization']).toBe('Bearer dapi-token-123');
    expect(JSON.parse(capturedBody)).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    });
  });

  test('calls tool using JSON-RPC 2.0 tools/call and returns result', async () => {
    const mockFetch = (async () => {
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {
            content: [{ type: 'text', text: '{"status":"completed"}' }],
          },
        }),
        { status: 200 }
      );
    }) as typeof fetch;

    const client = new UnityGatewayMcpClient({
      host: 'https://test-workspace.databricks.com',
      fetchImpl: mockFetch,
    });

    const result = await client.callTool('system.ai.genie_one_mcp', 'genie_ask', {
      question: 'total ARR',
    });
    expect(result.content[0]?.text).toContain('completed');
  });

  test('throws on JSON-RPC error response', async () => {
    const mockFetch = (async () => {
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32601, message: 'Method not found' },
        }),
        { status: 200 }
      );
    }) as typeof fetch;

    const client = new UnityGatewayMcpClient({
      host: 'https://test-workspace.databricks.com',
      fetchImpl: mockFetch,
    });

    await expect(client.callTool('system.ai.genie_one_mcp', 'non_existent_tool')).rejects.toThrow(/Method not found/);
  });

  test('throws on HTTP error status code', async () => {
    const mockFetch = (async () => {
      return new Response('Unauthorized workspace token', { status: 401 });
    }) as typeof fetch;

    const client = new UnityGatewayMcpClient({
      host: 'https://test-workspace.databricks.com',
      fetchImpl: mockFetch,
    });

    await expect(client.callTool('system.ai.genie_one_mcp', 'genie_ask')).rejects.toThrow(
      /Unity Gateway MCP error \(401\)/
    );
  });
});

describe('SystemAiMcp Tools', () => {
  test('genie_ask auto_poll completes and returns structured summary with SQL and citations', async () => {
    let callCount = 0;
    const mockFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      callCount += 1;
      const body = JSON.parse(String(init?.body)) as { method: string; params: { name: string } };

      if (body.params.name === 'genie_ask') {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: callCount,
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    conversation_id: 'conv_123',
                    response_id: 'resp_456',
                    status: 'in_progress',
                  }),
                },
              ],
            },
          })
        );
      }

      // genie_poll_response
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: callCount,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  status: 'completed',
                  answer: 'ARR is $12M',
                  query: 'SELECT SUM(arr) FROM finance.arr_metric',
                  citations: [{ title: 'Finance metric view', url: 'https://databricks.com/doc' }],
                }),
              },
            ],
          },
        })
      );
    }) as typeof fetch;

    const tools = createSystemAiMcpTools({
      host: 'https://test.databricks.com',
      fetchImpl: mockFetch,
      pollIntervalMs: 5,
      maxPollSeconds: 2,
    });

    const askTool = tools.find((t) => t.definition.name === GENIE_ASK_TOOL_NAME);
    expect(askTool).toBeDefined();

    const output = await askTool!.execute({ question: 'What is our ARR?' }, { chatId: 'chat_1', bot: null });
    const parsed = JSON.parse(output) as Record<string, unknown>;

    expect(parsed.status).toBe('completed');
    expect(parsed.answer).toBe('ARR is $12M');
    expect(parsed.query).toContain('SELECT SUM(arr)');
    expect(Array.isArray(parsed.citations)).toBe(true);
    expect(callCount).toBe(2);
  });

  test('genie_ask with auto_poll false returns initial in_progress without polling', async () => {
    let callCount = 0;
    const mockFetch = (async () => {
      callCount += 1;
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  conversation_id: 'conv_123',
                  response_id: 'resp_456',
                  status: 'in_progress',
                }),
              },
            ],
          },
        })
      );
    }) as typeof fetch;

    const tools = createSystemAiMcpTools({
      host: 'https://test.databricks.com',
      fetchImpl: mockFetch,
    });

    const askTool = tools.find((t) => t.definition.name === GENIE_ASK_TOOL_NAME);
    const output = await askTool!.execute(
      { question: 'Compute heavy metric', auto_poll: false },
      { chatId: 'chat_1', bot: null }
    );

    expect(callCount).toBe(1);
    expect(output).toContain('resp_456');
  });

  test('genie_ask returns in_progress on polling timeout', async () => {
    const mockFetch = (async () => {
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  conversation_id: 'conv_123',
                  response_id: 'resp_456',
                  status: 'in_progress',
                }),
              },
            ],
          },
        })
      );
    }) as typeof fetch;

    const tools = createSystemAiMcpTools({
      host: 'https://test.databricks.com',
      fetchImpl: mockFetch,
      pollIntervalMs: 5,
      maxPollSeconds: 0.02,
    });

    const askTool = tools.find((t) => t.definition.name === GENIE_ASK_TOOL_NAME);
    const output = await askTool!.execute({ question: 'Slow query' }, { chatId: 'chat_1', bot: null });
    const parsed = JSON.parse(output) as Record<string, unknown>;

    expect(parsed.status).toBe('in_progress');
    expect(parsed.error).toContain('timed out');
  });

  test('genie_poll_response, genie_get_query_result, and genie_cancel_response call through to MCP', async () => {
    const calls: string[] = [];
    const mockFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { params: { name: string } };
      calls.push(body.params.name);
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: { content: [{ type: 'text', text: `result-of-${body.params.name}` }] },
        })
      );
    }) as typeof fetch;

    const tools = createSystemAiMcpTools({
      host: 'https://test.databricks.com',
      fetchImpl: mockFetch,
    });

    const pollTool = tools.find((t) => t.definition.name === GENIE_POLL_TOOL_NAME)!;
    const queryResultTool = tools.find((t) => t.definition.name === GENIE_GET_QUERY_RESULT_TOOL_NAME)!;
    const cancelTool = tools.find((t) => t.definition.name === GENIE_CANCEL_TOOL_NAME)!;

    const ctx = { chatId: 'c1', bot: null };
    expect(await pollTool.execute({ conversation_id: 'c', response_id: 'r' }, ctx)).toBe(
      'result-of-genie_poll_response'
    );
    expect(await queryResultTool.execute({ conversation_id: 'c', response_id: 'r' }, ctx)).toBe(
      'result-of-genie_get_query_result'
    );
    expect(await cancelTool.execute({ conversation_id: 'c', response_id: 'r' }, ctx)).toBe(
      'result-of-genie_cancel_response'
    );
    expect(calls).toEqual(['genie_poll_response', 'genie_get_query_result', 'genie_cancel_response']);
  });

  test('systemAiMcpConfigFromEnv detects enabled flags', () => {
    expect(systemAiMcpConfigFromEnv({})).toBeUndefined();

    const enabled = systemAiMcpConfigFromEnv({
      DATABRICKS_GENIE_ENABLED: 'true',
      DATABRICKS_HOST: 'https://w.cloud.databricks.com',
      DATABRICKS_TOKEN: 'token-abc',
      DATABRICKS_WORKSPACE_ID: '987',
    });
    expect(enabled).toBeDefined();
    expect(enabled?.host).toBe('https://w.cloud.databricks.com');
    expect(enabled?.workspaceId).toBe('987');

    const oneEnabled = systemAiMcpConfigFromEnv({
      DATABRICKS_ONE_ENABLED: 'true',
    });
    expect(oneEnabled?.enabled).toBe(true);

    const mcpEnabled = systemAiMcpConfigFromEnv({
      SYSTEM_AI_MCPS: 'system.ai.genie_one_mcp',
    });
    expect(mcpEnabled?.enabled).toBe(true);
  });
});
