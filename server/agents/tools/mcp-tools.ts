import type { ToolDefinition } from '../../../shared/agents/types.js';
import type { McpClientConfig, McpToolDefinition } from '../../../shared/agents/mcp-types.js';
import type { HandoffTurnContext } from '../handoff.js';
import { UnityGatewayMcpClient } from './mcp-client.js';
import { createSystemAiMcpTools, DEFAULT_GENIE_SERVICE_NAME, type RegisteredTool } from './system-ai-mcp.js';
import type { McpDiscoveryService } from './mcp-discovery.js';

/** OpenAI tool names created for connected non-Genie MCP services. */
export function mcpToolName(service: string, toolName: string): string {
  const slug = service
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase();
  return `mcp_${slug}_${toolName}`;
}

/** True for tools registered from a connected Unity Gateway MCP (not Genie specialists). */
export function isConnectedMcpTool(toolName: string): boolean {
  return toolName.startsWith('mcp_');
}

function schemaToParameters(inputSchema?: McpToolDefinition['inputSchema']): Record<string, unknown> {
  if (!inputSchema || typeof inputSchema !== 'object') {
    return { type: 'object', properties: {}, additionalProperties: true };
  }
  return {
    type: inputSchema.type || 'object',
    properties: inputSchema.properties ?? {},
    ...(inputSchema.required ? { required: inputSchema.required } : {}),
    ...(inputSchema.additionalProperties !== undefined
      ? { additionalProperties: inputSchema.additionalProperties }
      : { additionalProperties: true }),
  };
}

/**
 * Thin wrappers: each MCP tools/list entry becomes an Ask-first ChatService tool
 * that forwards to Unity Gateway `tools/call`.
 */
export function createGenericMcpTools(
  client: UnityGatewayMcpClient,
  serviceName: string,
  toolDefs: McpToolDefinition[]
): RegisteredTool[] {
  return toolDefs.map((def) => {
    const name = mcpToolName(serviceName, def.name);
    const definition: ToolDefinition = {
      name,
      description:
        def.description?.trim() ||
        `Call ${def.name} on Unity Catalog MCP service ${serviceName}. Requires user approval.`,
      parameters: schemaToParameters(def.inputSchema),
    };

    return {
      definition,
      async execute(args: Record<string, unknown>, _ctx: HandoffTurnContext): Promise<string> {
        try {
          const result = await client.callTool(serviceName, def.name, args);
          if (result.isError) {
            return `${name} error: ${result.content[0]?.text ?? 'unknown error'}`;
          }
          const text = result.content
            .map((item) => item.text)
            .filter((t): t is string => typeof t === 'string' && t.length > 0)
            .join('\n');
          return text || JSON.stringify(result);
        } catch (err) {
          return `${name} error: ${err instanceof Error ? err.message : 'call failed'}`;
        }
      },
    };
  });
}

export interface BuildConnectedMcpToolsOptions extends McpClientConfig {
  maxPollSeconds?: number;
  pollIntervalMs?: number;
}

/**
 * Build RegisteredTools for every service connected for `userId`.
 * Genie keeps specialized polling tools; all other services use generic MCP wrappers.
 */
export async function buildConnectedMcpTools(
  discovery: McpDiscoveryService,
  userId: string,
  options: BuildConnectedMcpToolsOptions
): Promise<RegisteredTool[]> {
  const connected = await discovery.listConnectedServices(userId);
  if (connected.length === 0) {
    return [];
  }

  const client = new UnityGatewayMcpClient({
    host: options.host,
    getToken: options.getToken,
    workspaceId: options.workspaceId,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
  });

  const out: RegisteredTool[] = [];

  for (const service of connected) {
    if (service === DEFAULT_GENIE_SERVICE_NAME) {
      out.push(
        ...createSystemAiMcpTools({
          enabled: true,
          host: options.host,
          getToken: options.getToken,
          workspaceId: options.workspaceId,
          fetchImpl: options.fetchImpl,
          timeoutMs: options.timeoutMs,
          maxPollSeconds: options.maxPollSeconds,
          pollIntervalMs: options.pollIntervalMs,
          serviceName: service,
        })
      );
      continue;
    }

    try {
      const defs = await client.listTools(service);
      if (defs.length === 0) {
        continue;
      }
      out.push(...createGenericMcpTools(client, service, defs));
    } catch {
      // Skip unreachable services so one bad connector does not blank the rest.
    }
  }

  return out;
}
