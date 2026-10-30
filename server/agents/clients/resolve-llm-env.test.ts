import { describe, expect, test } from 'vitest';
import { DEFAULT_LLM_BASE_URL, DEFAULT_LLM_MODEL, resolveLlmEnv } from './resolve-llm-env.js';
import { createChatClientFromEnv } from './create-chat-client.js';

describe('resolveLlmEnv', () => {
  test('maps OPENROUTER_API_KEY into LLM_API_KEY with OpenRouter defaults', () => {
    const resolved = resolveLlmEnv({ OPENROUTER_API_KEY: 'sk-or-test' });
    expect(resolved.LLM_API_KEY).toBe('sk-or-test');
    expect(resolved.LLM_BASE_URL).toBe(DEFAULT_LLM_BASE_URL);
    expect(resolved.LLM_MODEL).toBe(DEFAULT_LLM_MODEL);
  });

  test('prefers explicit LLM_* overrides', () => {
    const resolved = resolveLlmEnv({
      OPENROUTER_API_KEY: 'from-claw',
      LLM_API_KEY: 'explicit',
      LLM_BASE_URL: 'https://example.com/v1',
      LLM_MODEL: 'custom/model',
    });
    expect(resolved.LLM_API_KEY).toBe('explicit');
    expect(resolved.LLM_BASE_URL).toBe('https://example.com/v1');
    expect(resolved.LLM_MODEL).toBe('custom/model');
  });

  test('createChatClientFromEnv uses shared claw secret via OPENROUTER_API_KEY', () => {
    const client = createChatClientFromEnv({ OPENROUTER_API_KEY: 'sk-or-test' });
    expect(client.provider).toBe('openai-compatible');
  });
});
