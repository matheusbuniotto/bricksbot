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

export type McpSource = 'system' | 'user' | 'custom';

export interface DatabricksMcpApp {
  id: string;
  name: string;
  service: string;
  catalog?: string;
  schema?: string;
  source?: McpSource;
  category: 'lakehouse' | 'communication' | 'productivity' | 'compute' | 'search' | 'custom';
  categoryLabel: string;
  description: string;
  tools: string[];
  status: McpStatus;
  isViable?: boolean;
  /** True when this service is connected and its tools are registered on ChatService. */
  connected?: boolean;
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
    | 'm365'
    | 'custom';
}

/**
 * One user's connector state for a single MCP service. Connectors are user-level:
 * every row belongs to exactly one `userId` and never affects other users.
 */
export interface McpConnectorRecord {
  userId: string;
  service: string;
  connected: boolean;
  /** Registered through "Add custom MCP" (listed even when not in the discovered catalog). */
  custom: boolean;
  name?: string;
  description?: string;
  tools: string[];
  createdAt: string;
  updatedAt: string;
}

export type McpConnectorInput = Omit<McpConnectorRecord, 'createdAt' | 'updatedAt'>;

export interface McpConnectorStore {
  listConnectors(userId: string): Promise<McpConnectorRecord[]>;
  getConnector(userId: string, service: string): Promise<McpConnectorRecord | null>;
  upsertConnector(input: McpConnectorInput): Promise<McpConnectorRecord>;
  deleteConnector(userId: string, service: string): Promise<boolean>;
}

/** Placeholder only — pass real host/org via discovery config / DATABRICKS_HOST. */
export const DEFAULT_DATABRICKS_WORKSPACE_HOST = 'https://dbc-example.cloud.databricks.com';
export const DEFAULT_DATABRICKS_ORG_ID = '0000000000000000';

/**
 * Direct Databricks AI Gateway MCP configuration URL.
 */
export const DATABRICKS_AI_GATEWAY_MCP_URL = `${DEFAULT_DATABRICKS_WORKSPACE_HOST}/ml/ai-gateway/mcp?o=${DEFAULT_DATABRICKS_ORG_ID}`;

/**
 * Builds direct URL to an MCP service in Databricks Unity Catalog Explorer.
 * Example: system.ai.slack -> https://dbc-example.cloud.databricks.com/explore/mcp-services/system/ai/slack?o=0000000000000000&activeTab=overview
 */
export function buildDatabricksMcpServiceUrl(servicePath: string, options?: { host?: string; orgId?: string }): string {
  const host = (options?.host || DEFAULT_DATABRICKS_WORKSPACE_HOST).replace(/\/+$/, '');
  const orgId = options?.orgId || DEFAULT_DATABRICKS_ORG_ID;
  const cleanPath = servicePath.replace(/^\/+/, '').replace(/\./g, '/');
  return `${host}/explore/mcp-services/${cleanPath}?o=${orgId}&activeTab=overview`;
}

export const BUILTIN_PLUGIN_MCPS: DatabricksMcpApp[] = [
  {
    id: 'teatools-experimentation',
    name: 'Experimentation & A/B Tests',
    service: 'plugin.teatools',
    source: 'system',
    category: 'lakehouse',
    categoryLabel: 'Lakehouse & Analytics',
    description:
      'Experiment design, sample size & power, SRM checks, A/B analysis (CUPED, delta method, Yuen, bootstrap), mSPRT sequential monitoring, and agent eval comparisons',
    tools: [
      'design',
      'power',
      'srm_check',
      'analyze',
      'sequential_check',
      'compare_eval_runs',
      'agreement_kappa',
      'report',
    ],
    status: 'active',
    isViable: true,
    recommended: true,
    iconBg: '#7c3aed',
    iconColor: '#ffffff',
    iconType: 'custom',
  },
];

