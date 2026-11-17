import {
  AVAILABLE_DATABRICKS_MCPS,
  BUILTIN_PLUGIN_MCPS,
  DEFAULT_DATABRICKS_ORG_ID,
  DEFAULT_DATABRICKS_WORKSPACE_HOST,
  buildDatabricksMcpServiceUrl,
  type DatabricksMcpApp,
  type McpConnectorRecord,
  type McpConnectorStore,
  type McpSource,
} from '../../../shared/agents/mcp-types.js';
import { UnityGatewayMcpClient } from './mcp-client.js';
import { MemoryMcpConnectorStore } from './mcp-connector-memory-store.js';
import { normalizeHostUrl } from '../../chat/databricks-auth.js';

export interface McpDiscoveryConfig {
  host?: string;
  getToken?: () => Promise<string>;
  workspaceId?: string;
  fetchImpl?: typeof fetch;
  userSchemas?: string[];
  cacheTtlMs?: number;
  /** Per-user connector state; defaults to in-memory. */
  store?: McpConnectorStore;
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

function cleanServiceName(serviceName: string): string {
  return serviceName.trim().replace(/^\/+/, '');
}

export class McpDiscoveryService {
  /** Discovered catalog (UC + built-ins), shared by all users; per-user state is applied on read. */
  private cache: { timestamp: number; mcps: DatabricksMcpApp[] } | null = null;
  /** Services connected for every user unless that user disconnects them (env bootstrap). */
  private readonly defaultConnected = new Set<string>();
  private readonly store: McpConnectorStore;
  private readonly client: UnityGatewayMcpClient;
  private readonly config: McpDiscoveryConfig;

