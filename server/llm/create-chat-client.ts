import type { ChatClient } from '../../shared/llm/types.js';
import { DatabricksServingChatClient } from './databricks-serving-client.js';
import { OpenAICompatibleChatClient } from './openai-compatible-client.js';
import { resolveLlmEnv } from './resolve-llm-env.js';
import { StubChatClient } from './stub-client.js';

export type ChatClientEnv = Record<string, string | undefined>;

function truthy(value: string | undefined): value is string {
  if (!value) return false;
  const trimmed = value.trim();
  // Placeholder used when a Databricks secret resource must exist but is not configured yet.
  if (!trimmed || trimmed === '__UNSET__') return false;
  return true;
}

/**
 * Resolve ChatClient from env.
 * Primary: OpenAI-compatible (LLM_BASE_URL + LLM_API_KEY).
 * Option: Databricks Serving (DATABRICKS_SERVING_ENDPOINT_NAME).
 * LLM_PROVIDER=openai|databricks|stub forces a path when ambiguous.
 */
export function createChatClientFromEnv(env: ChatClientEnv = process.env): ChatClient {
  const resolved = resolveLlmEnv(env);
  const provider = (resolved.LLM_PROVIDER ?? '').trim().toLowerCase();
  const hasOpenAI = truthy(resolved.LLM_BASE_URL) && truthy(resolved.LLM_API_KEY);
  const hasServing = truthy(resolved.DATABRICKS_SERVING_ENDPOINT_NAME);

  if (provider === 'stub') {
    return new StubChatClient();
  }

  if (provider === 'databricks' || (!hasOpenAI && hasServing)) {
    if (!hasServing) {
      throw new Error('LLM_PROVIDER=databricks requires DATABRICKS_SERVING_ENDPOINT_NAME');
    }
    const host = resolved.DATABRICKS_HOST ?? resolved.DATABRICKS_WORKSPACE_URL;
    if (!truthy(host)) {
      throw new Error('Databricks Serving client requires DATABRICKS_HOST');
    }
    const staticToken = resolved.DATABRICKS_TOKEN;
    return new DatabricksServingChatClient({
      host,
      endpointName: resolved.DATABRICKS_SERVING_ENDPOINT_NAME!,
      getToken: async () => {
        if (truthy(staticToken)) return staticToken;
        throw new Error('DATABRICKS_TOKEN is required for Serving outside the App runtime');
      },
    });
  }

  if (provider === 'openai' || hasOpenAI) {
    if (!hasOpenAI) {
      throw new Error('LLM_PROVIDER=openai requires LLM_BASE_URL and LLM_API_KEY');
    }
    return new OpenAICompatibleChatClient({
      baseUrl: resolved.LLM_BASE_URL!,
      apiKey: resolved.LLM_API_KEY!,
      model: resolved.LLM_MODEL?.trim() || 'default',
    });
  }

  return new StubChatClient();
}
