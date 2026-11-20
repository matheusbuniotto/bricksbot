import { randomUUID } from 'node:crypto';
import type {
  Bot,
  Chat,
  ChatStore,
  CreateBotInput,
  CreateSpaceInput,
  ListBotsOptions,
  Message,
  MessageRole,
  MoveBotInput,
  SearchHit,
  Space,
  SpaceMember,
  SpaceRole,
  UpdateBotInput,
} from '../../shared/chat/types.js';
import type { ToolCall } from '../../shared/agents/types.js';
import { messagePreviewLine } from '../../shared/chat/preview.js';
import { canViewerAccessSpace, isBotVisibleToViewer } from './access-policy.js';
import {
  avatarFromName,
  DEFAULT_CHAT_TITLE,
  DEFAULT_SPACE_NAME,
  PRIMARY_NAME,
  updatedAvatarLabel,
} from './bot-defaults.js';
import { nowIso } from '../lib/coerce.js';
import { SEARCH_LIMIT, searchTerms, snippetAround } from './search.js';

function sortBots(a: Bot, b: Bot): number {
  if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return a.createdAt.localeCompare(b.createdAt);
}

/** In-memory ChatStore for tests and local runs without Lakebase. */
export class MemoryChatStore implements ChatStore {
  private spaces = new Map<string, Space>();
  private members: SpaceMember[] = [];
  private bots = new Map<string, Bot>();
  private chatById = new Map<string, Chat>();
  private messagesByChat = new Map<string, Message[]>();
  private primaryByOwner = new Map<string, string>();
  private personalSpaceByOwner = new Map<string, string>();

  async ensureBootstrap(ownerId: string): Promise<{ space: Space; primary: Bot }> {
    const spaceId = this.personalSpaceByOwner.get(ownerId);
    let space = spaceId ? this.spaces.get(spaceId) : undefined;
    if (!space) {
      space = await this.createSpace({ name: DEFAULT_SPACE_NAME, ownerId });
      this.personalSpaceByOwner.set(ownerId, space.id);
    }

    const primaryId = this.primaryByOwner.get(ownerId);
    let primary = primaryId ? this.bots.get(primaryId) : undefined;
    if (!primary) {
      primary = await this.createBot({
        name: PRIMARY_NAME,
        spaceId: space.id,
        ownerId,
        avatarLabel: 'P',
        isPrimary: true,
      });
      this.primaryByOwner.set(ownerId, primary.id);
    }

    return { space, primary };
  }

  async ensurePrimaryBot(): Promise<Bot> {
    const { primary } = await this.ensureBootstrap('workspace-user');
    return primary;
  }