  constructor(config: McpDiscoveryConfig = {}) {
    this.config = config;
    this.store = config.store ?? new MemoryMcpConnectorStore();
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

  getClientConfig(): {
    host: string;
    getToken?: () => Promise<string>;
    workspaceId?: string;
    fetchImpl?: typeof fetch;
  } {
    return {
      host: this.config.host ?? DEFAULT_DATABRICKS_WORKSPACE_HOST,
      getToken: this.config.getToken,
      workspaceId: this.config.workspaceId ?? DEFAULT_DATABRICKS_ORG_ID,
      fetchImpl: this.config.fetchImpl,
    };
  }

  /** Services whose tools should be offered to this user's bot turns. */
  async listConnectedServices(userId: string): Promise<string[]> {
    const connected = this.connectedFrom(await this.store.listConnectors(userId));
    return [...connected].sort((a, b) => a.localeCompare(b));
  }

  async isConnected(userId: string, serviceName: string): Promise<boolean> {
    const clean = cleanServiceName(serviceName);
    const record = await this.store.getConnector(userId, clean);
    return record ? record.connected : this.defaultConnected.has(clean);
  }

  /**
   * Connect for every user without probing (env bootstrap / tests). A user can still
   * disconnect it for themselves. Prefer `connect()` for UI.
   */
  markDefaultConnected(serviceName: string): void {
    const clean = cleanServiceName(serviceName);
    if (!clean) return;
    this.defaultConnected.add(clean);
  }

  /**
   * Probe viability, then mark connected for this user so their bot turns get the tools.
   */
  async connect(userId: string, serviceName: string): Promise<DatabricksMcpApp> {
    const cleanService = cleanServiceName(serviceName);
    if (!cleanService) {
      throw new Error('MCP service name is required');
    }

    const probe = await this.probeService(cleanService);
    if (!probe.isViable) {
      throw new Error(
        `MCP service "${cleanService}" is not viable or not reachable: ${probe.error ?? 'unknown error'}`
      );
    }

    const existing = await this.store.getConnector(userId, cleanService);
    await this.store.upsertConnector({
      userId,
      service: cleanService,
      connected: true,
      custom: existing?.custom ?? false,
      name: existing?.name,
      description: existing?.description,
      tools: probe.tools,
    });

    return this.buildMcpAppFromService(
      cleanService,
      probe.tools,
      existing?.name,
      existing?.description,
      existing?.custom ? 'custom' : undefined,
      true
    );
  }

  /** Disconnect for this user only. Returns whether it was connected for them. */
  async disconnect(userId: string, serviceName: string): Promise<boolean> {
    const cleanService = cleanServiceName(serviceName);
    if (!(await this.isConnected(userId, cleanService))) {
      return false;
    }
    const existing = await this.store.getConnector(userId, cleanService);
    if (existing?.custom || this.defaultConnected.has(cleanService)) {
      await this.store.upsertConnector({
        userId,
        service: cleanService,
        connected: false,
        custom: existing?.custom ?? false,
        name: existing?.name,
        description: existing?.description,
        tools: existing?.tools ?? [],
      });
    } else {
      await this.store.deleteConnector(userId, cleanService);
    }
    return true;
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

  async registerCustomMcp(
    userId: string,
    serviceName: string,
    metadata?: Partial<DatabricksMcpApp>
  ): Promise<DatabricksMcpApp> {
    const cleanService = cleanServiceName(serviceName);
    if (!cleanService) {
      throw new Error('MCP service name is required');
    }

    const probe = await this.probeService(cleanService);
    if (!probe.isViable) {
      throw new Error(
        `MCP service "${cleanService}" is not viable or not reachable: ${probe.error ?? 'unknown error'}`
      );
    }

    // Registering a custom MCP also connects it so tools become available immediately.
    await this.store.upsertConnector({
      userId,
      service: cleanService,
      connected: true,
      custom: true,
      name: metadata?.name,
      description: metadata?.description,
      tools: probe.tools,
    });
    return this.buildMcpAppFromService(
      cleanService,
      probe.tools,
      metadata?.name,
      metadata?.description,
      'custom',
      true
    );
  }

  /** Remove this user's custom registration and connection. Other users are untouched. */
  async removeCustomMcp(userId: string, serviceName: string): Promise<boolean> {
    const cleanService = cleanServiceName(serviceName);
    const existing = await this.store.getConnector(userId, cleanService);
    const wasConnected = await this.isConnected(userId, cleanService);
    if (this.defaultConnected.has(cleanService)) {
      if (existing || wasConnected) {
        await this.store.upsertConnector({
          userId,
          service: cleanService,
          connected: false,
          custom: false,
          tools: [],
        });
      }
    } else {
      await this.store.deleteConnector(userId, cleanService);
    }
    return Boolean(existing?.custom) || wasConnected;
  }

  private connectedFrom(records: McpConnectorRecord[]): Set<string> {
    const connected = new Set(this.defaultConnected);
    for (const record of records) {
      if (record.connected) {
        connected.add(record.service);
      } else {
        connected.delete(record.service);
      }
    }
    return connected;
  }

  private async fetchUnityCatalogMcpServices(schema: string): Promise<UnityCatalogMcpServiceItem[]> {
    if (!this.config.host?.trim() || !this.config.getToken) {
      return [];
    }
    const host = normalizeHostUrl(this.config.host);

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
    forcedSource?: McpSource,
    connected = false
  ): DatabricksMcpApp {
    const known =
      AVAILABLE_DATABRICKS_MCPS.find((item) => item.service === service) ??
      BUILTIN_PLUGIN_MCPS.find((item) => item.service === service);
    const parts = service.split('.');
    const catalog = parts.length > 2 ? parts[0] : undefined;
    const schema = parts.length > 2 ? parts[1] : undefined;
    const shortName = parts[parts.length - 1] ?? service;
    const source: McpSource =
      forcedSource ?? (service.startsWith('system.ai') || service.startsWith('plugin.') ? 'system' : 'user');

    if (known) {
      return {
        ...known,
        tools: tools.length > 0 ? tools : known.tools,
        isViable: true,
        status: 'active',
        source,
        connected,
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
      connected,
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

  /**
   * Viable connectors with `connected` resolved for `userId` (plus that user's custom MCPs).
   * Without `userId`, only the shared catalog with env defaults is returned.
   */
  async listViableMcps(options?: { refresh?: boolean; userId?: string }): Promise<DatabricksMcpApp[]> {
    const catalog = await this.listCatalog(options?.refresh === true);
    const records = options?.userId ? await this.store.listConnectors(options.userId) : [];
    const connected = this.connectedFrom(records);

    const byService = new Map<string, DatabricksMcpApp>();
    for (const app of catalog) {
      byService.set(app.service, app);
    }
    for (const record of records.filter((item) => item.custom)) {
      byService.set(
        record.service,
        this.buildMcpAppFromService(record.service, record.tools, record.name, record.description, 'custom')
      );
    }
    return [...byService.values()].map((app) => ({ ...app, connected: connected.has(app.service) }));
  }

  private async listCatalog(refresh: boolean): Promise<DatabricksMcpApp[]> {
    const now = Date.now();
    if (!refresh && this.cache && now - this.cache.timestamp < this.getCacheTtlMs()) {
      return this.cache.mcps;
    }

    if (!this.config.host || !this.config.getToken) {
      const viable = [...AVAILABLE_DATABRICKS_MCPS, ...BUILTIN_PLUGIN_MCPS].filter((app) => app.isViable);
      this.cache = { timestamp: now, mcps: viable };
      return viable;
    }

    const schemas = [...new Set([...DEFAULT_SCHEMAS, ...(this.config.userSchemas ?? [])])];

    const discoveredCandidates = new Map<string, { name?: string; description?: string }>();

    const itemsBySchema = await Promise.all(schemas.map((schema) => this.fetchUnityCatalogMcpServices(schema)));
    for (const [index, items] of itemsBySchema.entries()) {
      const schema = schemas[index];
      for (const item of items) {
        const fullService = item.full_name || `${schema}.${item.name}`;
        discoveredCandidates.set(fullService, {
          name: item.name,
          description: item.comment || item.description,
        });
      }
    }

    for (const app of [...AVAILABLE_DATABRICKS_MCPS, ...BUILTIN_PLUGIN_MCPS]) {
      if (!discoveredCandidates.has(app.service)) {
        discoveredCandidates.set(app.service, {
          name: app.name,
          description: app.description,
        });
      }
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
