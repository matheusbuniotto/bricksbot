import type {
  ChatClient,
  ChatCompletionOptions,
  ChatCompletionRequest,
  ChatCompletionResult,
} from '../../../shared/agents/types.js';
import { chatCompletionBody, parseCompletion, type WireCompletion } from './openai-wire.js';

export interface OpenAICompatibleConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
}

function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  if (trimmed.endsWith('/v1')) {
    return `${trimmed}/chat/completions`;
  }
  return `${trimmed}/v1/chat/completions`;
}

export class OpenAICompatibleChatClient implements ChatClient {
  readonly provider = 'openai-compatible' as const;
  readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: OpenAICompatibleConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.model = config.model;
  }

  async complete(request: ChatCompletionRequest, options?: ChatCompletionOptions): Promise<ChatCompletionResult> {
    const response = await this.fetchImpl(chatCompletionsUrl(this.config.baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: request.model ?? this.config.model,
        ...(request.meta?.endUser ? { user: request.meta.endUser } : {}),
        ...chatCompletionBody(request),
      }),
      signal: options?.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`OpenAI-compatible LLM error (${response.status}): ${text || response.statusText}`);
    }

    return parseCompletion((await response.json()) as WireCompletion);
  }
}
