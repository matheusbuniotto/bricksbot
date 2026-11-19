import { afterEach, describe, expect, test, vi } from 'vitest';
import { DatabricksServingChatClient } from './databricks-serving-client.js';
import { sseResponse, stubFetchJson, stubFetchUntilAborted } from './test-fetch.js';

describe('DatabricksServingChatClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('invokes the serving endpoint with OpenAI-style messages', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        choices: [{ message: { role: 'assistant', content: 'from serving' } }],
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new DatabricksServingChatClient({
      host: 'https://dbc-example.cloud.databricks.com',
      endpointName: 'databricks-meta-llama-3-3-70b-instruct',
      getToken: async () => 'dbx-token',
    });

    const result = await client.complete({
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result.content).toBe('from serving');
    const call = fetchMock.mock.calls[0];
    const url = String(call[0]);
    const init = call[1] as RequestInit;
    expect(url).toBe(
      'https://dbc-example.cloud.databricks.com/serving-endpoints/databricks-meta-llama-3-3-70b-instruct/invocations'
    );
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer dbx-token');
  });

  test('parses usage and routes a per-request model to its own endpoint', async () => {
    const fetchMock = stubFetchJson({
      model: 'other-endpoint',
      choices: [{ message: { content: 'ok' }, finish_reason: 'length' }],
      usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
    });
    const client = new DatabricksServingChatClient({
      host: 'https://dbc.example.cloud.databricks.com',
      endpointName: 'default-endpoint',
      getToken: () => Promise.resolve('tok'),
    });
    const result = await client.complete({ messages: [{ role: 'user', content: 'hi' }], model: 'other-endpoint' });
    expect(fetchMock.mock.calls[0][0]).toContain('/serving-endpoints/other-endpoint/invocations');
    expect(result.usage).toEqual({ promptTokens: 3, completionTokens: 4, totalTokens: 7 });
    expect(result.finishReason).toBe('length');
  });

  test('keeps the candidates fallback', async () => {
    stubFetchJson({ candidates: [{ content: 'from candidates' }] });
    const client = new DatabricksServingChatClient({
      host: 'https://dbc.example.cloud.databricks.com',
      endpointName: 'e',
      getToken: () => Promise.resolve('tok'),
    });
    const result = await client.complete({ messages: [{ role: 'user', content: 'hi' }] });
    expect(result.content).toBe('from candidates');
  });

  test('rejects when the signal aborts', async () => {
    stubFetchUntilAborted();
    const client = new DatabricksServingChatClient({
      host: 'https://dbc.example.cloud.databricks.com',
      endpointName: 'e',
      getToken: () => Promise.resolve('tok'),
    });
    const controller = new AbortController();
    const pending = client.complete({ messages: [{ role: 'user', content: 'hi' }] }, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow();
  });

  test('streams from the invocations endpoint when asked for deltas', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        sseResponse([
          { choices: [{ delta: { content: 'from ' } }] },
          { choices: [{ delta: { content: 'stream' }, finish_reason: 'stop' }] },
          { choices: [], usage: { prompt_tokens: 3, completion_tokens: 2 } },
        ])
      )
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new DatabricksServingChatClient({
      host: 'https://dbc-stream.cloud.databricks.com',
      endpointName: 'ep',
      getToken: () => Promise.resolve('t'),
    });
    const deltas: string[] = [];
    const result = await client.complete(
      { messages: [{ role: 'user', content: 'hi' }] },
      { onDelta: (t) => deltas.push(t) }
    );
    expect(deltas).toEqual(['from ', 'stream']);
    expect(result).toMatchObject({ content: 'from stream', usage: { totalTokens: 5 } });
  });
});
