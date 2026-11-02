import {
  AVAILABLE_DATABRICKS_MCPS,
  DEFAULT_DATABRICKS_ORG_ID,
  DEFAULT_DATABRICKS_WORKSPACE_HOST,
  buildDatabricksMcpServiceUrl,
  type DatabricksMcpApp,
  type McpSource,
} from '../../../shared/agents/mcp-types.js';
import { UnityGatewayMcpClient } from './mcp-client.js';

export interface McpDiscoveryConfig {
  host?: string;
  getToken?: () => Promise<string>;
  workspaceId?: string;
  fetchImpl?: typeof fetch;
  userSchemas?: string[];
  cacheTtlMs?: number;
}

export interface UnityCatalogMcpServiceItem {
  name: string;
  full_name?: string;
  comment?: string;
  description?: string;
}

interface UnityCatalogListResponse {
  mcp_services?: UnityCatalogMcpServiceItem[];
  next_page_token?: string;
}

const DEFAULT_CACHE_TTL_MS = 60_000;
const DEFAULT_SCHEMAS = ['system.ai', 'main.default'];

export class McpDiscoveryService {
  private cache: { timestamp: number; mcps: DatabricksMcpApp[] } | null = null;
  private customServices: Map<string, Partial<DatabricksMcpApp>> = new Map();
  private readonly client: UnityGatewayMcpClient;
  private readonly config: McpDiscoveryConfig;

  constructor(config: McpDiscoveryConfig = {}) {
    this.config = config;
    this.client = new UnityGatewayMcpClient({
      host: config.host ?? DEFAULT_DATABRICKS_WORKSPACE_HOST,
      getToken: config.getToken,
      workspaceId: config.workspaceId ?? DEFAULT_DATABRICKS_ORG_ID,
      fetchImpl: config.fetchImpl,
    });
  }

  getCacheTtlMs(): number {
    return this.config.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  }

  clearCache(): void {
    this.cache = null;
  }

  async probeService(service: string): Promise<{ isViable: boolean; tools: string[]; error?: string }> {
    try {
      const toolDefs = await this.client.listTools(service);
      if (Array.isArray(toolDefs) && toolDefs.length > 0) {
        return {
          isViable: true,
          tools: toolDefs.map((t) => t.name),
        };
      }
      return { isViable: false, tools: [], error: 'Service returned no tools' };
    } catch (err) {
      return {
        isViable: false,
        tools: [],
        error: err instanceof Error ? err.message : 'Probe failed',
      };
    }
  }

  async registerCustomMcp(serviceName: string, metadata?: Partial<DatabricksMcpApp>): Promise<DatabricksMcpApp> {
    const cleanService = serviceName.trim().replace(/^\/+/, '');
    if (!cleanService) {
      throw new Error('MCP service name is required');
    }

    const probe = await this.probeService(cleanService);
    if (!probe.isViable) {
      throw new Error(
        `MCP service "${cleanService}" is not viable or not reachable: ${probe.error ?? 'unknown error'}`
      );
    }

    const app = this.buildMcpAppFromService(cleanService, probe.tools, metadata?.name, metadata?.description, 'custom');

    this.customServices.set(cleanService, app);
    this.clearCache();
    return app;
  }

  removeCustomMcp(serviceName: string): boolean {
    const cleanService = serviceName.trim().replace(/^\/+/, '');
    const removed = this.customServices.delete(cleanService);
    if (removed) {
      this.clearCache();
    }
    return removed;
  }

