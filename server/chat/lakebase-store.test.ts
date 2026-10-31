import { beforeEach, describe, expect, test } from 'vitest';
import { LakebaseChatStore, type LakebaseQuery } from './lakebase-store.js';

type Row = Record<string, unknown>;

function createFakeLakebase(): { query: LakebaseQuery; reset: () => void } {
  const spaces = new Map<string, Row>();
  const members: Row[] = [];
  const bots = new Map<string, Row>();
  const chats = new Map<string, Row>();
  const messages: Row[] = [];

  const query: LakebaseQuery = async (sql, params = []) => {
    const normalized = sql.replace(/\s+/g, ' ').trim();

    if (
      normalized.startsWith('CREATE ') ||
      normalized.startsWith('ALTER TABLE') ||
      normalized.startsWith('DROP INDEX')
    ) {
      return { rows: [] };
    }

    if (normalized.includes('FROM bricksbot.spaces') && normalized.includes('name =')) {
      const [ownerId, name] = params.map(String);
      const row = [...spaces.values()].find((s) => s.owner_id === ownerId && s.name === name);
      return { rows: row ? [row] : [] };
    }

    if (normalized.startsWith('INSERT INTO bricksbot.spaces')) {
      const [id, name, owner_id] = params.map(String);
      const row = { id, name, owner_id, created_at: new Date().toISOString() };
      spaces.set(id, row);
      return { rows: [row] };
    }

    if (normalized.startsWith('INSERT INTO bricksbot.space_members')) {
      const [space_id, user_id, role] = params.map(String);
      const existing = members.find((m) => m.space_id === space_id && m.user_id === user_id);
      if (existing) {
        existing.role = role;
        return { rows: [existing] };
      }
      const row = { space_id, user_id, role };
      members.push(row);
      return { rows: [row] };
    }

    if (normalized.includes('FROM bricksbot.bots') && normalized.includes('is_shared = TRUE')) {
      const rows = [...bots.values()]
        .filter((b) => b.is_shared === true && !b.is_primary && b.archived_at == null)
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      return { rows };
    }

    if (normalized.includes('FROM bricksbot.bots') && normalized.includes('is_primary = TRUE')) {
      const ownerId = String(params[0]);
      const row = [...bots.values()].find((b) => b.owner_id === ownerId && b.is_primary);
      return { rows: row ? [row] : [] };
    }

    if (normalized.includes('FROM bricksbot.bots') && normalized.includes('ORDER BY is_primary')) {
      let rows = [...bots.values()];
      if (normalized.includes('archived_at IS NULL')) {
        rows = rows.filter((b) => b.archived_at == null);
      } else if (normalized.includes('archived_at IS NOT NULL')) {
        rows = rows.filter((b) => b.archived_at != null);
      }
      const hasSpaceFilter = normalized.includes('space_id IS NOT DISTINCT FROM');
      if (hasSpaceFilter) {
        rows = rows.filter((b) => b.space_id === params[0]);
      }
      if (normalized.includes('EXISTS (SELECT 1 FROM bricksbot.spaces')) {
        const viewerId = String(hasSpaceFilter ? params[1] : params[0]);
        const accessibleSpaceIds = new Set(
          [...spaces.values()]
            .filter(
              (s) =>
                s.owner_id === viewerId ||
                members.some((m) => m.space_id === s.id && m.user_id === viewerId),
            )
            .map((s) => String(s.id)),
        );
        rows = rows.filter(
          (b) =>
            b.owner_id === viewerId ||
            (!b.is_primary && b.space_id != null && accessibleSpaceIds.has(String(b.space_id))),
        );
      } else if (params.length >= 1 && normalized.includes('owner_id =')) {
        const ownerParam = hasSpaceFilter ? params[1] : params[0];
        rows = rows.filter((b) => b.owner_id === ownerParam);
      }
      rows.sort(
        (a, b) =>
          Number(b.is_primary) - Number(a.is_primary) ||
          Number(a.sort_order) - Number(b.sort_order),
      );
      return { rows };
    }

    if (normalized.includes('FROM bricksbot.spaces s')) {
      const ownerId = String(params[0]);
      const rows = [...spaces.values()].filter(
        (s) =>
          s.owner_id === ownerId ||
          members.some((m) => m.space_id === s.id && m.user_id === ownerId),
      );
      return { rows };
    }

    if (normalized.includes('FROM bricksbot.spaces WHERE id =')) {
      const row = spaces.get(String(params[0]));
      return { rows: row ? [row] : [] };
    }

    if (normalized.includes('FROM bricksbot.space_members')) {
      return { rows: members.filter((m) => m.space_id === params[0]) };
    }

    if (normalized.startsWith('INSERT INTO bricksbot.bots')) {
      const [
        id,
        name,
        avatar_label,
        space_id,
        is_primary,
        is_shared,
        description,
        source_bot_id,
        owner_id,
        sort_order,
      ] = params;
      const row = {
        id: String(id),
        name: String(name),
        avatar_label: String(avatar_label),
        presence: 'online',
        space_id: space_id ?? null,
        is_primary: Boolean(is_primary),
        is_shared: Boolean(is_shared),
        description: description ? String(description) : '',
        source_bot_id: source_bot_id ?? null,
        owner_id: String(owner_id),
        sort_order: Number(sort_order ?? 0),
        archived_at: null as string | null,
        created_at: new Date().toISOString(),
        last_message_preview: null as string | null,
      };
      bots.set(row.id, row);
      return { rows: [row] };
    }

    if (normalized.includes('COALESCE(MAX(sort_order)')) {
      const [ownerId, spaceId] = params;
      const siblings = [...bots.values()].filter(
        (b) =>
          b.owner_id === ownerId &&
          b.space_id === spaceId &&
          !b.is_primary &&
          b.archived_at == null,
      );
      const next =
        siblings.length === 0 ? 0 : Math.max(...siblings.map((b) => Number(b.sort_order))) + 1;
      return { rows: [{ next }] };
    }

    if (normalized.includes('FROM bricksbot.bots WHERE id =')) {
      const row = bots.get(String(params[0]));
      return { rows: row ? [row] : [] };
    }

    if (normalized.startsWith('UPDATE bricksbot.bots SET presence')) {
      const bot = bots.get(String(params[0]));
      if (!bot) return { rows: [] };
      bot.presence = String(params[1]);
      return { rows: [bot] };
    }

    if (normalized.startsWith('UPDATE bricksbot.bots SET last_message_preview')) {
      const bot = bots.get(String(params[0]));
      if (bot) {
        bot.last_message_preview = String(params[1]);
      }
      return { rows: [] };
    }

    if (normalized.includes('FROM bricksbot.bots') && normalized.includes('WHERE name =')) {
      const row = [...bots.values()].find(
        (b) => b.name === params[0] && (params.length < 2 || b.owner_id === params[1]),
      );
      return { rows: row ? [row] : [] };
    }

    if (normalized.startsWith('UPDATE bricksbot.bots') && normalized.includes('is_primary = TRUE')) {
      const bot = bots.get(String(params[0]));
      if (!bot) return { rows: [] };
      bot.is_primary = true;
      bot.space_id = params[1];
      bot.owner_id = String(params[2]);
      bot.sort_order = -1;
      bot.archived_at = null;
      return { rows: [bot] };
    }

    if (normalized.startsWith('UPDATE bricksbot.bots SET name =')) {
      const bot = bots.get(String(params[0]));
      if (!bot) return { rows: [] };
      bot.name = String(params[1]);
      bot.avatar_label = String(params[2]);
      bot.space_id = params[3] ?? null;
      bot.sort_order = Number(params[4]);
      if (params.length > 5) bot.is_shared = Boolean(params[5]);
      if (params.length > 6) bot.description = String(params[6] ?? '');
      return { rows: [bot] };
    }

    if (normalized.startsWith('UPDATE bricksbot.bots SET space_id =')) {
      const bot = bots.get(String(params[0]));
      if (!bot) return { rows: [] };
      bot.space_id = params[1] ?? null;
      bot.sort_order = Number(params[2]);
      return { rows: [bot] };
    }

    if (normalized.startsWith('UPDATE bricksbot.bots SET archived_at = NOW()')) {
      const bot = bots.get(String(params[0]));
      if (!bot) return { rows: [] };
      bot.archived_at = new Date().toISOString();
      return { rows: [bot] };
    }

    if (normalized.startsWith('UPDATE bricksbot.bots SET archived_at = NULL')) {
      const bot = bots.get(String(params[0]));
      if (!bot) return { rows: [] };
      bot.archived_at = null;
      bot.sort_order = Number(params[1]);
      return { rows: [bot] };
    }

    if (normalized.startsWith('DELETE FROM bricksbot.bots')) {
      bots.delete(String(params[0]));
      return { rows: [] };
    }

    if (
      normalized.includes('FROM bricksbot.bots') &&
      normalized.includes('id <>') &&
      normalized.includes('ORDER BY sort_order')
    ) {
      const [ownerId, spaceId, botId] = params;
      const rows = [...bots.values()]
        .filter(
          (b) =>
            b.owner_id === ownerId &&
            b.space_id === spaceId &&
            !b.is_primary &&
            b.archived_at == null &&
            b.id !== botId,
        )
        .sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
      return { rows };
    }

    if (normalized.includes('FROM bricksbot.chats WHERE bot_id =')) {
      const row = [...chats.values()].find(
        (c) => c.bot_id === params[0] && (params.length < 2 || c.user_id === params[1]),
      );
      return { rows: row ? [row] : [] };
    }

    if (normalized.includes('FROM bricksbot.chats WHERE user_id =')) {
      const rows = [...chats.values()].filter((c) => c.user_id === params[0]);
      return { rows };
    }

    if (normalized.startsWith('INSERT INTO bricksbot.chats')) {
      const [id, bot_id, user_id, title] = params.map(String);
      const now = new Date().toISOString();
      const row = {
        id,
        bot_id,
        user_id,
        title,
        created_at: now,
        updated_at: now,
        last_message_preview: null as string | null,
      };
      chats.set(id, row);
      return { rows: [row] };
    }

    if (normalized.includes('SELECT bot_id FROM bricksbot.chats')) {
      const row = chats.get(String(params[0]));
      return { rows: row ? [{ bot_id: row.bot_id }] : [] };
    }

    if (normalized.includes('SELECT id FROM bricksbot.chats WHERE id =')) {
      const row = chats.get(String(params[0]));
      return { rows: row ? [{ id: row.id }] : [] };
    }

    if (normalized.includes('FROM bricksbot.messages WHERE chat_id =')) {
      return {
        rows: messages
          .filter((m) => m.chat_id === params[0])
          .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))),
      };
    }

    if (normalized.startsWith('INSERT INTO bricksbot.messages')) {
      const [id, chat_id, role, content, tool_call_id, tool_calls] = params.map((p) =>
        p === null || p === undefined ? null : String(p),
      );
      const row = {
        id,
        chat_id,
        role,
        content,
        tool_call_id,
        tool_calls,
        created_at: new Date().toISOString(),
      };
      messages.push(row);
      return { rows: [row] };
    }

    if (normalized.startsWith('UPDATE bricksbot.chats SET updated_at')) {
      const chat = chats.get(String(params[0]));
      if (chat) {
        chat.updated_at = new Date().toISOString();
        if (params.length > 1) {
          chat.last_message_preview = String(params[1]);
        }
      }
      return { rows: [] };
    }

    throw new Error(`Unhandled SQL in fake lakebase: ${normalized}`);
  };

  return {
    query,
    reset() {
      spaces.clear();
      members.length = 0;
      bots.clear();
      chats.clear();
      messages.length = 0;
    },
  };
}

