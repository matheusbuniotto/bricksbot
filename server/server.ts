import { createApp, lakebase, server } from '@databricks/appkit';
import type { ChatStore } from '../shared/chat/types.js';
import type { CompactionStore, IdempotencyStore } from '../shared/durable/types.js';
import type { RunStore } from '../shared/runs/types.js';
import type { MemorySkillStore } from '../shared/agents/memory/types.js';
import type { RoutineStore } from '../shared/routines/types.js';
import type { VolumeUsageStore } from '../shared/agents/volume-namespace.js';
import type { SandboxStore } from '../shared/sandbox/types.js';
import type { PluginRegistryStore } from '../shared/plugins/types.js';
import type { McpConnectorStore } from '../shared/agents/mcp-types.js';
import { PluginHost } from './plugins/host/plugin-host.js';
import { VolumePluginLoader } from './plugins/loaders/volume-loader.js';
import { LakebasePluginRegistryStore } from './plugins/registry/lakebase-store.js';
import { MemoryPluginRegistryStore } from './plugins/registry/memory-store.js';
import { registerPluginRoutes } from './plugins/routes.js';
import { ApprovalStore } from './chat/approvals.js';
import { LakebaseChatStore, type LakebaseQuery } from './chat/lakebase-store.js';
import { MemoryChatStore } from './chat/memory-store.js';
import { registerChatRoutes } from './chat/routes.js';
import { diagRoutesEnabled, registerDiagRoutes } from './diag/routes.js';
import { interactiveSpFallbackAllowed } from './chat/databricks-auth.js';
import { ChatService } from './chat/service.js';
import { LakebaseCompactionStore, MemoryCompactionStore } from './durable/compaction-store.js';
import { LakebaseIdempotencyStore, MemoryIdempotencyStore } from './durable/idempotency-store.js';
import { createChatClientFromEnv } from './agents/clients/create-chat-client.js';
import { parseVolumeQuotaLimits, resolveVolumeRoot } from './agents/tools/volume-namespace.js';
import { sqlQueryConfigFromEnv } from './agents/tools/sql-query.js';
import { genieSpaceConfigFromEnv } from './agents/tools/genie-space.js';
import { DEFAULT_GENIE_SERVICE_NAME, systemAiMcpConfigFromEnv } from './agents/tools/system-ai-mcp.js';
import { LakebaseMcpConnectorStore } from './agents/tools/mcp-connector-lakebase-store.js';
import { MemoryMcpConnectorStore } from './agents/tools/mcp-connector-memory-store.js';
import { McpDiscoveryService } from './agents/tools/mcp-discovery.js';
import { buildConnectedMcpTools } from './agents/tools/mcp-tools.js';
import { parseAllowlist } from './agents/tools/web-fetch.js';
import { LakebaseMemorySkillStore } from './agents/memory/lakebase-store.js';
import { MemoryMemorySkillStore } from './agents/memory/memory-store.js';
import { registerMemoryRoutes } from './agents/memory/routes.js';
import { LakebaseRoutineStore } from './routines/lakebase-store.js';
import { MemoryRoutineStore } from './routines/memory-store.js';
import { registerRoutineRoutes } from './routines/routes.js';
import { RoutineService } from './routines/service.js';
import { initTracing } from './observability/tracing.js';
import { LakebaseRunStore } from './runs/lakebase-store.js';
import { MemoryRunStore } from './runs/memory-store.js';
import { LakebaseSandboxStore } from './sandbox/lakebase-store.js';
import { MemorySandboxStore } from './sandbox/memory-store.js';
import { SandboxReaper } from './sandbox/reaper.js';
import { createSandboxRegistryFromEnv } from './sandbox/registry.js';
import { SandboxSessionService } from './sandbox/session-service.js';
import { LakebaseVolumeUsageStore, MemoryVolumeUsageStore } from './volumes/usage-store.js';

function lakebaseConfigured(): boolean {
  return Boolean(process.env.LAKEBASE_ENDPOINT || process.env.PGHOST);
}

