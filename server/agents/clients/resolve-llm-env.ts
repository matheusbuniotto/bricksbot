import { presentEnv } from '../../lib/env.js';

type Env = Record<string, string | undefined>;

/** OpenRouter defaults for the OpenAI-compatible ChatClient. */
export const DEFAULT_LLM_BASE_URL = 'https://openrouter.ai/api/v1';
export const DEFAULT_LLM_MODEL = 'openai/gpt-6-luna';

/**
 * Normalize LLM env for deploy + local dev.
 * Workspace apps inject `OPENROUTER_API_KEY` from scope `bricksbot`
 * (override via bundle `provider_secret_scope`); ChatClient still reads `LLM_*`.
 */
export function resolveLlmEnv(env: Env = process.env): Env {
  return {
    ...env,
    LLM_API_KEY: presentEnv(env.LLM_API_KEY) ?? env.OPENROUTER_API_KEY,
    LLM_BASE_URL: presentEnv(env.LLM_BASE_URL) ?? DEFAULT_LLM_BASE_URL,
    LLM_MODEL: presentEnv(env.LLM_MODEL) ?? DEFAULT_LLM_MODEL,
  };
}