describe('LakebaseChatStore', () => {
  const fake = createFakeLakebase();
  let store: LakebaseChatStore;

  beforeEach(async () => {
    fake.reset();
    store = new LakebaseChatStore(fake.query);
    await store.initSchema();
  });

  test('bootstraps Personal space and persists chat', async () => {
    const { primary } = await store.ensureBootstrap('user-1');
    const chat = await store.getOrCreateChatForBot(primary.id);
    await store.addMessage(chat.id, 'user', 'survives restart');
    await store.addMessage(chat.id, 'assistant', 'ack');

    const again = new LakebaseChatStore(fake.query);
    expect(await again.listMessages(chat.id)).toHaveLength(2);
  });

  test('persists assistant tool_calls JSON', async () => {
    const { primary } = await store.ensureBootstrap('user-1');
    const chat = await store.getOrCreateChatForBot(primary.id);
    await store.addMessage(chat.id, 'assistant', 'Approval needed', {
      toolCalls: [{ id: 'call_1', name: 'sql_query', arguments: { statement: 'SELECT 1' } }],
    });

    const again = new LakebaseChatStore(fake.query);
    const messages = await again.listMessages(chat.id);
    expect(messages[0]?.toolCalls).toEqual([
      { id: 'call_1', name: 'sql_query', arguments: { statement: 'SELECT 1' } },
    ]);
  });

  test('shares space bots across members without exposing Primary or stealing Primary on bootstrap', async () => {
    const { primary: primaryA } = await store.ensureBootstrap('user-a');
    const { primary: primaryB } = await store.ensureBootstrap('user-b');
    expect(primaryB.id).not.toBe(primaryA.id);
    expect((await store.getBot(primaryA.id))?.ownerId).toBe('user-a');

    const shared = await store.createSpace({ name: 'Shared Team', ownerId: 'user-a' });
    const analyst = await store.createBot({
      name: 'Analyst',
      spaceId: shared.id,
      ownerId: 'user-a',
    });
    await store.addSpaceMember(shared.id, 'user-b', 'member');

    const botsForB = await store.listBots({ ownerId: 'user-b' });
    expect(botsForB.map((b) => b.id)).toEqual([primaryB.id, analyst.id]);

    const spaceBotsForB = await store.listBots({ ownerId: 'user-b', spaceId: shared.id });
    expect(spaceBotsForB.map((b) => b.id)).toEqual([analyst.id]);
  });

  test('addMessage updates bot.lastPreview and ignores tool rows', async () => {
    const { primary } = await store.ensureBootstrap('user-a');
    expect(primary.lastPreview).toBe('');
    const chat = await store.getOrCreateChatForBot(primary.id);

    await store.addMessage(chat.id, 'user', 'Run report');
    expect((await store.getBot(primary.id))?.lastPreview).toBe('Run report');

    await store.addMessage(chat.id, 'tool', JSON.stringify({ result: 'ok' }), {
      toolCallId: 'call_1',
    });
    expect((await store.getBot(primary.id))?.lastPreview).toBe('Run report');

    const freshStore = new LakebaseChatStore(fake.query);
    expect((await freshStore.getBot(primary.id))?.lastPreview).toBe('Run report');
  });

  test('write-through cache avoids duplicate SQL queries for ensureBootstrap, getBot, and findBotIdForChat', async () => {
    const queries: string[] = [];
    const countingQuery: LakebaseQuery = async (sql, params) => {
      queries.push(sql.replace(/\s+/g, ' ').trim());
      return fake.query(sql, params);
    };
    const cachedStore = new LakebaseChatStore(countingQuery);
    const { primary } = await cachedStore.ensureBootstrap('user-1');
    const chat = await cachedStore.getOrCreateChatForBot(primary.id);

    queries.length = 0;
    await cachedStore.ensureBootstrap('user-1');
    await cachedStore.getBot(primary.id);
    await cachedStore.findBotIdForChat(chat.id);
    await cachedStore.setBotPresence(primary.id, primary.presence);
    expect(queries).toHaveLength(0);
  });

  test('isolates per-user chats and lastPreview on shared bots across instances', async () => {
    await store.ensureBootstrap('user-a');
    await store.ensureBootstrap('user-b');
    const sharedSpace = await store.createSpace({ name: 'Team', ownerId: 'user-a' });
    await store.addSpaceMember(sharedSpace.id, 'user-b', 'member');
    const bot = await store.createBot({
      name: 'Analyst',
      spaceId: sharedSpace.id,
      ownerId: 'user-a',
    });

    const chatA = await store.getOrCreateChatForBot(bot.id, 'user-a');
    const chatB = await store.getOrCreateChatForBot(bot.id, 'user-b');
    expect(chatA.id).not.toBe(chatB.id);
    expect(chatA.userId).toBe('user-a');
    expect(chatB.userId).toBe('user-b');

    await store.addMessage(chatA.id, 'user', 'Secret from user-a');
    expect(await store.listMessages(chatA.id)).toHaveLength(1);
    expect(await store.listMessages(chatB.id)).toHaveLength(0);

    const freshStore = new LakebaseChatStore(fake.query);
    const botsForB = await freshStore.listBots({ ownerId: 'user-b' });
    expect(botsForB.find((b) => b.id === bot.id)?.lastPreview).toBe('');

    const botsForA = await freshStore.listBots({ ownerId: 'user-a' });
    expect(botsForA.find((b) => b.id === bot.id)?.lastPreview).toBe('Secret from user-a');

    await freshStore.addMessage(chatB.id, 'user', 'Secret from user-b');
    const freshStore2 = new LakebaseChatStore(fake.query);
    const botsForBAfter = await freshStore2.listBots({ ownerId: 'user-b' });
    expect(botsForBAfter.find((b) => b.id === bot.id)?.lastPreview).toBe('Secret from user-b');
  });

  test('persists marketplace sharing and description', async () => {
    const bot = await store.createBot({
      name: 'SQL Helper',
      ownerId: 'user-a',
      description: 'Writes warehouse queries',
    });
    expect(bot.isShared).toBe(false);
    expect(await store.listMarketplaceBots()).toEqual([]);

    const chat = await store.getOrCreateChatForBot(bot.id, 'user-a');
    await store.addMessage(chat.id, 'user', 'Private owner prompt');

    await store.updateBot(bot.id, { isShared: true, description: 'Updated SQL Helper' });
    const marketplace = await store.listMarketplaceBots();
    expect(marketplace).toHaveLength(1);
    expect(marketplace[0]).toMatchObject({
      id: bot.id,
      isShared: true,
      description: 'Updated SQL Helper',
      lastPreview: '',
    });
  });
});
