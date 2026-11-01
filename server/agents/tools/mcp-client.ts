import type {
  McpClientConfig,
  McpJsonRpcRequest,
  McpJsonRpcResponse,
  McpToolCallResult,
  McpToolDefinition,
} from '../../../shared/agents/mcp-types.js';

export class UnityGatewayMcpClient {
  private requestId = 0;
  private readonly config: McpClientConfig;

  constructor(config: McpClientConfig) {
    this.config = config;
  }

  private getUrl(serviceName: string): string {
    let host = this.config.host.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(host)) {
      host = `https://${host}`;
    }
    const cleanService = serviceName.trim().replace(/^\/+/, '');
    const base = `${host}/ai-gateway/mcp-services/${cleanService}`;
    if (this.config.workspaceId) {
      const sp = new URLSearchParams({ o: this.config.workspaceId });
      return `${base}?${sp.toString()}`;
    }
    return base;
  }

  private async fetchRpc<T>(
    serviceName: string,
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    const url = this.getUrl(serviceName);
    const id = ++this.requestId;
    const body: McpJsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.config.getToken) {
      const token = await this.config.getToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    }

    const fetchImpl = this.config.fetchImpl ?? globalThis.fetch;
    const timeoutMs = this.config.timeoutMs ?? 30_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const message = err instanceof Error ? err.message : 'Network request failed';
      throw new Error(`Unity Gateway MCP request failed: ${message}`);
    } finally {
      clearTimeout(timer);
    }

    const rawText = await res.text();
    if (!res.ok) {
      throw new Error(`Unity Gateway MCP error (${res.status}): ${rawText}`);
    }

    let parsed: McpJsonRpcResponse<T>;
    try {
      parsed = JSON.parse(rawText) as McpJsonRpcResponse<T>;
    } catch {
      throw new Error(`Unity Gateway MCP returned invalid JSON: ${rawText}`);
    }

    if (parsed.error) {
      throw new Error(
        `Unity Gateway MCP RPC error (${parsed.error.code}): ${parsed.error.message}`,
      );
    }

    if (parsed.result === undefined) {
      throw new Error('Unity Gateway MCP response missing result');
    }

    return parsed.result;
  }

  async listTools(serviceName: string): Promise<McpToolDefinition[]> {
    const result = await this.fetchRpc<{ tools?: McpToolDefinition[] }>(
      serviceName,
      'tools/list',
      {},
    );
    return result.tools ?? [];
  }

  async callTool(
    serviceName: string,
    toolName: string,
    args: Record<string, unknown> = {},
  ): Promise<McpToolCallResult> {
    return this.fetchRpc<McpToolCallResult>(serviceName, 'tools/call', {
      name: toolName,
      arguments: args,
    });
  }
}