export const AVAILABLE_DATABRICKS_MCPS: DatabricksMcpApp[] = [
  {
    id: 'genie-one',
    name: 'Databricks One (Genie)',
    service: 'system.ai.genie_one_mcp',
    source: 'system',
    category: 'lakehouse',
    categoryLabel: 'Lakehouse & Analytics',
    description: 'Natural language analytics grounded in Lakehouse Ontology (Genie Analytics)',
    tools: ['genie_ask', 'genie_poll_response', 'genie_get_query_result', 'genie_cancel_response'],
    status: 'active',
    isViable: true,
    recommended: true,
    connectUrl: buildDatabricksMcpServiceUrl('system.ai.genie_one_mcp'),
    iconBg: '#1b1b1d',
    iconColor: '#ff3621',
    iconType: 'genie',
  },
  {
    id: 'databricks-dbsql',
    name: 'Databricks SQL',
    service: 'system.ai.dbsql',
    source: 'system',
    category: 'lakehouse',
    categoryLabel: 'Lakehouse & Analytics',
    description: 'Governed SQL warehouse queries via system.ai.dbsql',
    tools: ['execute_sql', 'poll_sql_result'],
    status: 'active',
    isViable: true,
    recommended: true,
    connectUrl: buildDatabricksMcpServiceUrl('system.ai.dbsql'),
    iconBg: '#ff3621',
    iconColor: '#ffffff',
    iconType: 'databricks',
  },
  {
    id: 'databricks-web-search',
    name: 'Databricks Web Search',
    service: 'system.ai.web_search',
    source: 'system',
    category: 'search',
    categoryLabel: 'Web Search',
    description: 'Public web search with synthesized citations via Foundation Model API',
    tools: ['web_search'],
    status: 'active',
    isViable: true,
    recommended: true,
    connectUrl: buildDatabricksMcpServiceUrl('system.ai.web_search'),
    iconBg: '#00a2ff',
    iconColor: '#ffffff',
    iconType: 'search',
  },
  {
    id: 'databricks-sandbox',
    name: 'Databricks Code Sandbox',
    service: 'system.ai.sandbox',
    source: 'system',
    category: 'compute',
    categoryLabel: 'Code & Execution',
    description: 'Isolated Python and shell execution environment on Serverless compute',
    tools: ['create_sandbox', 'run_code', 'delete_sandbox'],
    status: 'active',
    isViable: true,
    recommended: true,
    connectUrl: buildDatabricksMcpServiceUrl('system.ai.sandbox'),
    iconBg: '#0f766e',
    iconColor: '#ffffff',
    iconType: 'code',
  },
  {
    id: 'slack',
    name: 'Slack',
    service: 'system.ai.slack',
    source: 'system',
    category: 'communication',
    categoryLabel: 'Communication',
    description: 'Team channels, messages, and discussion history integrated into Databricks One',
    tools: ['search_messages', 'read_channel'],
    status: 'inactive',
    isViable: false,
    connectUrl: buildDatabricksMcpServiceUrl('system.ai.slack'),
    iconBg: '#4a154b',
    iconColor: '#ffffff',
    iconType: 'slack',
  },
  {
    id: 'confluence',
    name: 'Confluence',
    service: 'system.ai.confluence',
    source: 'system',
    category: 'productivity',
    categoryLabel: 'Productivity',
    description: 'Documentation spaces, wikis, and product specs via Databricks One',
    tools: ['search_pages', 'read_page'],
    status: 'inactive',
    isViable: false,
    connectUrl: buildDatabricksMcpServiceUrl('system.ai.confluence'),
    iconBg: '#0052cc',
    iconColor: '#ffffff',
    iconType: 'confluence',
  },
  {
    id: 'jira',
    name: 'Jira Software',
    service: 'system.ai.jira',
    source: 'system',
    category: 'productivity',
    categoryLabel: 'Productivity',
    description: 'Sprints, backlog tickets, and engineering tasks indexed in Unity Catalog',
    tools: ['search_issues', 'get_issue'],
    status: 'inactive',
    isViable: false,
    connectUrl: buildDatabricksMcpServiceUrl('system.ai.jira'),
    iconBg: '#0052cc',
    iconColor: '#ffffff',
    iconType: 'jira',
  },
  {
    id: 'github',
    name: 'GitHub',
    service: 'system.ai.github',
    source: 'system',
    category: 'compute',
    categoryLabel: 'Code & Execution',
    description: 'Code repositories, pull requests, and technical Git documentation',
    tools: ['search_code', 'get_pr'],
    status: 'inactive',
    isViable: false,
    connectUrl: buildDatabricksMcpServiceUrl('system.ai.github'),
    iconBg: '#24292e',
    iconColor: '#ffffff',
    iconType: 'github',
  },
  {
    id: 'notion',
    name: 'Notion',
    service: 'system.ai.notion',
    source: 'system',
    category: 'productivity',
    categoryLabel: 'Productivity',
    description: 'Knowledge bases, pages, and collaborative workspaces integrated into Databricks One',
    tools: ['search_pages', 'get_block'],
    status: 'inactive',
    isViable: false,
    connectUrl: buildDatabricksMcpServiceUrl('system.ai.notion'),
    iconBg: '#000000',
    iconColor: '#ffffff',
    iconType: 'notion',
  },
  {
    id: 'google-drive',
    name: 'Google Drive',
    service: 'system.ai.google_drive',
    source: 'system',
    category: 'productivity',
    categoryLabel: 'Productivity',
    description: 'Shared documents, spreadsheets, and reports indexed via Databricks One',
    tools: ['search_files', 'read_doc'],
    status: 'inactive',
    isViable: false,
    connectUrl: buildDatabricksMcpServiceUrl('system.ai.google_drive'),
    iconBg: '#f1f3f4',
    iconColor: '#0f9d58',
    iconType: 'google-drive',
  },
  {
    id: 'm365',
    name: 'Microsoft 365',
    service: 'system.ai.m365',
    source: 'system',
    category: 'communication',
    categoryLabel: 'Communication',
    description: 'SharePoint sites, Outlook emails, and enterprise documents in Databricks One',
    tools: ['search_sharepoint', 'search_emails'],
    status: 'inactive',
    isViable: false,
    connectUrl: buildDatabricksMcpServiceUrl('system.ai.m365'),
    iconBg: '#0078d4',
    iconColor: '#ffffff',
    iconType: 'm365',
  },
];
