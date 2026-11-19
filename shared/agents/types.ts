/** Dual ChatClient contract (OpenAI-compatible primary + Databricks Serving). */

export type LlmRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LlmMessage {
  role: LlmRole;
  content: string;
  toolCallId?: string;
  name?: string;
  /** Present on assistant messages that requested tools. */
  toolCalls?: ToolCall[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatCompletionRequest {
  messages: LlmMessage[];
  tools?: ToolDefinition[];
  /** Overrides the client's default model (or Serving endpoint) for this call. */
  model?: string;
  /** Opaque end-user id for provider abuse isolation. Never an email. */
  meta?: { endUser?: string };
}

/** Token counts as reported by the provider. `cost` is the provider's own figure when present (OpenRouter, USD). */
export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens?: number;
  reasoningTokens?: number;
  cost?: number;
}

export interface ChatCompletionResult {
  content: string | null;
  toolCalls: ToolCall[];
  usage?: LlmUsage;
  /** Model that answered, when the provider reports it. */
  model?: string;
  finishReason?: string;
}

export interface ChatCompletionOptions {
  /** Aborting rejects `complete` with an AbortError. */
  signal?: AbortSignal;
  /** Token streaming hook. Accepted now, honored once streaming lands (clients ignore it today). */
  onDelta?: (text: string) => void;
}

export interface ChatClient {
  readonly provider: 'openai-compatible' | 'databricks-serving' | 'stub';
  /** Default model or endpoint name, for traces. */
  readonly model?: string;
  complete(request: ChatCompletionRequest, options?: ChatCompletionOptions): Promise<ChatCompletionResult>;
}

export type ApprovalStatus = 'pending' | 'approved' | 'denied';

export type ApprovalDecision = 'all_the_time' | 'always' | 'once' | 'approved' | 'denied' | 'not_approved';

export interface BaseApprovalRequest {
  id: string;
  chatId: string;
  toolCall: ToolCall;
  createdAt: string;
}

export interface PendingApprovalRequest extends BaseApprovalRequest {
  status: 'pending';
  decision?: undefined;
  decidedAt?: undefined;
}

export interface ResolvedApprovalRequest extends BaseApprovalRequest {
  status: 'approved' | 'denied';
  decision: 'all_the_time' | 'once' | 'denied';
  decidedAt: string;
}

export type ApprovalRequest = PendingApprovalRequest | ResolvedApprovalRequest;

export type ApprovalEventType = 'requested' | 'decided';

/** Append-only approval audit row (Lakebase or in-memory). */
export interface ApprovalEvent {
  id: string;
  chatId: string;
  approvalId: string | null;
  botId: string | null;
  userId: string | null;
  type: ApprovalEventType;
  toolName: string;
  payload: Record<string, unknown>;
  createdAt: string;
}