async function createStores(query?: LakebaseQuery): Promise<{
  chats: ChatStore;
  routines: RoutineStore;
  memory: MemorySkillStore;
  compaction: CompactionStore;
  idempotency: IdempotencyStore;
  runs: RunStore;
  approvals: ApprovalStore;
  sandbox: SandboxStore;
  volumeUsage: VolumeUsageStore;
  plugins: PluginRegistryStore;
  mcpConnectors: McpConnectorStore;
}> {
  const ownerId = process.env.BRICKSBOT_USER_ID?.trim() || 'workspace-user';
  if (lakebaseConfigured() && query) {
    const chats = new LakebaseChatStore(query);
    await chats.initSchema();
    await chats.ensureBootstrap(ownerId);
    return {
      chats,
      routines: new LakebaseRoutineStore(query),
      memory: new LakebaseMemorySkillStore(query),
      compaction: new LakebaseCompactionStore(query),
      idempotency: new LakebaseIdempotencyStore(query),
      runs: new LakebaseRunStore(query),
      approvals: new ApprovalStore(query),
      sandbox: new LakebaseSandboxStore(query),
      volumeUsage: new LakebaseVolumeUsageStore(query),
      plugins: new LakebasePluginRegistryStore(query),
      mcpConnectors: new LakebaseMcpConnectorStore(query),
    };
  }

  console.warn('[bricksbot] Lakebase not configured — using in-memory stores (state will not survive restart)');
  const chats = new MemoryChatStore();
  await chats.ensureBootstrap(ownerId);
  return {
    chats,
    routines: new MemoryRoutineStore(),
    memory: new MemoryMemorySkillStore(),
    compaction: new MemoryCompactionStore(),
    idempotency: new MemoryIdempotencyStore(),
    runs: new MemoryRunStore(),
    approvals: new ApprovalStore(),
    sandbox: new MemorySandboxStore(),
    volumeUsage: new MemoryVolumeUsageStore(),
    plugins: new MemoryPluginRegistryStore(),
    mcpConnectors: new MemoryMcpConnectorStore(),
  };
}

const plugins = lakebaseConfigured() ? [server(), lakebase()] : [server()];

