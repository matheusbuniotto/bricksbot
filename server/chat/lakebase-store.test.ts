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
      normalized.startsWith('ALTER TABLE')
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

    if (normalized.includes('FROM bricksbot.bots') && normalized.includes('is_primary = TRUE')) {
      const ownerId = String(params[0]);
      const row = [...bots.values()].find((b) => b.owner_id === ownerId && b.is_primary);
      return { rows: row ? [row] : [] };
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
      const [id, name, avatar_label, , space_id, is_primary, owner_id] = params;
      const row = {
        id: String(id),
        name: String(name),
        avatar_label: String(avatar_label),
        presence: 'online',
        space_id: space_id ?? null,
        is_primary: Boolean(is_primary),
        owner_id: String(owner_id),
        created_at: new Date().toISOString(),
      };
      bots.set(row.id, row);
      return { rows: [row] };
    }

    if (normalized.includes('FROM bricksbot.bots') && normalized.includes('ORDER BY is_primary')) {
      let rows = [...bots.values()];
      // naive filter for tests
      if (params.length === 2) {
        rows = rows.filter((b) => b.space_id === params[0] && b.owner_id === params[1]);
      } else if (params.length === 1) {
        rows = rows.filter((b) => b.owner_id === params[0]);
      }
      rows.sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
      return { rows };
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

    if (normalized.includes('FROM bricksbot.bots') && normalized.includes('WHERE name =')) {
      const row = [...bots.values()].find((b) => b.name === params[0]);
      return { rows: row ? [row] : [] };
    }

    if (normalized.startsWith('UPDATE bricksbot.bots') && normalized.includes('is_primary = TRUE')) {
      const bot = bots.get(String(params[0]));
      if (!bot) return { rows: [] };
      bot.is_primary = true;
      bot.space_id = params[1];
      bot.owner_id = String(params[2]);
      return { rows: [bot] };
    }

    if (normalized.includes('FROM bricksbot.chats WHERE bot_id =')) {
      const row = [...chats.values()].find((c) => c.bot_id === params[0]);
      return { rows: row ? [row] : [] };
    }

    if (normalized.startsWith('INSERT INTO bricksbot.chats')) {
      const [id, bot_id, title] = params.map(String);
      const now = new Date().toISOString();
      const row = { id, bot_id, title, created_at: now, updated_at: now };
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
      if (chat) chat.updated_at = new Date().toISOString();
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
});
