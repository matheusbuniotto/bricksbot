import type { Request } from 'express';
import { describe, expect, test, vi } from 'vitest';
import { runWithDatabricksRequestAuth } from '../../chat/databricks-auth.js';
import { createChatClientFromEnv } from './create-chat-client.js';

describe('createChatClientFromEnv', () => {
  test('prefers openai-compatible when base URL + key are set', () => {
    const client = createChatClientFromEnv({
      LLM_PROVIDER: 'openai',
      LLM_BASE_URL: 'https://openrouter.ai/api/v1',
      LLM_API_KEY: 'sk-test',
      LLM_MODEL: 'x',
    });
    expect(client.provider).toBe('openai-compatible');
  });

  test('selects databricks-serving when provider flag or endpoint is set without openai key', () => {
    const client = createChatClientFromEnv({
      LLM_PROVIDER: 'databricks',
      DATABRICKS_HOST: 'https://dbc.example.cloud.databricks.com',
      DATABRICKS_SERVING_ENDPOINT_NAME: 'my-endpoint',
      DATABRICKS_TOKEN: 'tok',
    });
    expect(client.provider).toBe('databricks-serving');
  });

  test('falls back to stub when nothing is configured', () => {
    const client = createChatClientFromEnv({});
    expect(client.provider).toBe('stub');
  });

  test('treats __UNSET__ secret placeholders as missing', () => {
    const client = createChatClientFromEnv({
      LLM_BASE_URL: 'https://openrouter.ai/api/v1',
      LLM_API_KEY: '__UNSET__',
      LLM_MODEL: '__UNSET__',
    });
    expect(client.provider).toBe('stub');
  });

  test('serving authenticates as the App service principal, never the caller OBO token', async () => {
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(
        url.endsWith('/oidc/v1/token')
          ? Response.json({ access_token: 'sp-token', expires_in: 3600 })
          : Response.json({ choices: [{ message: { content: 'ok' } }] })
      )
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = createChatClientFromEnv({
      LLM_PROVIDER: 'databricks',
      DATABRICKS_HOST: 'https://dbc.example.cloud.databricks.com',
      DATABRICKS_SERVING_ENDPOINT_NAME: 'my-endpoint',
      DATABRICKS_CLIENT_ID: 'cid',
      DATABRICKS_CLIENT_SECRET: 'sec',
    });
    const req = {
      header: () => 'obo-token',
      headers: { 'x-forwarded-access-token': 'obo-token' },
    } as unknown as Request;
    await runWithDatabricksRequestAuth(req, () => client.complete({ messages: [{ role: 'user', content: 'hi' }] }));
    const invocation = fetchMock.mock.calls.find(([url]) => url.includes('/invocations'));
    expect((invocation?.[1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer sp-token' });
    vi.unstubAllGlobals();
  });
});
