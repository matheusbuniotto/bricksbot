/**
 * Model Context Protocol (MCP) JSON-RPC 2.0 types and Unity Gateway options.
 */

export interface McpClientConfig {
  host: string;
  getToken?: () => Promise<string>;
  workspaceId?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface McpJsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface McpJsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export type McpJsonRpcResponse<T = unknown> =
  | {
      jsonrpc: '2.0';
      id: number | string;
      result: T;
      error?: never;
    }
  | {
      jsonrpc: '2.0';
      id: number | string;
      result?: never;
      error: McpJsonRpcError;
    };

export interface McpToolParameterProperty {
  type: string;
  description?: string;
  enum?: string[];
  items?: Record<string, unknown>;
}

export interface McpToolInputSchema {
  type: 'object';
  properties?: Record<string, McpToolParameterProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema?: McpToolInputSchema;
}

export interface McpContentItem {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
}

export interface McpToolCallResult {
  content: McpContentItem[];
  isError?: boolean;
}

export type GenieStatus = 'in_progress' | 'completed' | 'failed' | 'cancelled';

export interface GenieCitation {
  title?: string;
  url?: string;
  description?: string;
}

export interface GenieAskResult {
  conversation_id: string;
  response_id?: string;
  status: GenieStatus;
  answer?: string;
  query?: string;
  citations?: GenieCitation[];
  error?: string;
}

export interface SystemAiMcpOptions {
  enabled?: boolean;
  host?: string;
  getToken?: () => Promise<string>;
  workspaceId?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxPollSeconds?: number;
  pollIntervalMs?: number;
  serviceName?: string;
}
