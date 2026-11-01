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

export interface DatabricksMcpApp {
  id: string;
  name: string;
  service: string;
  category: 'lakehouse' | 'search' | 'compute';
  categoryLabel: string;
  description: string;
  tools: string[];
  recommended?: boolean;
  iconBg: string;
  iconColor: string;
  iconType: 'genie' | 'databricks' | 'search' | 'code';
}

export const AVAILABLE_DATABRICKS_MCPS: DatabricksMcpApp[] = [
  {
    id: 'genie-one',
    name: 'Databricks One (Genie)',
    service: 'system.ai.genie_one_mcp',
    category: 'lakehouse',
    categoryLabel: 'Lakehouse & Análise',
    description: 'Análise em linguagem natural com a Ontologia do Lakehouse (Genie Analytics)',
    tools: ['genie_ask', 'genie_poll_response', 'genie_get_query_result', 'genie_cancel_response'],
    recommended: true,
    iconBg: '#1b1b1d',
    iconColor: '#ff3621',
    iconType: 'genie',
  },
  {
    id: 'databricks-dbsql',
    name: 'Databricks SQL',
    service: 'system.ai.dbsql',
    category: 'lakehouse',
    categoryLabel: 'Lakehouse & Análise',
    description: 'Consultas governadas em SQL Warehouses via system.ai.dbsql',
    tools: ['execute_sql', 'poll_sql_result'],
    recommended: true,
    iconBg: '#ff3621',
    iconColor: '#ffffff',
    iconType: 'databricks',
  },
  {
    id: 'databricks-web-search',
    name: 'Databricks Web Search',
    service: 'system.ai.web_search',
    category: 'search',
    categoryLabel: 'Busca Web',
    description: 'Busca pública na web com citações sintetizadas via Foundation Model API',
    tools: ['web_search'],
    recommended: true,
    iconBg: '#00a2ff',
    iconColor: '#ffffff',
    iconType: 'search',
  },
  {
    id: 'databricks-sandbox',
    name: 'Databricks Code Sandbox',
    service: 'system.ai.sandbox',
    category: 'compute',
    categoryLabel: 'Código & Execução',
    description: 'Ambiente isolado de execução Python e shell em Serverless compute',
    tools: ['create_sandbox', 'run_code', 'delete_sandbox'],
    recommended: true,
    iconBg: '#0f766e',
    iconColor: '#ffffff',
    iconType: 'code',
  },
];
