import type { ChatClient, ChatCompletionRequest, ChatCompletionResult } from '../../../shared/agents/types.js';
import { chatCompletionBody, parseToolCalls } from './openai-wire.js';

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
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: OpenAICompatibleConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async complete(request: ChatCompletionRequest): Promise<ChatCompletionResult> {
    const response = await this.fetchImpl(chatCompletionsUrl(this.config.baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: this.config.model, ...chatCompletionBody(request) }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`OpenAI-compatible LLM error (${response.status}): ${text || response.statusText}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null; tool_calls?: unknown } }>;
    };
    const message = payload.choices?.[0]?.message;
    return {
      content: message?.content ?? null,
      toolCalls: parseToolCalls(message?.tool_calls),
    };
  }
}