createApp({
  plugins,
  async onPluginsReady(appkit) {
    const query =
      'lakebase' in appkit && appkit.lakebase
        ? (sql: string, params?: unknown[]) => appkit.lakebase.query(sql, params)
        : undefined;
    const {
      chats,
      routines,
      memory,
      compaction,
      idempotency,
      runs,
      approvals,
      sandbox,
      volumeUsage,
      plugins: pluginRegistry,
      mcpConnectors,
    } = await createStores(query);
    const volumeRoot = resolveVolumeRoot(process.env);
    const client = createChatClientFromEnv(process.env);
    console.info(`[bricksbot] ChatClient provider=${client.provider}`);
    await initTracing(process.env);
    const sqlQuery = sqlQueryConfigFromEnv(process.env);
    if (sqlQuery.warehouseId) {
      console.info(
        `[bricksbot] SQL warehouse configured (id=${sqlQuery.warehouseId.slice(0, 8)}…); lakehouse tools prefer user OBO token`
      );
    } else {
      console.warn(
        '[bricksbot] DATABRICKS_WAREHOUSE_ID not set — sql_query / lakehouse_catalog will ask for a warehouse. Bind sql-warehouse in databricks.yml or set the env var.'
      );
    }
    if (interactiveSpFallbackAllowed()) {
      console.warn(
        '[bricksbot] BRICKSBOT_INTERACTIVE_SP_FALLBACK=allow: chats without a user token query data as the App service principal'
      );
    }
    const { config: sandboxConfig, registry: sandboxRegistry } = createSandboxRegistryFromEnv(process.env, {
      getDatabricksToken: sqlQuery.getToken,
    });
    const sandboxService = new SandboxSessionService({
      store: sandbox,
      registry: sandboxRegistry,
      config: sandboxConfig,
    });
    if (sandboxService.isEnabled()) {
      console.info(`[bricksbot] Sandbox backend=${sandboxConfig.backend}`);
      const reaper = new SandboxReaper({ sessionService: sandboxService });
      await reaper.reconcileAtStartup();
      reaper.start();
    }
    const genieSpace = genieSpaceConfigFromEnv(process.env, sqlQuery);
    if (genieSpace) {
      console.info(
        `[bricksbot] Genie space configured (id=${genieSpace.spaceId.slice(0, 8)}…); ask_genie_space is Ask-first`
      );
    }
    const systemAiMcp = systemAiMcpConfigFromEnv(process.env);
    if (systemAiMcp) {
      if (!systemAiMcp.getToken && sqlQuery.getToken) {
        systemAiMcp.getToken = sqlQuery.getToken;
      }
      if (!systemAiMcp.host && sqlQuery.host) {
        systemAiMcp.host = sqlQuery.host;
      }
    }
    const mcpDiscovery = new McpDiscoveryService({
      host: systemAiMcp?.host || sqlQuery.host,
      getToken: systemAiMcp?.getToken || sqlQuery.getToken,
      workspaceId: systemAiMcp?.workspaceId,
      userSchemas: process.env.DATABRICKS_MCP_SCHEMAS
        ? process.env.DATABRICKS_MCP_SCHEMAS.split(',').map((s) => s.trim())
        : undefined,
      store: mcpConnectors,
    });
    // Env opt-in Genie: connected by default for every user (each user may disconnect it
    // for themselves). Connectors dialog is the path for additional system.ai / custom MCPs.
    if (systemAiMcp) {
      mcpDiscovery.markDefaultConnected(systemAiMcp.serviceName ?? DEFAULT_GENIE_SERVICE_NAME);
    }
    const pluginHost = new PluginHost({
      host: sqlQuery.host,
    });
    const volumePluginLoader = new VolumePluginLoader({
      volumeRoot: process.env.BRICKSBOT_PLUGIN_VOLUME,
      host: pluginHost,
    });
    try {
      const loaded = await volumePluginLoader.loadAll();
      if (loaded.loaded.length > 0) {
        console.info(`[bricksbot] Loaded plugins: ${loaded.loaded.map((p) => p.name).join(', ')}`);
      }
      if (loaded.errors.length > 0) {
        console.warn(
          `[bricksbot] Plugin loading errors: ${loaded.errors.map((e) => `${String(e.pluginName)}: ${String(e.error)}`).join('; ')}`
        );
      }
    } catch (err) {
      console.warn(`[bricksbot] Volume plugin loader failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    const chatService = new ChatService({
      store: chats,
      client,
      memory,
      routines,
      compaction,
      idempotency,
      runs,
      approvals,
      pluginHost,
      webFetchAllowlist: parseAllowlist(process.env.WEB_FETCH_ALLOWLIST),
      sqlQuery,
      genieSpace,
      sandbox: sandboxService,
      resolveMcpTools: (userId) =>
        buildConnectedMcpTools(mcpDiscovery, userId, {
          ...mcpDiscovery.getClientConfig(),
          maxPollSeconds: systemAiMcp?.maxPollSeconds,
          pollIntervalMs: systemAiMcp?.pollIntervalMs,
        }),
      volumeWrite: volumeRoot
        ? {
            root: volumeRoot,
            host: sqlQuery.host,
            getToken: sqlQuery.getToken,
            usage: volumeUsage,
            limits: parseVolumeQuotaLimits(process.env),
          }
        : undefined,
    });
    // A run whose server died stays "running" until its lease lapses; this fails it and tidies the transcript.
    const sweepRuns = () =>
      chatService.sweepInterruptedRuns().catch((err) => console.warn('[bricksbot] Run sweep failed', err));
    setInterval(() => void sweepRuns(), 30_000).unref();
    const routineService = new RoutineService(routines, chats, chatService);
    appkit.server.extend((app) => {
      registerChatRoutes(app, chats, chatService, { mcpDiscovery });
      registerMemoryRoutes(app, chats, memory);
      if (diagRoutesEnabled()) {
        console.warn('[bricksbot] BRICKSBOT_DIAG=1: /api/_diag/* gateway probes are enabled');
        registerDiagRoutes(app);
      }
      registerRoutineRoutes(app, routines, routineService, {
        provider: client.provider,
        chats,
      });
      registerPluginRoutes(app, {
        pluginHost,
        volumeLoader: volumePluginLoader,
        registryStore: pluginRegistry,
      });
    });
  },
}).catch(console.error);
