import { afterEach, describe, expect, test, vi } from 'vitest';
import { DatabricksServingChatClient } from './databricks-serving-client.js';

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
});
