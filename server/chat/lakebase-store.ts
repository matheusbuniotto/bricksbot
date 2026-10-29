import { randomUUID } from 'node:crypto';
import type {
  Bot,
  Chat,
  ChatStore,
  CreateBotInput,
  CreateSpaceInput,
  Message,
  MessageRole,
  Presence,
  Space,
  SpaceMember,
  SpaceRole,
} from '../../shared/chat/types.js';
import type { ToolCall } from '../../shared/llm/types.js';
import { CHAT_SCHEMA_STATEMENTS } from './schema.js';

export type LakebaseQuery = (
  sql: string,
  params?: unknown[],
) => Promise<{ rows: Record<string, unknown>[] }>;

const PRIMARY_NAME = 'Primary';
const DEFAULT_SPACE_NAME = 'Personal';

function asString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (value === null || value === undefined) return '';
  return String(value);
}

function asBool(value: unknown): boolean {
  return value === true || value === 't' || value === 'true';
}

function avatarFromName(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase();
}

function mapSpace(row: Record<string, unknown>): Space {
  return {
    id: asString(row.id),
    name: asString(row.name),
    ownerId: asString(row.owner_id),
    createdAt: asString(row.created_at),
  };
}

function mapBot(row: Record<string, unknown>): Bot {
  return {
    id: asString(row.id),
    name: asString(row.name),
    avatarLabel: asString(row.avatar_label),
    presence: asString(row.presence) as Presence,
    spaceId: row.space_id ? asString(row.space_id) : null,
    isPrimary: asBool(row.is_primary),
    ownerId: asString(row.owner_id) || 'workspace-user',
    createdAt: asString(row.created_at),
  };
}

function mapChat(row: Record<string, unknown>): Chat {
  return {
    id: asString(row.id),
    botId: asString(row.bot_id),
    title: asString(row.title),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
  };
}

function parseToolCalls(raw: unknown): ToolCall[] | undefined {
  if (raw == null || raw === '') return undefined;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed) || parsed.length === 0) return undefined;
    const calls: ToolCall[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const row = item as { id?: string; name?: string; arguments?: Record<string, unknown> };
      if (!row.id || !row.name) continue;
      calls.push({ id: row.id, name: row.name, arguments: row.arguments ?? {} });
    }
    return calls.length > 0 ? calls : undefined;
  } catch {
    return undefined;
  }
}

function mapMessage(row: Record<string, unknown>): Message {
  return {
    id: asString(row.id),
    chatId: asString(row.chat_id),
    role: asString(row.role) as Message['role'],
    content: asString(row.content),
    createdAt: asString(row.created_at),
    toolCallId: row.tool_call_id ? asString(row.tool_call_id) : undefined,
    toolCalls: parseToolCalls(row.tool_calls),
  };
}

function mapMember(row: Record<string, unknown>): SpaceMember {
  return {
    spaceId: asString(row.space_id),
    userId: asString(row.user_id),
    role: asString(row.role) as SpaceRole,
  };
}

export class LakebaseChatStore implements ChatStore {
  constructor(private readonly query: LakebaseQuery) {}

  async initSchema(): Promise<void> {
    for (const statement of CHAT_SCHEMA_STATEMENTS) {
      await this.query(statement);
    }
  }

  async ensureBootstrap(ownerId: string): Promise<{ space: Space; primary: Bot }> {
    const spaces = await this.query(
      `SELECT id, name, owner_id, created_at FROM bricksbot.spaces
       WHERE owner_id = $1 AND name = $2
       ORDER BY created_at ASC LIMIT 1`,
      [ownerId, DEFAULT_SPACE_NAME],
    );
    let space = spaces.rows[0] ? mapSpace(spaces.rows[0]) : null;
    if (!space) {
      space = await this.createSpace({ name: DEFAULT_SPACE_NAME, ownerId });
    }

    const primaries = await this.query(
      `SELECT id, name, avatar_label, presence, space_id, is_primary, owner_id, created_at
       FROM bricksbot.bots
       WHERE owner_id = $1 AND is_primary = TRUE
       ORDER BY created_at ASC LIMIT 1`,
      [ownerId],
    );
    let primary = primaries.rows[0] ? mapBot(primaries.rows[0]) : null;
    if (!primary) {
      // Promote a legacy Phase 1 Primary row if present.
      const legacy = await this.query(
        `SELECT id, name, avatar_label, presence, space_id, is_primary, owner_id, created_at
         FROM bricksbot.bots
         WHERE name = $1
         ORDER BY created_at ASC LIMIT 1`,
        [PRIMARY_NAME],
      );
      if (legacy.rows[0]) {
        const promoted = await this.query(
          `UPDATE bricksbot.bots
           SET is_primary = TRUE, space_id = $2, owner_id = $3
           WHERE id = $1
           RETURNING id, name, avatar_label, presence, space_id, is_primary, owner_id, created_at`,
          [asString(legacy.rows[0].id), space.id, ownerId],
        );
        primary = mapBot(promoted.rows[0]!);
      } else {
        primary = await this.createBot({
          name: PRIMARY_NAME,
          spaceId: space.id,
          ownerId,
          avatarLabel: 'P',
          isPrimary: true,
        });
      }
    }
    return { space, primary };
  }

