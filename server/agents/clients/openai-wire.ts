import type {
  ChatCompletionRequest,
  ChatCompletionResult,
  LlmMessage,
  LlmUsage,
  ToolCall,
} from '../../../shared/agents/types.js';

/** Map internal LlmMessage[] to OpenAI chat-completions message objects. */
export function serializeOpenAiMessages(messages: LlmMessage[]): Record<string, unknown>[] {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return {
        role: 'tool',
        content: message.content,
        tool_call_id: message.toolCallId,
        ...(message.name ? { name: message.name } : {}),
      };
    }
    if (message.role === 'assistant' && message.toolCalls?.length) {
      return {
        role: 'assistant',
        content: message.content.trim() ? message.content : null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: {
            name: call.name,
            arguments: JSON.stringify(call.arguments ?? {}),
          },
        })),
      };
    }
    return { role: message.role, content: message.content };
  });
}

/** OpenAI chat-completions body shared by OpenAI-compatible providers and Databricks Serving. */
export function chatCompletionBody(request: ChatCompletionRequest): Record<string, unknown> {
  const body: Record<string, unknown> = { messages: serializeOpenAiMessages(request.messages) };
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
  return body;
}

/** Parse `message.tool_calls`; unparseable arguments are kept as `{ raw }`. */
export function parseToolCalls(raw: unknown): ToolCall[] {
  if (!Array.isArray(raw)) return [];
  const calls: ToolCall[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as {
      id?: string;
      function?: { name?: string; arguments?: string };
    };
    if (!row.id || !row.function?.name) continue;
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(row.function.arguments ?? '{}') as Record<string, unknown>;
    } catch {
      args = { raw: row.function.arguments };
    }
    calls.push({ id: row.id, name: row.function.name, arguments: args });
  }
  return calls;
}

interface WireUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
}

export interface WireCompletion {
  model?: string;
  choices?: Array<{ message?: { content?: string | null; tool_calls?: unknown }; finish_reason?: string | null }>;
  usage?: WireUsage;
}

function parseUsage(raw: WireUsage | undefined): LlmUsage | undefined {
  if (!raw) return undefined;
  const promptTokens = raw.prompt_tokens ?? 0;
  const completionTokens = raw.completion_tokens ?? 0;
  const cachedTokens = raw.prompt_tokens_details?.cached_tokens;
  const reasoningTokens = raw.completion_tokens_details?.reasoning_tokens;
  return {
    promptTokens,
    completionTokens,
    totalTokens: raw.total_tokens ?? promptTokens + completionTokens,
    ...(cachedTokens !== undefined ? { cachedTokens } : {}),
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    ...(typeof raw.cost === 'number' ? { cost: raw.cost } : {}),
  };
}

/** Map a chat-completions response to a ChatCompletionResult (shared by OpenAI-compatible and Serving). */
export function parseCompletion(payload: WireCompletion): ChatCompletionResult {
  const choice = payload.choices?.[0];
  return {
    content: choice?.message?.content ?? null,
    toolCalls: parseToolCalls(choice?.message?.tool_calls),
    usage: parseUsage(payload.usage),
    model: payload.model,
    finishReason: choice?.finish_reason ?? undefined,
  };
}
