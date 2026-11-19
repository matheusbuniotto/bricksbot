import { afterEach, describe, expect, test, vi } from 'vitest';
import { OpenAICompatibleChatClient } from './openai-compatible-client.js';
import { sseResponse, stubFetchJson, stubFetchUntilAborted } from './test-fetch.js';

describe('OpenAICompatibleChatClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('posts to /v1/chat/completions and returns assistant content', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        choices: [{ message: { role: 'assistant', content: 'hello from openrouter' } }],
      })
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
    const call = fetchMock.mock.calls[0];
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
        })
      )
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
    expect(result.toolCalls).toEqual([{ id: 'call_1', name: 'web_fetch', arguments: { url: 'https://example.com' } }]);
  });

  test('serializes assistant tool_calls before tool results', async () => {
    const fetchMock = vi.fn(async () => Response.json({ choices: [{ message: { content: 'done' } }] }));
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

    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)) as {
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
    const fetchMock = vi.fn(async () => Response.json({ choices: [{ message: { content: 'ok' } }] }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new OpenAICompatibleChatClient({
      baseUrl: 'https://api.x.ai',
      apiKey: 'key',
      model: 'grok',
    });
    await client.complete({ messages: [{ role: 'user', content: 'x' }] });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://api.x.ai/v1/chat/completions');
  });

  test('parses usage, model and finish reason (OpenRouter shape with cost)', async () => {
    stubFetchJson({
      model: 'openai/answering-model',
      choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 20,
        total_tokens: 120,
        cost: 0.0042,
        prompt_tokens_details: { cached_tokens: 64 },
        completion_tokens_details: { reasoning_tokens: 8 },
      },
    });
    const client = new OpenAICompatibleChatClient({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm' });
    const result = await client.complete({ messages: [{ role: 'user', content: 'hi' }] });
    expect(result.usage).toEqual({
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 120,
      cachedTokens: 64,
      reasoningTokens: 8,
      cost: 0.0042,
    });
    expect(result.model).toBe('openai/answering-model');
    expect(result.finishReason).toBe('stop');
  });

  test('leaves usage undefined when the provider omits it', async () => {
    stubFetchJson({ choices: [{ message: { content: 'hi' } }] });
    const client = new OpenAICompatibleChatClient({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm' });
    const result = await client.complete({ messages: [{ role: 'user', content: 'hi' }] });
    expect(result.usage).toBeUndefined();
  });

  test('sends the per-request model and end user on the wire', async () => {
    const fetchMock = stubFetchJson({ choices: [{ message: { content: 'ok' } }] });
    const client = new OpenAICompatibleChatClient({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'default-model' });
    await client.complete({
      messages: [{ role: 'user', content: 'hi' }],
      model: 'override-model',
      meta: { endUser: 'u-1' },
    });
    await client.complete({ messages: [{ role: 'user', content: 'hi' }] });
    const [first, second] = fetchMock.mock.calls.map(
      ([, init]) => JSON.parse(init.body as string) as Record<string, unknown>
    );
    expect(first).toMatchObject({ model: 'override-model', user: 'u-1' });
    expect(second.model).toBe('default-model');
    expect(second).not.toHaveProperty('user');
  });

  test('rejects when the signal aborts', async () => {
    stubFetchUntilAborted();
    const client = new OpenAICompatibleChatClient({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm' });
    const controller = new AbortController();
    const pending = client.complete({ messages: [{ role: 'user', content: 'hi' }] }, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow();
  });

  describe('streaming', () => {
    const messages = [{ role: 'user' as const, content: 'hi' }];
    const sentBody = (call: unknown[]) =>
      JSON.parse((call[1] as RequestInit).body as string) as Record<string, unknown>;
    const fragmented = [
      { model: 'm-1', choices: [{ delta: { role: 'assistant', content: 'Hel' } }] },
      { choices: [{ delta: { content: 'lo' } }] },
      {
        choices: [
          {
            delta: { tool_calls: [{ index: 0, id: 'call_a', function: { name: 'sql_query', arguments: '{"state' } }] },
          },
        ],
      },
      {
        choices: [
          { delta: { tool_calls: [{ index: 1, id: 'call_b', function: { name: 'web_fetch', arguments: '' } }] } },
        ],
      },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'ment":"SELECT 1"}' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: '{"url":"https://x.test"}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
      { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0.001 } },
    ];

    test('streams text to onDelta, folds tool-call fragments by index and reads usage from the final chunk', async () => {
      const fetchMock = vi.fn(() => Promise.resolve(sseResponse(fragmented)));
      vi.stubGlobal('fetch', fetchMock);
      const client = new OpenAICompatibleChatClient({ baseUrl: 'https://stream-ok.test/v1', apiKey: 'k', model: 'm' });
      const deltas: string[] = [];

      const result = await client.complete({ messages }, { onDelta: (text) => deltas.push(text) });

      const body = sentBody(fetchMock.mock.calls[0]);
      expect(body).toMatchObject({ stream: true, stream_options: { include_usage: true } });
      expect(deltas).toEqual(['Hel', 'lo']);
      expect(result.content).toBe('Hello');
      expect(result.toolCalls).toEqual([
        { id: 'call_a', name: 'sql_query', arguments: { statement: 'SELECT 1' } },
        { id: 'call_b', name: 'web_fetch', arguments: { url: 'https://x.test' } },
      ]);
      expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15, cost: 0.001 });
      expect(result.model).toBe('m-1');
      expect(result.finishReason).toBe('tool_calls');
    });

    test('does not stream when nobody listens for deltas', async () => {
      const fetchMock = stubFetchJson({ choices: [{ message: { content: 'ok' } }] });
      const client = new OpenAICompatibleChatClient({
        baseUrl: 'https://no-listener.test/v1',
        apiKey: 'k',
        model: 'm',
      });
      await client.complete({ messages });
      expect(sentBody(fetchMock.mock.calls[0])).not.toHaveProperty('stream');
    });

    test('an endpoint that rejects stream is retried plain, and not asked to stream again', async () => {
      const fetchMock = vi.fn((_url: string, init: RequestInit) =>
        Promise.resolve(
          (JSON.parse(init.body as string) as { stream?: boolean }).stream
            ? new Response('stream not supported', { status: 400 })
            : Response.json({ choices: [{ message: { content: 'plain answer' } }] })
        )
      );
      vi.stubGlobal('fetch', fetchMock);
      const client = new OpenAICompatibleChatClient({ baseUrl: 'https://no-stream.test/v1', apiKey: 'k', model: 'm' });

      expect((await client.complete({ messages }, { onDelta: () => {} })).content).toBe('plain answer');
      expect(fetchMock).toHaveBeenCalledTimes(2);
      await client.complete({ messages }, { onDelta: () => {} });
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    test('a genuine 400 is not remembered as "no streaming"', async () => {
      const fetchMock = vi.fn(() => Promise.resolve(new Response('bad tool schema', { status: 400 })));
      vi.stubGlobal('fetch', fetchMock);
      const client = new OpenAICompatibleChatClient({
        baseUrl: 'https://bad-request.test/v1',
        apiKey: 'k',
        model: 'm',
      });

      await expect(client.complete({ messages }, { onDelta: () => {} })).rejects.toThrow('bad tool schema');
      await expect(client.complete({ messages }, { onDelta: () => {} })).rejects.toThrow('bad tool schema');
      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(sentBody(fetchMock.mock.calls[2])).toHaveProperty('stream');
    });

    test('an endpoint that ignores stream and answers JSON still works', async () => {
      stubFetchJson({ choices: [{ message: { content: 'json anyway' } }] });
      const client = new OpenAICompatibleChatClient({ baseUrl: 'https://ignores.test/v1', apiKey: 'k', model: 'm' });
      expect((await client.complete({ messages }, { onDelta: () => {} })).content).toBe('json anyway');
    });

    test('aborting mid-stream rejects', async () => {
      const controller = new AbortController();
      vi.stubGlobal(
        'fetch',
        vi.fn((_url: string, init: RequestInit) =>
          Promise.resolve(
            new Response(
              new ReadableStream({
                start(stream) {
                  stream.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"par"}}]}\n\n'));
                  init.signal?.addEventListener('abort', () => stream.error(new DOMException('aborted', 'AbortError')));
                },
              }),
              { headers: { 'content-type': 'text/event-stream' } }
            )
          )
        )
      );
      const client = new OpenAICompatibleChatClient({ baseUrl: 'https://abort.test/v1', apiKey: 'k', model: 'm' });
      const pending = client.complete({ messages }, { signal: controller.signal, onDelta: () => controller.abort() });
      await expect(pending).rejects.toThrow();
    });
  });
});
