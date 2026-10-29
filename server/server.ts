import { createApp, lakebase, server } from '@databricks/appkit';
import type { ChatStore } from '../shared/chat/types.js';
import type { MemorySkillStore } from '../shared/memory/types.js';
import type { RoutineStore } from '../shared/routines/types.js';
import { LakebaseChatStore, type LakebaseQuery } from './chat/lakebase-store.js';
import { MemoryChatStore } from './chat/memory-store.js';
import { registerChatRoutes } from './chat/routes.js';
import { ChatService } from './chat/service.js';
import { createChatClientFromEnv } from './llm/create-chat-client.js';
import { sqlQueryConfigFromEnv } from './llm/tools/sql-query.js';
import { parseAllowlist } from './llm/tools/web-fetch.js';
import { LakebaseMemorySkillStore } from './memory/lakebase-store.js';
import { MemoryMemorySkillStore } from './memory/memory-store.js';
import { registerMemoryRoutes } from './memory/routes.js';
import { LakebaseRoutineStore } from './routines/lakebase-store.js';
import { MemoryRoutineStore } from './routines/memory-store.js';
import { registerRoutineRoutes } from './routines/routes.js';
import { RoutineService } from './routines/service.js';

function lakebaseConfigured(): boolean {
  return Boolean(process.env.LAKEBASE_ENDPOINT || process.env.PGHOST);
}

async function createStores(query?: LakebaseQuery): Promise<{
  chats: ChatStore;
  routines: RoutineStore;
  memory: MemorySkillStore;
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
    };
  }

  console.warn('[bricksbot] Lakebase not configured — using in-memory stores (state will not survive restart)');
  const chats = new MemoryChatStore();
  await chats.ensureBootstrap(ownerId);
  return { chats, routines: new MemoryRoutineStore(), memory: new MemoryMemorySkillStore() };
}

const plugins = lakebaseConfigured() ? [server(), lakebase()] : [server()];

createApp({
  plugins,
  async onPluginsReady(appkit) {
    const query =
      'lakebase' in appkit && appkit.lakebase
        ? (sql: string, params?: unknown[]) => appkit.lakebase.query(sql, params)
        : undefined;
    const { chats, routines, memory } = await createStores(query);
    const client = createChatClientFromEnv(process.env);
    console.info(`[bricksbot] ChatClient provider=${client.provider}`);
    const chatService = new ChatService({
      store: chats,
      client,
      memory,
      webFetchAllowlist: parseAllowlist(process.env.WEB_FETCH_ALLOWLIST),
      sqlQuery: sqlQueryConfigFromEnv(process.env),
    });
    const routineService = new RoutineService(routines, chats, chatService);
    appkit.server.extend((app) => {
      registerChatRoutes(app, chats, chatService);
      registerMemoryRoutes(app, chats, memory);
      registerRoutineRoutes(app, routines, routineService, {
        provider: client.provider,
        chats,
      });
    });
  },
}).catch(console.error);
