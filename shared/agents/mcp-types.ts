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

export type McpStatus = 'active' | 'inactive';

export interface DatabricksMcpApp {
  id: string;
  name: string;
  service: string;
  category: 'lakehouse' | 'communication' | 'productivity' | 'compute' | 'search';
  categoryLabel: string;
  description: string;
  tools: string[];
  status: McpStatus;
  recommended?: boolean;
  connectUrl?: string;
  iconBg: string;
  iconColor: string;
  iconType:
    | 'genie'
    | 'databricks'
    | 'search'
    | 'code'
    | 'slack'
    | 'confluence'
    | 'jira'
    | 'github'
    | 'notion'
    | 'google-drive'
    | 'm365';
}

export const AVAILABLE_DATABRICKS_MCPS: DatabricksMcpApp[] = [
  // Active Databricks MCPs (Live on Unity Gateway)
  {
    id: 'genie-one',
    name: 'Databricks One (Genie)',
    service: 'system.ai.genie_one_mcp',
    category: 'lakehouse',
    categoryLabel: 'Lakehouse & Análise',
    description: 'Análise em linguagem natural com a Ontologia do Lakehouse (Genie Analytics)',
    tools: ['genie_ask', 'genie_poll_response', 'genie_get_query_result', 'genie_cancel_response'],
    status: 'active',
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
    status: 'active',
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
    status: 'active',
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
    status: 'active',
    recommended: true,
    iconBg: '#0f766e',
    iconColor: '#ffffff',
    iconType: 'code',
  },

  // Inactive Corporate Connectors (Configured & connected via Databricks One / Genie Knowledge Sources)
  {
    id: 'slack',
    name: 'Slack',
    service: 'genie.connectors.slack',
    category: 'communication',
    categoryLabel: 'Comunicação',
    description: 'Canais, mensagens e histórico de equipes integrados ao Databricks One',
    tools: ['search_messages', 'read_channel'],
    status: 'inactive',
    connectUrl: 'https://dbc-562d9321-2592.cloud.databricks.com/genie',
    iconBg: '#4a154b',
    iconColor: '#ffffff',
    iconType: 'slack',
  },
  {
    id: 'confluence',
    name: 'Confluence',
    service: 'genie.connectors.confluence',
    category: 'productivity',
    categoryLabel: 'Produtividade',
    description: 'Espaços de documentação, wikis e especificações de produto via Genie',
    tools: ['search_pages', 'read_page'],
    status: 'inactive',
    connectUrl: 'https://dbc-562d9321-2592.cloud.databricks.com/genie',
    iconBg: '#0052cc',
    iconColor: '#ffffff',
    iconType: 'confluence',
  },
  {
    id: 'jira',
    name: 'Jira Software',
    service: 'genie.connectors.jira',
    category: 'productivity',
    categoryLabel: 'Produtividade',
    description: 'Sprints, backlog de tickets e tarefas de engenharia indexados na Ontologia',
    tools: ['search_issues', 'get_issue'],
    status: 'inactive',
    connectUrl: 'https://dbc-562d9321-2592.cloud.databricks.com/genie',
    iconBg: '#0052cc',
    iconColor: '#ffffff',
    iconType: 'jira',
  },
  {
    id: 'github',
    name: 'GitHub',
    service: 'genie.connectors.github',
    category: 'compute',
    categoryLabel: 'Código & Execução',
    description: 'Repositórios de código, pull requests e documentação técnica Git',
    tools: ['search_code', 'get_pr'],
    status: 'inactive',
    connectUrl: 'https://dbc-562d9321-2592.cloud.databricks.com/genie',
    iconBg: '#24292e',
    iconColor: '#ffffff',
    iconType: 'github',
  },
  {
    id: 'notion',
    name: 'Notion',
    service: 'genie.connectors.notion',
    category: 'productivity',
    categoryLabel: 'Produtividade',
    description: 'Bases de conhecimento, páginas e projetos colaborativos integrados ao Genie',
    tools: ['search_pages', 'get_block'],
    status: 'inactive',
    connectUrl: 'https://dbc-562d9321-2592.cloud.databricks.com/genie',
    iconBg: '#000000',
    iconColor: '#ffffff',
    iconType: 'notion',
  },
  {
    id: 'google-drive',
    name: 'Google Drive',
    service: 'genie.connectors.google_drive',
    category: 'productivity',
    categoryLabel: 'Produtividade',
    description: 'Documentos, planilhas e relatórios compartilhados indexados via Databricks One',
    tools: ['search_files', 'read_doc'],
    status: 'inactive',
    connectUrl: 'https://dbc-562d9321-2592.cloud.databricks.com/genie',
    iconBg: '#f1f3f4',
    iconColor: '#0f9d58',
    iconType: 'google-drive',
  },
  {
    id: 'm365',
    name: 'Microsoft 365',
    service: 'genie.connectors.m365',
    category: 'communication',
    categoryLabel: 'Comunicação',
    description: 'SharePoint, emails do Outlook e documentos empresariais no Databricks One',
    tools: ['search_sharepoint', 'search_emails'],
    status: 'inactive',
    connectUrl: 'https://dbc-562d9321-2592.cloud.databricks.com/genie',
    iconBg: '#0078d4',
    iconColor: '#ffffff',
    iconType: 'm365',
  },
];
