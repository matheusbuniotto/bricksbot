import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, test } from 'vitest';
import { CHAT_SCHEMA_STATEMENTS } from './schema.js';
import { LakebaseChatStore, type LakebaseQuery } from './lakebase-store.js';

type Row = Record<string, unknown>;

/** Chat order is by timestamp, so let the clock move between steps. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 3));

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

    if (normalized.startsWith('UPDATE bricksbot.chats c SET user_id = b.owner_id')) {
      for (const chat of chats.values()) {
        const bot = bots.get(chat.bot_id);
        if (bot && chat.user_id === 'workspace-user' && bot.owner_id !== 'workspace-user') {
          chat.user_id = bot.owner_id;
        }
      }
      return { rows: [] };
    }

    if (normalized.startsWith('UPDATE bricksbot.bot_memories m SET user_id = b.owner_id')) {
      return { rows: [] };
    }

    if (normalized.startsWith('UPDATE bricksbot.approval_events SET payload')) {
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

    if (
      normalized.includes('FROM bricksbot.bots') &&
      normalized.includes('ORDER BY created_at DESC') &&
      normalized.includes('is_shared = TRUE')
    ) {
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
              (s) => s.owner_id === viewerId || members.some((m) => m.space_id === s.id && m.user_id === viewerId)
            )
            .map((s) => String(s.id))
        );
        rows = rows.filter(
          (b) =>
            b.owner_id === viewerId ||
            (!b.is_primary && b.space_id != null && accessibleSpaceIds.has(String(b.space_id)))
        );
      } else if (params.length >= 1 && normalized.includes('owner_id =')) {
        const ownerParam = hasSpaceFilter ? params[1] : params[0];
        rows = rows.filter((b) => b.owner_id === ownerParam);
      }
      rows.sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || Number(a.sort_order) - Number(b.sort_order));
      return { rows };
    }

    if (normalized.includes('FROM bricksbot.spaces s')) {
      const ownerId = String(params[0]);
      const rows = [...spaces.values()].filter(
        (s) => s.owner_id === ownerId || members.some((m) => m.space_id === s.id && m.user_id === ownerId)
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
        (b) => b.owner_id === ownerId && b.space_id === spaceId && !b.is_primary && b.archived_at == null
      );
      const next = siblings.length === 0 ? 0 : Math.max(...siblings.map((b) => Number(b.sort_order))) + 1;
      return { rows: [{ next }] };
    }

    if (normalized.includes('FROM bricksbot.bots WHERE id =')) {
      const row = bots.get(String(params[0]));
      return { rows: row ? [row] : [] };
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
        (b) => b.name === params[0] && (params.length < 2 || b.owner_id === params[1])
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
            b.owner_id === ownerId && b.space_id === spaceId && !b.is_primary && b.archived_at == null && b.id !== botId
        )
        .sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
      return { rows };
    }

    if (
      normalized.includes('FROM bricksbot.chats WHERE bot_id =') ||
      normalized.includes('FROM bricksbot.chats WHERE routine_id =')
    ) {
      let rows = [...chats.values()].reverse(); // later insert wins an updated_at tie
      if (normalized.includes('routine_id = $1')) {
        rows = rows.filter((c) => c.routine_id === params[0] && c.kind === 'routine');
      } else {
        rows = rows.filter((c) => c.bot_id === params[0] && c.user_id === params[1]);
        for (const kind of ['user', 'handoff']) {
          if (normalized.includes(`kind = '${kind}'`)) rows = rows.filter((c) => c.kind === kind);
        }
      }
      if (normalized.includes('archived_at IS NULL')) rows = rows.filter((c) => c.archived_at == null);
      rows.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
      return { rows: normalized.includes('LIMIT 1') ? rows.slice(0, 1) : rows };
    }

    // listUserChats
    if (normalized.startsWith('SELECT id, bot_id') && normalized.includes('FROM bricksbot.chats WHERE user_id =')) {
      const rows = [...chats.values()]
        .reverse()
        .filter((c) => c.user_id === params[0] && c.archived_at == null)
        .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
      return { rows };
    }

    // searchMessages: the fake stands in for the tsvector match with a word-contains check
    if (normalized.includes('m.search_tsv @@ websearch_to_tsquery')) {
      const [userId, text, limit, botId] = params as [string, string, number, string | undefined];
      const terms = text.toLowerCase().split(/\s+/).filter(Boolean);
      const rows: Row[] = [];
      for (const chat of chats.values()) {
        if (chat.user_id !== userId || chat.archived_at != null) continue;
        if (normalized.includes('c.bot_id = $4') && chat.bot_id !== botId) continue;
        const match = messages
          .filter(
            (m) =>
              m.chat_id === chat.id &&
              (m.role === 'user' || m.role === 'assistant') &&
              terms.every((t) => String(m.content).toLowerCase().includes(t))
          )
          .pop();
        if (match) rows.push({ ...match, bot_id: chat.bot_id, title: chat.title });
      }
      rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      return { rows: rows.slice(0, limit) };
    }

    if (normalized.includes('FROM bricksbot.chats WHERE user_id =')) {
      const rows = [...chats.values()].filter(
        (c) =>
          c.user_id === params[0] &&
          c.last_message_preview != null &&
          (!normalized.includes('archived_at IS NULL') || c.archived_at == null)
      );
      return { rows };
    }

    if (normalized.startsWith('INSERT INTO bricksbot.chats')) {
      const [id, bot_id, user_id, title, kind] = params.map(String);
      const routine_id = params[5] ?? null;
      const taken = [...chats.values()].some((c) =>
        kind === 'routine'
          ? c.routine_id === routine_id && c.kind === 'routine'
          : kind === 'handoff' && c.bot_id === bot_id && c.user_id === user_id && c.kind === 'handoff'
      );
      if (taken) return { rows: [] }; // ON CONFLICT DO NOTHING
      const now = new Date().toISOString();
      const row = {
        id,
        bot_id,
        user_id,
        title,
        kind,
        routine_id,
        archived_at: null as string | null,
        created_at: now,
        updated_at: now,
        last_message_preview: null as string | null,
      };
      chats.set(id, row);
      return { rows: [row] };
    }

    if (normalized.startsWith('UPDATE bricksbot.chats SET title')) {
      const chat = chats.get(String(params[0]));
      if (chat) chat.title = String(params[1]);
      return { rows: chat ? [chat] : [] };
    }

    if (normalized.startsWith('UPDATE bricksbot.chats SET archived_at') && normalized.includes('WHERE routine_id =')) {
      const rows = [...chats.values()].filter((c) => c.routine_id === params[0] && c.kind === 'routine');
      for (const chat of rows) chat.archived_at ??= new Date().toISOString();
      return { rows };
    }

    if (normalized.startsWith('UPDATE bricksbot.chats SET archived_at')) {
      const chat = chats.get(String(params[0]));
      if (chat) chat.archived_at ??= new Date().toISOString();
      return { rows: chat ? [chat] : [] };
    }

    if (normalized.includes('SELECT bot_id FROM bricksbot.chats')) {
      const row = chats.get(String(params[0]));
      return { rows: row ? [{ bot_id: row.bot_id }] : [] };
    }

    if (normalized.includes('FROM bricksbot.chats WHERE id =')) {
      const row = chats.get(String(params[0]));
      return { rows: row ? [row] : [] };
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
        p === null || p === undefined ? null : String(p)
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
    const chat = await store.getDefaultChat(primary.id);
    await store.addMessage(chat.id, 'user', 'survives restart');
    await store.addMessage(chat.id, 'assistant', 'ack');

    const again = new LakebaseChatStore(fake.query);
    expect(await again.listMessages(chat.id)).toHaveLength(2);
  });

  test('persists assistant tool_calls JSON', async () => {
    const { primary } = await store.ensureBootstrap('user-1');
    const chat = await store.getDefaultChat(primary.id);
    await store.addMessage(chat.id, 'assistant', 'Approval needed', {
      toolCalls: [{ id: 'call_1', name: 'sql_query', arguments: { statement: 'SELECT 1' } }],
    });

    const again = new LakebaseChatStore(fake.query);
    const messages = await again.listMessages(chat.id);
    expect(messages[0]?.toolCalls).toEqual([{ id: 'call_1', name: 'sql_query', arguments: { statement: 'SELECT 1' } }]);
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
      isShared: true,
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
    const chat = await store.getDefaultChat(primary.id);

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
    const chat = await cachedStore.getDefaultChat(primary.id);

    queries.length = 0;
    await cachedStore.ensureBootstrap('user-1');
    await cachedStore.getBot(primary.id);
    await cachedStore.findBotIdForChat(chat.id);
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
      isShared: true,
    });

    const chatA = await store.getDefaultChat(bot.id, 'user-a');
    const chatB = await store.getDefaultChat(bot.id, 'user-b');
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

  test('an archived chat stops driving the roster preview, cached or not', async () => {
    await store.ensureBootstrap('user-a');
    await store.ensureBootstrap('user-b');
    const sharedSpace = await store.createSpace({ name: 'Team', ownerId: 'user-a' });
    await store.addSpaceMember(sharedSpace.id, 'user-b', 'member');
    const bot = await store.createBot({ name: 'Analyst', spaceId: sharedSpace.id, ownerId: 'user-a', isShared: true });
    const chatB = await store.getDefaultChat(bot.id, 'user-b');
    await store.addMessage(chatB.id, 'user', 'Secret from user-b');

    const roster = new LakebaseChatStore(fake.query);
    const previewForB = async (s: LakebaseChatStore) =>
      (await s.listBots({ ownerId: 'user-b' })).find((b) => b.id === bot.id)?.lastPreview;
    expect(await previewForB(roster)).toBe('Secret from user-b');

    await roster.archiveChat(chatB.id);
    expect(await previewForB(roster)).toBe('');
    expect(await previewForB(new LakebaseChatStore(fake.query))).toBe('');
  });

  test('persists marketplace sharing and description', async () => {
    const bot = await store.createBot({
      name: 'SQL Helper',
      ownerId: 'user-a',
      description: 'Writes warehouse queries',
    });
    expect(bot.isShared).toBe(false);
    expect(await store.listMarketplaceBots()).toEqual([]);

    const chat = await store.getDefaultChat(bot.id, 'user-a');
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

  test('backfill migration updates chats with workspace-user to bot owner', async () => {
    const bot = await store.createBot({
      name: 'ExistingBot',
      ownerId: 'migrated-user',
    });
    const preMigrationChat = await store.getDefaultChat(bot.id, 'workspace-user');
    expect(preMigrationChat.userId).toBe('workspace-user');

    await store.initSchema();

    const freshStore = new LakebaseChatStore(fake.query);
    const backfilledChat = await freshStore.getChat(preMigrationChat.id);
    expect(backfilledChat?.userId).toBe('migrated-user');
  });

  test('keeps several chats per (bot, user), with routine and handoff chats on their own', async () => {
    const bot = await store.createBot({ name: 'Analyst', ownerId: 'user-a' });
    const first = await store.getDefaultChat(bot.id, 'user-a');
    await tick();
    const second = await store.createChat(bot.id, 'user-a', 'Q3');
    expect((await store.getDefaultChat(bot.id, 'user-a')).id).toBe(second.id);

    await tick();
    await store.addMessage(first.id, 'user', 'ping');
    const fresh = new LakebaseChatStore(fake.query);
    expect((await fresh.getDefaultChat(bot.id, 'user-a')).id).toBe(first.id);
    expect((await fresh.listChats(bot.id, 'user-a')).map((c) => c.id)).toEqual([first.id, second.id]);
    expect(await fresh.listChats(bot.id, 'user-b')).toEqual([]);

    const routine = { id: randomUUID(), botId: bot.id, ownerId: 'user-a', name: 'Daily' };
    const routineChat = await fresh.getRoutineChat(routine);
    expect(routineChat).toMatchObject({ kind: 'routine', routineId: routine.id });
    expect((await new LakebaseChatStore(fake.query).getRoutineChat(routine)).id).toBe(routineChat.id);

    const handoffChat = await fresh.getHandoffChat(bot.id, 'user-a');
    expect(handoffChat.kind).toBe('handoff');
    expect((await new LakebaseChatStore(fake.query).getHandoffChat(bot.id, 'user-a')).id).toBe(handoffChat.id);
    expect((await fresh.getDefaultChat(bot.id, 'user-a')).id).toBe(first.id);
  });

  test('renames and archives chats, and archived chats leave the list and the default', async () => {
    const bot = await store.createBot({ name: 'Analyst', ownerId: 'user-a' });
    const first = await store.getDefaultChat(bot.id, 'user-a');
    const second = await store.createChat(bot.id, 'user-a');
    expect(second.title).toBe('New chat');

    expect((await store.renameChat(second.id, ' Weekly ')).title).toBe('Weekly');
    const archived = await store.archiveChat(second.id);
    expect(archived.archivedAt).toBeTruthy();
    expect((await store.getChat(second.id))?.archivedAt).toBeTruthy();

    expect((await store.listChats(bot.id, 'user-a')).map((c) => c.id)).toEqual([first.id]);
    expect((await store.getDefaultChat(bot.id, 'user-a')).id).toBe(first.id);
    await expect(store.archiveChat('missing')).rejects.toThrow('Chat not found');
  });

  test('archiving a deleted routine chat takes it off the list, in this process and the next', async () => {
    const bot = await store.createBot({ name: 'Analyst', ownerId: 'user-a' });
    const routine = { id: randomUUID(), botId: bot.id, ownerId: 'user-a', name: 'Daily' };
    const routineChat = await store.getRoutineChat(routine);
    const userChat = await store.getDefaultChat(bot.id, 'user-a');

    await store.archiveRoutineChat(routine.id);

    expect((await store.getChat(routineChat.id))?.archivedAt).toBeTruthy();
    expect((await store.listChats(bot.id, 'user-a')).map((c) => c.id)).toEqual([userChat.id]);
    expect((await new LakebaseChatStore(fake.query).listChats(bot.id, 'user-a')).map((c) => c.id)).toEqual([
      userChat.id,
    ]);
  });

  test('the roster preview follows the latest chat that has a message', async () => {
    const bot = await store.createBot({ name: 'Analyst', ownerId: 'user-a' });
    const first = await store.getDefaultChat(bot.id, 'user-a');
    await store.addMessage(first.id, 'user', 'older chat');
    await store.createChat(bot.id, 'user-a');

    const fresh = new LakebaseChatStore(fake.query);
    const mine = await fresh.listBots({ ownerId: 'user-a' });
    expect(mine.find((b) => b.id === bot.id)?.lastPreview).toBe('older chat');
  });

  test('lists every active chat of a user across bots', async () => {
    const one = await store.createBot({ name: 'One', ownerId: 'user-a' });
    const two = await store.createBot({ name: 'Two', ownerId: 'user-a' });
    const first = await store.createChat(one.id, 'user-a');
    await tick();
    const second = await store.createChat(two.id, 'user-a');
    await store.createChat(two.id, 'user-b');
    await tick();
    const archived = await store.createChat(one.id, 'user-a');
    await store.archiveChat(archived.id);

    expect((await store.listUserChats('user-a')).map((chat) => chat.id)).toEqual([second.id, first.id]);
  });

  test('search returns one hit per chat for the user, newest first, and honors archive and bot filters', async () => {
    const bot = await store.createBot({ name: 'Analyst', ownerId: 'user-a' });
    const other = await store.createBot({ name: 'Other', ownerId: 'user-a' });
    const older = await store.createChat(bot.id, 'user-a', 'Older');
    const newer = await store.createChat(other.id, 'user-a', 'Newer');
    const theirs = await store.createChat(bot.id, 'user-b');
    await store.addMessage(older.id, 'user', 'revenue by region');
    await store.addMessage(older.id, 'assistant', 'Here is the revenue table');
    await tick();
    await store.addMessage(newer.id, 'user', 'revenue again');
    await store.addMessage(theirs.id, 'user', 'revenue of user-b');

    const hits = await store.searchMessages('user-a', 'Revenue');
    expect(hits.map((hit) => [hit.chatTitle, hit.role, hit.botId])).toEqual([
      ['Newer', 'user', other.id],
      ['Older', 'assistant', bot.id],
    ]);
    expect(hits[1].snippet).toBe('Here is the revenue table');
    expect((await store.searchMessages('user-a', 'revenue', { botId: bot.id })).map((hit) => hit.chatId)).toEqual([
      older.id,
    ]);
    expect(await store.searchMessages('user-a', '  ')).toEqual([]);

    await store.archiveChat(newer.id);
    expect((await store.searchMessages('user-a', 'revenue')).map((hit) => hit.chatId)).toEqual([older.id]);
  });

  test('schema indexes user and assistant text for search', () => {
    const statements = CHAT_SCHEMA_STATEMENTS.join('\n');
    expect(statements).toContain("to_tsvector('simple', left(content, 20000))");
    expect(statements).toContain("role IN ('user', 'assistant')");
    expect(statements).toContain('USING GIN (search_tsv)');
  });

  test('schema drops the one-chat-per-bot index and adds the multi-chat columns', () => {
    const statements = CHAT_SCHEMA_STATEMENTS.join('\n');
    expect(statements).not.toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_bricksbot_chats_bot_user ');
    expect(statements).toContain('DROP INDEX IF EXISTS bricksbot.idx_bricksbot_chats_bot_user');
    expect(statements).toContain("kind TEXT NOT NULL DEFAULT 'user'");
    expect(statements).toContain('bricksbot.chats(bot_id, user_id, updated_at DESC)');
  });
});