  async ensurePrimaryBot(): Promise<Bot> {
    const { primary } = await this.ensureBootstrap('workspace-user');
    return primary;
  }

  async listSpaces(ownerId: string): Promise<Space[]> {
    const result = await this.query(
      `SELECT DISTINCT s.id, s.name, s.owner_id, s.created_at
       FROM bricksbot.spaces s
       LEFT JOIN bricksbot.space_members m ON m.space_id = s.id
       WHERE s.owner_id = $1 OR m.user_id = $1
       ORDER BY s.created_at ASC`,
      [ownerId],
    );
    return result.rows.map(mapSpace);
  }

  async createSpace(input: CreateSpaceInput): Promise<Space> {
    const name = input.name.trim();
    if (!name) throw new Error('Space name is required');
    const id = randomUUID();
    const inserted = await this.query(
      `INSERT INTO bricksbot.spaces (id, name, owner_id)
       VALUES ($1, $2, $3)
       RETURNING id, name, owner_id, created_at`,
      [id, name, input.ownerId],
    );
    await this.query(
      `INSERT INTO bricksbot.space_members (space_id, user_id, role)
       VALUES ($1, $2, 'admin')
       ON CONFLICT (space_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [id, input.ownerId],
    );
    return mapSpace(inserted.rows[0]!);
  }

  async getSpace(spaceId: string): Promise<Space | null> {
    const result = await this.query(
      `SELECT id, name, owner_id, created_at FROM bricksbot.spaces WHERE id = $1`,
      [spaceId],
    );
    return result.rows[0] ? mapSpace(result.rows[0]) : null;
  }

  async listSpaceMembers(spaceId: string): Promise<SpaceMember[]> {
    const space = await this.getSpace(spaceId);
    if (!space) throw new Error('Space not found');
    const result = await this.query(
      `SELECT space_id, user_id, role FROM bricksbot.space_members WHERE space_id = $1`,
      [spaceId],
    );
    return result.rows.map(mapMember);
  }

  async addSpaceMember(spaceId: string, userId: string, role: SpaceRole): Promise<SpaceMember> {
    const space = await this.getSpace(spaceId);
    if (!space) throw new Error('Space not found');
    const result = await this.query(
      `INSERT INTO bricksbot.space_members (space_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (space_id, user_id) DO UPDATE SET role = EXCLUDED.role
       RETURNING space_id, user_id, role`,
      [spaceId, userId, role],
    );
    return mapMember(result.rows[0]!);
  }

  async listBots(options?: { spaceId?: string | null; ownerId?: string }): Promise<Bot[]> {
    if (options?.ownerId) await this.ensureBootstrap(options.ownerId);
    else await this.ensurePrimaryBot();

    const clauses: string[] = [];
    const params: unknown[] = [];
    if (options?.spaceId !== undefined) {
      params.push(options.spaceId);
      clauses.push(`space_id IS NOT DISTINCT FROM $${params.length}`);
    }
    if (options?.ownerId) {
      params.push(options.ownerId);
      clauses.push(`owner_id = $${params.length}`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const result = await this.query(
      `SELECT id, name, avatar_label, presence, space_id, is_primary, owner_id, created_at
       FROM bricksbot.bots
       ${where}
       ORDER BY is_primary DESC, created_at ASC`,
      params,
    );
    return result.rows.map(mapBot);
  }

  async createBot(input: CreateBotInput): Promise<Bot> {
    const name = input.name.trim();
    if (!name) throw new Error('Bot name is required');
    if (input.spaceId) {
      const space = await this.getSpace(input.spaceId);
      if (!space) throw new Error('Space not found');
    }
    const id = randomUUID();
    const inserted = await this.query(
      `INSERT INTO bricksbot.bots (id, name, avatar_label, presence, space_id, is_primary, owner_id)
       VALUES ($1, $2, $3, 'online', $4, $5, $6)
       RETURNING id, name, avatar_label, presence, space_id, is_primary, owner_id, created_at`,
      [
        id,
        name,
        input.avatarLabel?.trim() || avatarFromName(name),
        input.spaceId ?? null,
        Boolean(input.isPrimary),
        input.ownerId,
      ],
    );
    return mapBot(inserted.rows[0]!);
  }

  async getBot(botId: string): Promise<Bot | null> {
    const result = await this.query(
      `SELECT id, name, avatar_label, presence, space_id, is_primary, owner_id, created_at
       FROM bricksbot.bots WHERE id = $1`,
      [botId],
    );
    return result.rows[0] ? mapBot(result.rows[0]) : null;
  }

  async setBotPresence(botId: string, presence: Presence): Promise<Bot> {
    const result = await this.query(
      `UPDATE bricksbot.bots SET presence = $2 WHERE id = $1
       RETURNING id, name, avatar_label, presence, space_id, is_primary, owner_id, created_at`,
      [botId, presence],
    );
    if (!result.rows[0]) throw new Error('Bot not found');
    return mapBot(result.rows[0]);
  }

  async getOrCreateChatForBot(botId: string): Promise<Chat> {
    const bot = await this.getBot(botId);
    if (!bot) throw new Error('Bot not found');

    const existing = await this.query(
      `SELECT id, bot_id, title, created_at, updated_at FROM bricksbot.chats WHERE bot_id = $1`,
      [botId],
    );
    if (existing.rows[0]) return mapChat(existing.rows[0]);

    const id = randomUUID();
    const inserted = await this.query(
      `INSERT INTO bricksbot.chats (id, bot_id, title)
       VALUES ($1, $2, $3)
       RETURNING id, bot_id, title, created_at, updated_at`,
      [id, botId, bot.name],
    );
    return mapChat(inserted.rows[0]!);
  }

  async findBotIdForChat(chatId: string): Promise<string | null> {
    const result = await this.query(`SELECT bot_id FROM bricksbot.chats WHERE id = $1`, [chatId]);
    return result.rows[0] ? asString(result.rows[0].bot_id) : null;
  }

  async listMessages(chatId: string): Promise<Message[]> {
    const chat = await this.query(`SELECT id FROM bricksbot.chats WHERE id = $1`, [chatId]);
    if (!chat.rows[0]) throw new Error('Chat not found');
    const result = await this.query(
      `SELECT id, chat_id, role, content, created_at, tool_call_id, tool_calls
       FROM bricksbot.messages
       WHERE chat_id = $1
       ORDER BY created_at ASC`,
      [chatId],
    );
    return result.rows.map(mapMessage);
  }

  async addMessage(
    chatId: string,
    role: MessageRole,
    content: string,
    options?: { toolCallId?: string; toolCalls?: ToolCall[] },
  ): Promise<Message> {
    const trimmed = content.trim();
    if (!trimmed && role !== 'assistant') {
      throw new Error('Message content is required');
    }
    const chat = await this.query(`SELECT id FROM bricksbot.chats WHERE id = $1`, [chatId]);
    if (!chat.rows[0]) throw new Error('Chat not found');

    const id = randomUUID();
    const toolCallsJson =
      options?.toolCalls?.length ? JSON.stringify(options.toolCalls) : null;
    const result = await this.query(
      `INSERT INTO bricksbot.messages (id, chat_id, role, content, tool_call_id, tool_calls)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, chat_id, role, content, created_at, tool_call_id, tool_calls`,
      [id, chatId, role, trimmed, options?.toolCallId ?? null, toolCallsJson],
    );
    await this.query(`UPDATE bricksbot.chats SET updated_at = NOW() WHERE id = $1`, [chatId]);
    return mapMessage(result.rows[0]!);
  }
}
