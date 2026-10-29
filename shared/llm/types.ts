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
}

export interface ChatCompletionResult {
  content: string | null;
  toolCalls: ToolCall[];
}

export interface ChatClient {
  readonly provider: 'openai-compatible' | 'databricks-serving' | 'stub';
  complete(request: ChatCompletionRequest): Promise<ChatCompletionResult>;
}

export type ApprovalStatus = 'pending' | 'approved' | 'denied';

export type ApprovalDecision =
  | 'all_the_time'
  | 'always'
  | 'once'
  | 'approved'
  | 'denied'
  | 'not_approved';

export interface ApprovalRequest {
  id: string;
  chatId: string;
  toolCall: ToolCall;
  status: ApprovalStatus;
  decision?: 'all_the_time' | 'once' | 'denied';
  createdAt: string;
  decidedAt?: string;
}
