/** Domain types for durable chat, Spaces, and multi-bot roster. */

import type { ToolCall } from '../llm/types.js';

export type Presence = 'online' | 'away' | 'offline' | 'thinking' | 'working';

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export type SpaceRole = 'viewer' | 'member' | 'admin';

export interface Space {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
}

export interface SpaceMember {
  spaceId: string;
  userId: string;
  role: SpaceRole;
}

export interface Bot {
  id: string;
  name: string;
  avatarLabel: string;
  presence: Presence;
  spaceId: string | null;
  isPrimary: boolean;
  ownerId: string;
  createdAt: string;
}

export interface Chat {
  id: string;
  botId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  chatId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  toolCallId?: string;
  /** Assistant turns that issued tools; required for OpenAI-compatible replay. */
  toolCalls?: ToolCall[];
}

export interface CreateBotInput {
  name: string;
  spaceId?: string | null;
  ownerId: string;
  avatarLabel?: string;
  isPrimary?: boolean;
}

export interface CreateSpaceInput {
  name: string;
  ownerId: string;
}

export interface ChatStore {
  ensureBootstrap(ownerId: string): Promise<{ space: Space; primary: Bot }>;
  listSpaces(ownerId: string): Promise<Space[]>;
  createSpace(input: CreateSpaceInput): Promise<Space>;
  getSpace(spaceId: string): Promise<Space | null>;
  listSpaceMembers(spaceId: string): Promise<SpaceMember[]>;
  addSpaceMember(spaceId: string, userId: string, role: SpaceRole): Promise<SpaceMember>;
  listBots(options?: { spaceId?: string | null; ownerId?: string }): Promise<Bot[]>;
  createBot(input: CreateBotInput): Promise<Bot>;
  getBot(botId: string): Promise<Bot | null>;
  setBotPresence(botId: string, presence: Presence): Promise<Bot>;
  /** @deprecated Prefer ensureBootstrap — kept for older call sites during Phase 3. */
  ensurePrimaryBot(): Promise<Bot>;
  getOrCreateChatForBot(botId: string): Promise<Chat>;
  findBotIdForChat(chatId: string): Promise<string | null>;
  listMessages(chatId: string): Promise<Message[]>;
  addMessage(
    chatId: string,
    role: MessageRole,
    content: string,
    options?: { toolCallId?: string; toolCalls?: ToolCall[] },
  ): Promise<Message>;
}
