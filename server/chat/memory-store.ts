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

const PRIMARY_NAME = 'Primary';
const DEFAULT_SPACE_NAME = 'Personal';

function nowIso(): string {
  return new Date().toISOString();
}

function avatarFromName(name: string): string {
  const trimmed = name.trim();
  return (trimmed[0] ?? '?').toUpperCase();
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

  async listBots(options?: { spaceId?: string | null; ownerId?: string }): Promise<Bot[]> {
    if (options?.ownerId) {
      await this.ensureBootstrap(options.ownerId);
    } else {
      await this.ensurePrimaryBot();
    }
    let bots = [...this.bots.values()];
    if (options?.spaceId !== undefined) {
      bots = bots.filter((bot) => bot.spaceId === options.spaceId);
    }
    if (options?.ownerId) {
      bots = bots.filter((bot) => bot.ownerId === options.ownerId);
    }
    return bots.sort((a, b) => {
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
      return a.createdAt.localeCompare(b.createdAt);
    });
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
      createdAt: nowIso(),
    };
    this.bots.set(bot.id, bot);
    if (bot.isPrimary) {
      this.primaryByOwner.set(input.ownerId, bot.id);
    }
    return bot;
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
