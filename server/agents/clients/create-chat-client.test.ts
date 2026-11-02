import { describe, expect, test } from 'vitest';
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
});
