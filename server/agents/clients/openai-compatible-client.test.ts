import { afterEach, describe, expect, test, vi } from 'vitest';
import { OpenAICompatibleChatClient } from './openai-compatible-client.js';

describe('OpenAICompatibleChatClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('posts to /v1/chat/completions and returns assistant content', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        choices: [{ message: { role: 'assistant', content: 'hello from openrouter' } }],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new OpenAICompatibleChatClient({
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-test',
      model: 'test-model',
    });

    const result = await client.complete({
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result.content).toBe('hello from openrouter');
    expect(result.toolCalls).toEqual([]);
    expect(fetchMock).toHaveBeenCalledOnce();
    const call = fetchMock.mock.calls[0]!;
    const url = String(call[0]);
    const init = call[1] as RequestInit;
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    const body = JSON.parse(String(init.body)) as { model: string; messages: unknown[] };
    expect(body.model).toBe('test-model');
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  test('parses tool_calls from the completion payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: {
                      name: 'web_fetch',
                      arguments: JSON.stringify({ url: 'https://example.com' }),
                    },
                  },
                ],
              },
            },
          ],
        }),
      ),
    );

    const client = new OpenAICompatibleChatClient({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'key',
      model: 'm',
    });

    const result = await client.complete({
      messages: [{ role: 'user', content: 'fetch it' }],
      tools: [
        {
          name: 'web_fetch',
          description: 'Fetch a URL',
          parameters: { type: 'object', properties: { url: { type: 'string' } } },
        },
      ],
    });

    expect(result.content).toBeNull();
    expect(result.toolCalls).toEqual([
      { id: 'call_1', name: 'web_fetch', arguments: { url: 'https://example.com' } },
    ]);
  });

  test('serializes assistant tool_calls before tool results', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ choices: [{ message: { content: 'done' } }] }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new OpenAICompatibleChatClient({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'key',
      model: 'm',
    });

    await client.complete({
      messages: [
        { role: 'user', content: 'run it' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'call_1', name: 'sql_query', arguments: { statement: 'SELECT 1' } }],
        },
        { role: 'tool', content: 'n\n1', toolCallId: 'call_1' },
      ],
    });

    const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body)) as {
      messages: Array<Record<string, unknown>>;
    };
    expect(body.messages[1]).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'sql_query', arguments: '{"statement":"SELECT 1"}' },
        },
      ],
    });
    expect(body.messages[2]).toEqual({
      role: 'tool',
      content: 'n\n1',
      tool_call_id: 'call_1',
    });
  });

  test('normalizes base URL without trailing /v1', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ choices: [{ message: { content: 'ok' } }] }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new OpenAICompatibleChatClient({
      baseUrl: 'https://api.x.ai',
      apiKey: 'key',
      model: 'grok',
    });
    await client.complete({ messages: [{ role: 'user', content: 'x' }] });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://api.x.ai/v1/chat/completions');
  });
});

