import type {
  ChatClient,
  ChatCompletionOptions,
  ChatCompletionRequest,
  ChatCompletionResult,
} from '../../../shared/agents/types.js';
import { normalizeHostUrl } from '../../chat/databricks-auth.js';
import { chatCompletionBody, parseCompletion, type WireCompletion } from './openai-wire.js';

export interface DatabricksServingConfig {
  host: string;
  endpointName: string;
  getToken: () => Promise<string>;
  fetchImpl?: typeof fetch;
}

/** Databricks Model Serving / Foundation Model invocations (OpenAI-compatible body). */
export class DatabricksServingChatClient implements ChatClient {
  readonly provider = 'databricks-serving' as const;
  readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: DatabricksServingConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.model = config.endpointName;
  }

  async complete(request: ChatCompletionRequest, options?: ChatCompletionOptions): Promise<ChatCompletionResult> {
    const host = normalizeHostUrl(this.config.host);
    const url = `${host}/serving-endpoints/${encodeURIComponent(request.model ?? this.config.endpointName)}/invocations`;
    const token = await this.config.getToken();

    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(chatCompletionBody(request)),
      signal: options?.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Databricks Serving error (${response.status}): ${text || response.statusText}`);
    }

    const payload = (await response.json()) as WireCompletion & {
      // Some endpoints return predictions / candidates instead of choices.
      candidates?: Array<{ content?: string }>;
    };
    const result = parseCompletion(payload);
    return result.content === null && !result.toolCalls.length
      ? { ...result, content: payload.candidates?.[0]?.content ?? null }
      : result;
  }
}