  async listSpaces(ownerId: string): Promise<Space[]> {
    return [...this.spaces.values()]
      .filter(
        (space) => space.ownerId === ownerId || this.members.some((m) => m.spaceId === space.id && m.userId === ownerId)
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async createSpace(input: CreateSpaceInput): Promise<Space> {
    const name = input.name.trim();
    if (!name) throw new Error('Space name is required');
    const space: Space = {
      id: randomUUID(),
      name,
      ownerId: input.ownerId,
      createdAt: nowIso(),
    };
    this.spaces.set(space.id, space);
    this.members.push({ spaceId: space.id, userId: input.ownerId, role: 'admin' });
    return space;
  }

  async getSpace(spaceId: string): Promise<Space | null> {
    return this.spaces.get(spaceId) ?? null;
  }

  async listSpaceMembers(spaceId: string): Promise<SpaceMember[]> {
    if (!this.spaces.has(spaceId)) throw new Error('Space not found');
    return this.members.filter((m) => m.spaceId === spaceId);
  }

  async addSpaceMember(spaceId: string, userId: string, role: SpaceRole): Promise<SpaceMember> {
    if (!this.spaces.has(spaceId)) throw new Error('Space not found');
    const existing = this.members.find((m) => m.spaceId === spaceId && m.userId === userId);
    if (existing) {
      existing.role = role;
      return existing;
    }
    const member: SpaceMember = { spaceId, userId, role };
    this.members.push(member);
    return member;
  }

  async removeSpaceMember(spaceId: string, userId: string): Promise<void> {
    if (!this.spaces.has(spaceId)) throw new Error('Space not found');
    this.members = this.members.filter((m) => !(m.spaceId === spaceId && m.userId === userId));
  }

  async listBots(options?: ListBotsOptions): Promise<Bot[]> {
    if (options?.ownerId) {
      await this.ensureBootstrap(options.ownerId);
    } else {
      await this.ensurePrimaryBot();
    }
    const archived = options?.archived ?? 'active';
    let bots = [...this.bots.values()];
    if (options?.spaceId !== undefined) {
      bots = bots.filter((bot) => bot.spaceId === options.spaceId);
    }
    if (options?.ownerId) {
      const ownerId = options.ownerId;
      const accessibleSpaceIds = new Set(
        [...this.spaces.values()]
          .filter((space) => canViewerAccessSpace(space, this.members, ownerId))
          .map((space) => space.id)
      );
      bots = bots.filter((bot) => isBotVisibleToViewer(bot, ownerId, accessibleSpaceIds));
    }
    if (archived === 'active') {
      bots = bots.filter((bot) => bot.archivedAt == null);
    } else if (archived === 'archived') {
      bots = bots.filter((bot) => bot.archivedAt != null);
    }
    const sorted = bots.sort(sortBots);
    if (options?.ownerId) {
      const ownerId = options.ownerId;
      return sorted.map((bot) => ({
        ...bot,
        lastPreview:
          this.chatsFor(bot.id, ownerId).find((chat) => chat.lastPreview)?.lastPreview ??
          (bot.ownerId === ownerId ? (bot.lastPreview ?? '') : ''),
      }));
    }
    return sorted;
  }

  async listMarketplaceBots(): Promise<Bot[]> {
    return [...this.bots.values()]
      .filter((bot) => bot.archivedAt == null && !bot.isPrimary && Boolean(bot.isShared))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((bot) => ({ ...bot, lastPreview: '' }));
  }

  private nextSortOrder(spaceId: string | null, ownerId: string): number {
    const siblings = [...this.bots.values()].filter(
      (bot) =>
        (spaceId !== null ? bot.spaceId === spaceId : bot.ownerId === ownerId && bot.spaceId === null) &&
        !bot.isPrimary &&
        bot.archivedAt == null
    );
    if (siblings.length === 0) return 0;
    return Math.max(...siblings.map((bot) => bot.sortOrder)) + 1;
  }

  async createBot(input: CreateBotInput): Promise<Bot> {
    const name = input.name.trim();
    if (!name) throw new Error('Bot name is required');
    if (input.spaceId) {
      const space = this.spaces.get(input.spaceId);
      if (!space) throw new Error('Space not found');
    }
    const bot: Bot = {
      id: randomUUID(),
      name,
      avatarLabel: input.avatarLabel?.trim() || avatarFromName(name),
      presence: 'online',
      spaceId: input.spaceId ?? null,
      isPrimary: Boolean(input.isPrimary),
      isShared: Boolean(!input.isPrimary && input.isShared),
      description: input.description?.trim() ?? '',
      sourceBotId: input.sourceBotId ?? null,
      ownerId: input.ownerId,
      sortOrder: input.isPrimary ? -1 : this.nextSortOrder(input.spaceId ?? null, input.ownerId),
      archivedAt: null,
      createdAt: nowIso(),
      lastPreview: '',
    };
    this.bots.set(bot.id, bot);
    if (bot.isPrimary) {
      this.primaryByOwner.set(input.ownerId, bot.id);
    }
    return bot;
  }

  async updateBot(botId: string, input: UpdateBotInput): Promise<Bot> {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error('Bot not found');
    if (input.spaceId !== undefined && input.spaceId !== null) {
      if (!this.spaces.has(input.spaceId)) throw new Error('Space not found');
    }
    const name = input.name !== undefined ? input.name.trim() : bot.name;
    if (!name) throw new Error('Bot name is required');
    const avatarLabel = updatedAvatarLabel(bot.avatarLabel, input, name);
    if (input.isShared !== undefined) {
      if (bot.isPrimary && input.isShared) {
        throw new Error('Cannot share the Primary bot');
      }
    }
    let spaceId = bot.spaceId;
    let sortOrder = bot.sortOrder;
    if (input.spaceId !== undefined && input.spaceId !== bot.spaceId) {
      if (bot.isPrimary) throw new Error('Cannot move the Primary bot');
      spaceId = input.spaceId;
      sortOrder = this.nextSortOrder(spaceId, bot.ownerId);
    }
    const isShared = input.isShared !== undefined ? Boolean(input.isShared) : bot.isShared;
    const description = input.description !== undefined ? input.description.trim() : bot.description;
    const updated: Bot = {
      ...bot,
      name,
      avatarLabel,
      spaceId,
      sortOrder,
      isShared,
      description,
    };
    this.bots.set(botId, updated);
    return updated;
  }

  async moveBot(botId: string, input: MoveBotInput): Promise<Bot> {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error('Bot not found');
    if (bot.isPrimary) throw new Error('Cannot move the Primary bot');
    if (bot.archivedAt) throw new Error('Unarchive the bot before moving it');
    if (input.spaceId !== null && !this.spaces.has(input.spaceId)) {
      throw new Error('Space not found');
    }
    if (!Number.isInteger(input.index) || input.index < 0) {
      throw new Error('index must be a non-negative integer');
    }

    const siblings = [...this.bots.values()]
      .filter(
        (row) =>
          (input.spaceId !== null
            ? row.spaceId === input.spaceId
            : row.ownerId === bot.ownerId && row.spaceId === null) &&
          !row.isPrimary &&
          row.archivedAt == null &&
          row.id !== bot.id
      )
      .sort(sortBots);

    const clamped = Math.min(input.index, siblings.length);
    siblings.splice(clamped, 0, { ...bot, spaceId: input.spaceId });
    siblings.forEach((row, index) => {
      this.bots.set(row.id, { ...row, spaceId: input.spaceId, sortOrder: index });
    });
    return this.bots.get(botId)!;
  }

  async archiveBot(botId: string): Promise<Bot> {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error('Bot not found');
    if (bot.isPrimary) throw new Error('Cannot archive the Primary bot');
    if (bot.archivedAt) return bot;
    const updated: Bot = { ...bot, archivedAt: nowIso() };
    this.bots.set(botId, updated);
    return updated;
  }

  async unarchiveBot(botId: string): Promise<Bot> {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error('Bot not found');
    if (!bot.archivedAt) return bot;
    const updated: Bot = {
      ...bot,
      archivedAt: null,
      sortOrder: this.nextSortOrder(bot.spaceId, bot.ownerId),
    };
    this.bots.set(botId, updated);
    return updated;
  }

  async deleteBot(botId: string): Promise<void> {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error('Bot not found');
    if (bot.isPrimary) throw new Error('Cannot delete the Primary bot');
    for (const chat of [...this.chatById.values()]) {
      if (chat.botId === botId) {
        this.messagesByChat.delete(chat.id);
        this.chatById.delete(chat.id);
      }
    }
    this.bots.delete(botId);
  }

  async getBot(botId: string): Promise<Bot | null> {
    return this.bots.get(botId) ?? null;
  }

  /** The user's active chats, most recently active first. */
  private chatsOf(userId: string): Chat[] {
    return [...this.chatById.values()]
      .filter((chat) => chat.userId === userId && !chat.archivedAt)
      .reverse() // newest insert wins an updatedAt tie
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** The user's active chats with the bot, most recently active first. */
  private chatsFor(botId: string, userId: string): Chat[] {
    return this.chatsOf(userId).filter((chat) => chat.botId === botId);
  }

  private insertChat(botId: string, userId: string, fields: Partial<Chat> & { title: string }): Chat {
    const createdAt = nowIso();
    const chat: Chat = {
      id: randomUUID(),
      botId,
      userId,
      kind: 'user',
      archivedAt: null,
      createdAt,
      updatedAt: createdAt,
      lastPreview: '',
      ...fields,
    };
    this.chatById.set(chat.id, chat);
    this.messagesByChat.set(chat.id, []);
    return chat;
  }

  private requireBotAndUser(botId: string, userId?: string): { bot: Bot; userId: string } {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error('Bot not found');
    return { bot, userId: userId?.trim() || bot.ownerId || 'workspace-user' };
  }

  async getDefaultChat(botId: string, userId?: string): Promise<Chat> {
    const { bot, userId: resolved } = this.requireBotAndUser(botId, userId);
    const existing = this.chatsFor(botId, resolved).find((chat) => chat.kind === 'user');
    return existing ?? this.insertChat(botId, resolved, { title: bot.name });
  }

  async listChats(botId: string, userId: string): Promise<Chat[]> {
    return this.chatsFor(botId, userId);
  }

  listUserChats(userId: string): Promise<Chat[]> {
    return Promise.resolve(this.chatsOf(userId));
  }

  async createChat(botId: string, userId: string, title?: string): Promise<Chat> {
    this.requireBotAndUser(botId);
    return this.insertChat(botId, userId, { title: title?.trim() || DEFAULT_CHAT_TITLE });
  }

  async renameChat(chatId: string, title: string): Promise<Chat> {
    const chat = this.chatById.get(chatId);
    if (!chat) throw new Error('Chat not found');
    chat.title = title.trim() || chat.title;
    return chat;
  }

  async archiveChat(chatId: string): Promise<Chat> {
    const chat = this.chatById.get(chatId);
    if (!chat) throw new Error('Chat not found');
    chat.archivedAt ??= nowIso();
    return chat;
  }

  archiveRoutineChat(routineId: string): Promise<void> {
    for (const chat of this.chatById.values()) {
      if (chat.routineId === routineId && chat.kind === 'routine') chat.archivedAt ??= nowIso();
    }
    return Promise.resolve();
  }

  async getRoutineChat(routine: { id: string; botId: string; ownerId: string; name: string }): Promise<Chat> {
    const existing = [...this.chatById.values()].find((chat) => chat.routineId === routine.id);
    return (
      existing ??
      this.insertChat(routine.botId, routine.ownerId, {
        title: `Routine: ${routine.name}`,
        kind: 'routine',
        routineId: routine.id,
      })
    );
  }

  async getHandoffChat(botId: string, userId: string): Promise<Chat> {
    const { bot, userId: resolved } = this.requireBotAndUser(botId, userId);
    const existing = [...this.chatById.values()].find(
      (chat) => chat.botId === botId && chat.userId === resolved && chat.kind === 'handoff'
    );
    return existing ?? this.insertChat(botId, resolved, { title: `${bot.name} (handoffs)`, kind: 'handoff' });
  }

  async getChat(chatId: string): Promise<Chat | null> {
    return this.chatById.get(chatId) ?? null;
  }

  async findBotIdForChat(chatId: string): Promise<string | null> {
    return this.chatById.get(chatId)?.botId ?? null;
  }

  async listMessages(chatId: string): Promise<Message[]> {
    const messages = this.messagesByChat.get(chatId);
    if (!messages) {
      throw new Error('Chat not found');
    }
    return [...messages];
  }

  searchMessages(
    userId: string,
    query: string,
    { botId, limit = SEARCH_LIMIT }: { botId?: string; limit?: number } = {}
  ): Promise<SearchHit[]> {
    const terms = searchTerms(query);
    if (terms.length === 0) return Promise.resolve([]);
    const hits: SearchHit[] = [];
    for (const chat of this.chatsOf(userId)) {
      if (botId && chat.botId !== botId) continue;
      const match = [...(this.messagesByChat.get(chat.id) ?? [])]
        .reverse()
        .find(
          (message) =>
            (message.role === 'user' || message.role === 'assistant') &&
            terms.every((term) => message.content.toLowerCase().includes(term))
        );
      if (!match) continue;
      hits.push({
        chatId: chat.id,
        botId: chat.botId,
        chatTitle: chat.title,
        messageId: match.id,
        role: match.role as SearchHit['role'],
        snippet: snippetAround(match.content, query),
        createdAt: match.createdAt,
      });
    }
    return Promise.resolve(hits.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit));
  }

  async addMessage(
    chatId: string,
    role: MessageRole,
    content: string,
    options?: { toolCallId?: string; toolCalls?: ToolCall[]; runId?: string }
  ): Promise<Message> {
    const trimmed = content.trim();
    if (!trimmed && role !== 'assistant') {
      throw new Error('Message content is required');
    }

    const messages = this.messagesByChat.get(chatId);
    if (!messages) {
      throw new Error('Chat not found');
    }

    const message: Message = {
      id: randomUUID(),
      chatId,
      role,
      content: trimmed,
      createdAt: nowIso(),
      toolCallId: options?.toolCallId,
      toolCalls: options?.toolCalls?.length ? options.toolCalls : undefined,
      runId: options?.runId,
    };
    messages.push(message);

    const preview = messagePreviewLine({ role, content: trimmed });
    const chat = this.chatById.get(chatId);
    if (chat) {
      chat.updatedAt = message.createdAt;
      if (preview !== null) {
        chat.lastPreview = preview;
        const bot = this.bots.get(chat.botId);
        if (bot && chat.userId === bot.ownerId) {
          this.bots.set(chat.botId, { ...bot, lastPreview: preview });
        }
      }
    }

    return message;
  }
}
