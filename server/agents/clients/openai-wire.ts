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

interface StreamChunk {
  model?: string;
  error?: { message?: string };
  usage?: WireUsage;
  choices?: Array<{
    finish_reason?: string | null;
    delta?: {
      content?: string | null;
      tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>;
    };
  }>;
}

/**
 * Read an SSE chat-completions body into the same result a plain response gives.
 * Tool calls arrive in fragments keyed by `index`; usage comes with the final chunk (`include_usage`).
 */
async function readStreamedCompletion(
  response: Response,
  onDelta: (text: string) => void
): Promise<ChatCompletionResult> {
  let content = '';
  let model: string | undefined;
  let finishReason: string | undefined;
  let usage: WireUsage | undefined;
  const calls: Array<{ id: string; function: { name: string; arguments: string } }> = [];

  const take = (line: string) => {
    const data = line.startsWith('data:') ? line.slice(5).trim() : '';
    if (!data || data === '[DONE]') return;
    let chunk: StreamChunk;
    try {
      chunk = JSON.parse(data) as StreamChunk;
    } catch {
      return;
    }
    if (chunk.error) throw new Error(`stream error: ${chunk.error.message ?? 'unknown'}`);
    model = chunk.model ?? model;
    usage = chunk.usage ?? usage;
    const choice = chunk.choices?.[0];
    finishReason = choice?.finish_reason ?? finishReason;
    const text = choice?.delta?.content;
    if (text) {
      content += text;
      onDelta(text);
    }
    for (const fragment of choice?.delta?.tool_calls ?? []) {
      const call = (calls[fragment.index ?? 0] ??= { id: '', function: { name: '', arguments: '' } });
      call.id = fragment.id ?? call.id;
      call.function.name = fragment.function?.name ?? call.function.name;
      call.function.arguments += fragment.function?.arguments ?? '';
    }
  };

  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffered += decoder.decode(chunk.value, { stream: true });
    const lines = buffered.split('\n');
    buffered = lines.pop() ?? '';
    lines.forEach(take);
  }
  take(buffered);

  return {
    content: content || null,
    toolCalls: parseToolCalls(
      calls
        .filter(Boolean)
        .map((call) => ({ ...call, function: { ...call.function, arguments: call.function.arguments || '{}' } }))
    ),
    usage: parseUsage(usage),
    model,
    finishReason,
  };
}

/**
 * Endpoints (url + model) that refused `stream: true`, with when to ask again. They are called without it
 * meanwhile; the memory expires so a one-off error cannot switch streaming off for the life of the process.
 */
const streamRefused = new Map<string, number>();
const STREAM_REFUSED_FOR_MS = 10 * 60_000;
const STREAM_REFUSED_STATUSES = new Set([400, 404, 405, 415, 422, 501]);

/**
 * POST a chat completion. With `onDelta` it asks for a stream and feeds text as it arrives;
 * an endpoint that rejects streaming, or answers with plain JSON anyway, still works.
 */
export async function postChatCompletion(input: {
  fetchImpl: typeof fetch;
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
  /** Names the provider in errors. */
  label: string;
  parse?: (payload: WireCompletion) => ChatCompletionResult;
}): Promise<ChatCompletionResult> {
  const { fetchImpl, url, headers, body, signal, onDelta, label } = input;
  const key = `${url} ${(body.model as string | undefined) ?? ''}`;
  const post = (stream: boolean) =>
    fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(stream ? { ...body, stream: true, stream_options: { include_usage: true } } : body),
      signal,
    });

  const streaming = Boolean(onDelta) && (streamRefused.get(key) ?? 0) <= Date.now();
  let response = await post(streaming);
  if (streaming && STREAM_REFUSED_STATUSES.has(response.status)) {
    // Only a retry that works proves the endpoint refuses streaming rather than the request.
    const retry = await post(false);
    if (retry.ok) streamRefused.set(key, Date.now() + STREAM_REFUSED_FOR_MS);
    response = retry;
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`${label} error (${response.status}): ${text || response.statusText}`);
  }
  if (streaming && onDelta && response.headers.get('content-type')?.includes('text/event-stream')) {
    return readStreamedCompletion(response, onDelta);
  }
  return (input.parse ?? parseCompletion)((await response.json()) as WireCompletion);
}
