import { createApp, lakebase, server } from '@databricks/appkit';
import type { ChatStore } from '../shared/chat/types.js';
import type { CompactionStore, IdempotencyStore } from '../shared/durable/types.js';
import type { MemorySkillStore } from '../shared/agents/memory/types.js';
import type { RoutineStore } from '../shared/routines/types.js';
import type { SandboxStore } from '../shared/sandbox/types.js';
import { ApprovalStore } from './chat/approvals.js';
import { LakebaseChatStore, type LakebaseQuery } from './chat/lakebase-store.js';
import { MemoryChatStore } from './chat/memory-store.js';
import { registerChatRoutes } from './chat/routes.js';
import { ChatService } from './chat/service.js';
import { LakebaseCompactionStore, MemoryCompactionStore } from './durable/compaction-store.js';
import { LakebaseIdempotencyStore, MemoryIdempotencyStore } from './durable/idempotency-store.js';
import { createChatClientFromEnv } from './agents/clients/create-chat-client.js';
import { sqlQueryConfigFromEnv } from './agents/tools/sql-query.js';
import { systemAiMcpConfigFromEnv } from './agents/tools/system-ai-mcp.js';
import { McpDiscoveryService } from './agents/tools/mcp-discovery.js';
import { parseAllowlist } from './agents/tools/web-fetch.js';
import { LakebaseMemorySkillStore } from './agents/memory/lakebase-store.js';
import { MemoryMemorySkillStore } from './agents/memory/memory-store.js';
import { registerMemoryRoutes } from './agents/memory/routes.js';
import { LakebaseRoutineStore } from './routines/lakebase-store.js';
import { MemoryRoutineStore } from './routines/memory-store.js';
import { registerRoutineRoutes } from './routines/routes.js';
import { RoutineService } from './routines/service.js';
import { LakebaseSandboxStore } from './sandbox/lakebase-store.js';
import { MemorySandboxStore } from './sandbox/memory-store.js';
import { SandboxReaper } from './sandbox/reaper.js';
import { createSandboxRegistryFromEnv } from './sandbox/registry.js';
import { SandboxSessionService } from './sandbox/session-service.js';

function lakebaseConfigured(): boolean {
  return Boolean(process.env.LAKEBASE_ENDPOINT || process.env.PGHOST);
}

async function createStores(query?: LakebaseQuery): Promise<{
  chats: ChatStore;
  routines: RoutineStore;
  memory: MemorySkillStore;
  compaction: CompactionStore;
  idempotency: IdempotencyStore;
  approvals: ApprovalStore;
  sandbox: SandboxStore;
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
      approvals: new ApprovalStore(query),
      sandbox: new LakebaseSandboxStore(query),
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
    approvals: new ApprovalStore(),
    sandbox: new MemorySandboxStore(),
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
    const { chats, routines, memory, compaction, idempotency, approvals, sandbox } =
      await createStores(query);
    const client = createChatClientFromEnv(process.env);
    console.info(`[bricksbot] ChatClient provider=${client.provider}`);
    const sqlQuery = sqlQueryConfigFromEnv(process.env);
    if (sqlQuery.warehouseId) {
      console.info(`[bricksbot] SQL warehouse configured (id=${sqlQuery.warehouseId.slice(0, 8)}…); lakehouse tools prefer user OBO token`);
    } else {
      console.warn(
        '[bricksbot] DATABRICKS_WAREHOUSE_ID not set — sql_query / lakehouse_catalog will ask for a warehouse. Bind sql-warehouse in databricks.yml or set the env var.',
      );
    }
    const { config: sandboxConfig, registry: sandboxRegistry } = createSandboxRegistryFromEnv(
      process.env,
      { getDatabricksToken: sqlQuery.getToken },
    );
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
    const systemAiMcp = systemAiMcpConfigFromEnv(process.env);
    if (systemAiMcp) {
      if (!systemAiMcp.getToken && sqlQuery.getToken) {
        systemAiMcp.getToken = sqlQuery.getToken;
      }
      if (!systemAiMcp.host && sqlQuery.host) {
        systemAiMcp.host = sqlQuery.host;
      }
    }
    const chatService = new ChatService({
      store: chats,
      client,
      memory,
      routines,
      compaction,
      idempotency,
      approvals,
      webFetchAllowlist: parseAllowlist(process.env.WEB_FETCH_ALLOWLIST),
      sqlQuery,
      sandbox: sandboxService,
      systemAiMcp,
    });
    const mcpDiscovery = new McpDiscoveryService({
      host: systemAiMcp?.host || sqlQuery.host,
      getToken: systemAiMcp?.getToken || sqlQuery.getToken,
      workspaceId: systemAiMcp?.workspaceId,
      userSchemas: process.env.DATABRICKS_MCP_SCHEMAS
        ? process.env.DATABRICKS_MCP_SCHEMAS.split(',').map((s) => s.trim())
        : undefined,
    });
    const routineService = new RoutineService(routines, chats, chatService);
    appkit.server.extend((app) => {
      registerChatRoutes(app, chats, chatService, { mcpDiscovery });
      registerMemoryRoutes(app, chats, memory);
      registerRoutineRoutes(app, routines, routineService, {
        provider: client.provider,
        chats,
      });
    });
  },
}).catch(console.error);