  private async fetchUnityCatalogMcpServices(schema: string): Promise<UnityCatalogMcpServiceItem[]> {
    const rawHost = (this.config.host ?? '').trim().replace(/\/+$/, '');
    const host = /^https?:\/\//i.test(rawHost) ? rawHost : `https://${rawHost}`;
    if (!rawHost || !this.config.getToken) {
      return [];
    }

    const token = await this.config.getToken();
    if (!token) {
      return [];
    }

    const fetchImpl = this.config.fetchImpl ?? globalThis.fetch;
    const url = `${host}/api/2.1/unity-catalog/mcp-services?parent=schemas/${encodeURIComponent(schema)}&view=FULL`;

    try {
      const res = await fetchImpl(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });

      if (!res.ok) {
        return [];
      }

      const data = (await res.json()) as UnityCatalogListResponse;
      return data.mcp_services ?? [];
    } catch {
      return [];
    }
  }

  private buildMcpAppFromService(
    service: string,
    tools: string[],
    customName?: string,
    customDescription?: string,
    forcedSource?: McpSource
  ): DatabricksMcpApp {
    const known = AVAILABLE_DATABRICKS_MCPS.find((item) => item.service === service);
    const parts = service.split('.');
    const catalog = parts.length > 2 ? parts[0] : undefined;
    const schema = parts.length > 2 ? parts[1] : undefined;
    const shortName = parts[parts.length - 1] ?? service;
    const source: McpSource = forcedSource ?? (service.startsWith('system.ai') ? 'system' : 'user');

    if (known) {
      return {
        ...known,
        tools: tools.length > 0 ? tools : known.tools,
        isViable: true,
        status: 'active',
        source,
      };
    }

    const displayName =
      customName ||
      shortName
        .split(/[_-]/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');

    const description = customDescription || `Unity Catalog MCP service: ${service}`;

    return {
      id: service.replace(/[^a-zA-Z0-9_-]/g, '-'),
      name: displayName,
      service,
      catalog,
      schema,
      source,
      category: source === 'system' ? 'lakehouse' : 'custom',
      categoryLabel: source === 'system' ? 'System' : 'Custom MCP',
      description,
      tools,
      status: 'active',
      isViable: true,
      recommended: false,
      connectUrl: buildDatabricksMcpServiceUrl(service, {
        host: this.config.host,
        orgId: this.config.workspaceId,
      }),
      iconBg: source === 'system' ? '#1b1b1d' : '#047857',
      iconColor: '#ffffff',
      iconType: 'custom',
    };
  }

  async listViableMcps(options?: { refresh?: boolean }): Promise<DatabricksMcpApp[]> {
    const now = Date.now();
    if (!options?.refresh && this.cache && now - this.cache.timestamp < this.getCacheTtlMs()) {
      return this.cache.mcps;
    }

    if (!this.config.host || !this.config.getToken) {
      const viable = AVAILABLE_DATABRICKS_MCPS.filter((app) => app.isViable);
      const custom = Array.from(this.customServices.values()) as DatabricksMcpApp[];
      const combined = [...viable, ...custom];
      this.cache = { timestamp: now, mcps: combined };
      return combined;
    }

    const schemas = [...new Set([...DEFAULT_SCHEMAS, ...(this.config.userSchemas ?? [])])];

    const discoveredCandidates = new Map<string, { name?: string; description?: string }>();

    for (const schema of schemas) {
      const items = await this.fetchUnityCatalogMcpServices(schema);
      for (const item of items) {
        const fullService = item.full_name || `${schema}.${item.name}`;
        discoveredCandidates.set(fullService, {
          name: item.name,
          description: item.comment || item.description,
        });
      }
    }

    for (const app of AVAILABLE_DATABRICKS_MCPS) {
      if (!discoveredCandidates.has(app.service)) {
        discoveredCandidates.set(app.service, {
          name: app.name,
          description: app.description,
        });
      }
    }

    for (const [service, meta] of this.customServices) {
      discoveredCandidates.set(service, {
        name: meta.name,
        description: meta.description,
      });
    }

    const probeEntries = Array.from(discoveredCandidates.entries());
    const probeResults = await Promise.all(
      probeEntries.map(async ([service, meta]) => {
        const probe = await this.probeService(service);
        return { service, meta, probe };
      })
    );

    const viableMcps: DatabricksMcpApp[] = [];

    for (const { service, meta, probe } of probeResults) {
      if (probe.isViable) {
        const app = this.buildMcpAppFromService(service, probe.tools, meta.name, meta.description);
        viableMcps.push(app);
      }
    }

    this.cache = { timestamp: now, mcps: viableMcps };
    return viableMcps;
  }
}
