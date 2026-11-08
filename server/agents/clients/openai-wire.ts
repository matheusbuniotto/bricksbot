import type { ChatCompletionRequest, LlmMessage, ToolCall } from '../../../shared/agents/types.js';

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
