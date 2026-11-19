import type { ChatClient } from '../../../shared/agents/types.js';
import { createDatabricksTokenProvider } from '../../chat/databricks-auth.js';
import { presentEnv } from '../../lib/env.js';
import { DatabricksServingChatClient } from './databricks-serving-client.js';
import { OpenAICompatibleChatClient } from './openai-compatible-client.js';
import { resolveLlmEnv } from './resolve-llm-env.js';
import { StubChatClient } from './stub-client.js';

export type ChatClientEnv = Record<string, string | undefined>;

/**
 * Resolve ChatClient from env.
 * Primary: OpenAI-compatible (LLM_BASE_URL + LLM_API_KEY).
 * Option: Databricks Serving (DATABRICKS_SERVING_ENDPOINT_NAME).
 * LLM_PROVIDER=openai|databricks|stub forces a path when ambiguous.
 */
export function createChatClientFromEnv(env: ChatClientEnv = process.env): ChatClient {
  const resolved = resolveLlmEnv(env);
  const provider = (resolved.LLM_PROVIDER ?? '').trim().toLowerCase();
  const baseUrl = presentEnv(resolved.LLM_BASE_URL);
  const apiKey = presentEnv(resolved.LLM_API_KEY);
  const endpointName = presentEnv(resolved.DATABRICKS_SERVING_ENDPOINT_NAME);
  const hasOpenAI = Boolean(baseUrl && apiKey);

  if (provider === 'stub') {
    return new StubChatClient();
  }

  if (provider === 'databricks' || (!hasOpenAI && endpointName)) {
    if (!endpointName) {
      throw new Error('LLM_PROVIDER=databricks requires DATABRICKS_SERVING_ENDPOINT_NAME');
    }
    const host = presentEnv(resolved.DATABRICKS_HOST ?? resolved.DATABRICKS_WORKSPACE_URL);
    if (!host) {
      throw new Error('Databricks Serving client requires DATABRICKS_HOST');
    }
    // The LLM is App infrastructure, not the viewer's data: PAT locally, App SP (M2M) when deployed.
    return new DatabricksServingChatClient({
      host,
      endpointName,
      getToken: createDatabricksTokenProvider({ env: resolved, purpose: 'app' }),
    });
  }

  if (provider === 'openai' || hasOpenAI) {
    if (!baseUrl || !apiKey) {
      throw new Error('LLM_PROVIDER=openai requires LLM_BASE_URL and LLM_API_KEY');
    }
    return new OpenAICompatibleChatClient({
      baseUrl,
      apiKey,
      model: resolved.LLM_MODEL?.trim() || 'default',
    });
  }

  return new StubChatClient();
}
