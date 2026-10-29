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
  Presence,
  Space,
  SpaceMember,
  SpaceRole,
  UpdateBotInput,
} from '../../shared/chat/types.js';
import type { ToolCall } from '../../shared/agents/types.js';

const PRIMARY_NAME = 'Primary';
const DEFAULT_SPACE_NAME = 'Personal';

function nowIso(): string {
  return new Date().toISOString();
}

function avatarFromName(name: string): string {
  const trimmed = name.trim();
  return (trimmed[0] ?? '?').toUpperCase();
}

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
  private chatsByBot = new Map<string, Chat>();
  private messagesByChat = new Map<string, Message[]>();
  private primaryByOwner = new Map<string, string>();
  private personalSpaceByOwner = new Map<string, string>();

  async ensureBootstrap(ownerId: string): Promise<{ space: Space; primary: Bot }> {
    let spaceId = this.personalSpaceByOwner.get(ownerId);
    let space = spaceId ? this.spaces.get(spaceId) : undefined;
    if (!space) {
      space = await this.createSpace({ name: DEFAULT_SPACE_NAME, ownerId });
      this.personalSpaceByOwner.set(ownerId, space.id);
    }

    let primaryId = this.primaryByOwner.get(ownerId);
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
        (space) =>
          space.ownerId === ownerId ||
          this.members.some((m) => m.spaceId === space.id && m.userId === ownerId),
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
      bots = bots.filter((bot) => bot.ownerId === options.ownerId);
    }
    if (archived === 'active') {
      bots = bots.filter((bot) => bot.archivedAt == null);
    } else if (archived === 'archived') {
      bots = bots.filter((bot) => bot.archivedAt != null);
    }
    return bots.sort(sortBots);
  }

  private nextSortOrder(spaceId: string | null, ownerId: string): number {
    const siblings = [...this.bots.values()].filter(
      (bot) =>
        bot.ownerId === ownerId &&
        bot.spaceId === spaceId &&
        !bot.isPrimary &&
        bot.archivedAt == null,
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
      ownerId: input.ownerId,
      sortOrder: input.isPrimary ? -1 : this.nextSortOrder(input.spaceId ?? null, input.ownerId),
      archivedAt: null,
      createdAt: nowIso(),
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
    const avatarLabel =
      input.avatarLabel !== undefined
        ? input.avatarLabel.trim() || avatarFromName(name)
        : input.name !== undefined
          ? bot.avatarLabel.length === 1
            ? avatarFromName(name)
            : bot.avatarLabel
          : bot.avatarLabel;
    let spaceId = bot.spaceId;
    let sortOrder = bot.sortOrder;
    if (input.spaceId !== undefined && input.spaceId !== bot.spaceId) {
      if (bot.isPrimary) throw new Error('Cannot move the Primary bot');
      spaceId = input.spaceId;
      sortOrder = this.nextSortOrder(spaceId, bot.ownerId);
    }
    const updated: Bot = { ...bot, name, avatarLabel, spaceId, sortOrder };
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
          row.ownerId === bot.ownerId &&
          row.spaceId === input.spaceId &&
          !row.isPrimary &&
          row.archivedAt == null &&
          row.id !== bot.id,
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
    const chat = this.chatsByBot.get(botId);
    if (chat) {
      this.messagesByChat.delete(chat.id);
      this.chatsByBot.delete(botId);
    }
    this.bots.delete(botId);
  }

  async getBot(botId: string): Promise<Bot | null> {
    return this.bots.get(botId) ?? null;
  }

  async setBotPresence(botId: string, presence: Presence): Promise<Bot> {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error('Bot not found');
    const updated = { ...bot, presence };
    this.bots.set(botId, updated);
    return updated;
  }

  async getOrCreateChatForBot(botId: string): Promise<Chat> {
    const bot = this.bots.get(botId);
    if (!bot) {
      throw new Error('Bot not found');
    }

    const existing = this.chatsByBot.get(botId);
    if (existing) return existing;

    const createdAt = nowIso();
    const chat: Chat = {
      id: randomUUID(),
      botId,
      title: bot.name,
      createdAt,
      updatedAt: createdAt,
    };
    this.chatsByBot.set(botId, chat);
    this.messagesByChat.set(chat.id, []);
    return chat;
  }

  async findBotIdForChat(chatId: string): Promise<string | null> {
    for (const [botId, chat] of this.chatsByBot) {
      if (chat.id === chatId) return botId;
    }
    return null;
  }

  async listMessages(chatId: string): Promise<Message[]> {
    const messages = this.messagesByChat.get(chatId);
    if (!messages) {
      throw new Error('Chat not found');
    }
    return [...messages];
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
    };
    messages.push(message);

    for (const chat of this.chatsByBot.values()) {
      if (chat.id === chatId) {
        chat.updatedAt = message.createdAt;
        break;
      }
    }

    return message;
  }
}
