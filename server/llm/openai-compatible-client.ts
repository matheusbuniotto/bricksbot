import type {
  ChatClient,
  ChatCompletionRequest,
  ChatCompletionResult,
  ToolCall,
} from '../../shared/llm/types.js';
import { serializeOpenAiMessages } from './serialize-openai-messages.js';

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

function parseToolCalls(raw: unknown): ToolCall[] {
  if (!Array.isArray(raw)) return [];
  const calls: ToolCall[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as {
      id?: string;
      function?: { name?: string; arguments?: string };
    };
    if (!row.id || !row.function?.name) continue;
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(row.function.arguments ?? '{}') as Record<string, unknown>;
    } catch {
      args = { raw: row.function.arguments };
    }
    calls.push({ id: row.id, name: row.function.name, arguments: args });
  }
  return calls;
}

export class OpenAICompatibleChatClient implements ChatClient {
  readonly provider = 'openai-compatible' as const;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: OpenAICompatibleConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async complete(request: ChatCompletionRequest): Promise<ChatCompletionResult> {
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: serializeOpenAiMessages(request.messages),
    };

    if (request.tools?.length) {
      body.tools = request.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));
    }

    const response = await this.fetchImpl(chatCompletionsUrl(this.config.baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`OpenAI-compatible LLM error (${response.status}): ${text || response.statusText}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null; tool_calls?: unknown } }>;
    };
    const message = payload.choices?.[0]?.message;
    const content = message?.content ?? null;
    return {
      content: content === undefined ? null : content,
      toolCalls: parseToolCalls(message?.tool_calls),
    };
  }
}
