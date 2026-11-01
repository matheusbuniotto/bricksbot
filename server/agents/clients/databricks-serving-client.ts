import type {
  ChatClient,
  ChatCompletionRequest,
  ChatCompletionResult,
  ToolCall,
} from '../../../shared/agents/types.js';
import { serializeOpenAiMessages } from './serialize-openai-messages.js';

export interface DatabricksServingConfig {
  host: string;
  endpointName: string;
  getToken: () => Promise<string>;
  fetchImpl?: typeof fetch;
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

/** Databricks Model Serving / Foundation Model invocations (OpenAI-compatible body). */
export class DatabricksServingChatClient implements ChatClient {
  readonly provider = 'databricks-serving' as const;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: DatabricksServingConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async complete(request: ChatCompletionRequest): Promise<ChatCompletionResult> {
    const rawHost = this.config.host.trim().replace(/\/+$/, '');
    const host = /^https?:\/\//i.test(rawHost) ? rawHost : `https://${rawHost}`;
    const url = `${host}/serving-endpoints/${encodeURIComponent(this.config.endpointName)}/invocations`;
    const token = await this.config.getToken();

    const body: Record<string, unknown> = {
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

    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Databricks Serving error (${response.status}): ${text || response.statusText}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null; tool_calls?: unknown } }>;
      // Some endpoints return predictions / candidates instead of choices.
      candidates?: Array<{ content?: string }>;
    };

    if (payload.choices?.[0]?.message) {
      const message = payload.choices[0].message;
      return {
        content: message.content ?? null,
        toolCalls: parseToolCalls(message.tool_calls),
      };
    }

    const fallback = payload.candidates?.[0]?.content;
    return { content: fallback ?? null, toolCalls: [] };
  }
}
