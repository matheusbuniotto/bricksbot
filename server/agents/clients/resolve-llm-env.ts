type Env = Record<string, string | undefined>;

/** OpenRouter defaults for the OpenAI-compatible ChatClient. */
export const DEFAULT_LLM_BASE_URL = 'https://openrouter.ai/api/v1';
export const DEFAULT_LLM_MODEL = 'openai/gpt-6-luna';

function truthy(value: string | undefined): value is string {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed === '__UNSET__') return false;
  return true;
}

/**
 * Normalize LLM env for deploy + local dev.
 * Workspace apps inject `OPENROUTER_API_KEY` from scope `claw`;
 * BricksBot's ChatClient still reads OpenAI-compatible `LLM_*` vars.
 */
export function resolveLlmEnv(env: Env = process.env): Env {
  const apiKey = truthy(env.LLM_API_KEY) ? env.LLM_API_KEY : env.OPENROUTER_API_KEY;
  return {
    ...env,
    LLM_API_KEY: apiKey,
    LLM_BASE_URL: truthy(env.LLM_BASE_URL) ? env.LLM_BASE_URL : DEFAULT_LLM_BASE_URL,
    LLM_MODEL: truthy(env.LLM_MODEL) ? env.LLM_MODEL : DEFAULT_LLM_MODEL,
  };
}
