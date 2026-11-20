/** Domain types for durable chat, Spaces, and multi-bot roster. */

import type { ToolCall } from '../agents/types.js';
import type { AttachmentRef } from './attachments.js';

export type Presence = 'online' | 'away' | 'offline' | 'thinking' | 'working' | 'waiting' | 'blocked';

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

export interface WorkspaceUser {
  id: string;
  userName: string;
  displayName: string;
  active: boolean;
}

export interface WorkspaceUserDirectory {
  searchUsers(query: string, limit?: number): Promise<WorkspaceUser[]>;
  findActiveUserByEmail(email: string): Promise<WorkspaceUser | null>;
}

export interface Bot {
  id: string;
  name: string;
  avatarLabel: string;
  presence: Presence;
  spaceId: string | null;
  isPrimary: boolean;
  isShared?: boolean;
  description?: string;
  sourceBotId?: string | null;
  ownerId: string;
  /** Catalog model id the owner picked; null or absent means the operator's default. */
  model?: string | null;
  /** Set by `GET /api/bots`: the caller owns this bot (and so may pick its model). */
  isOwner?: boolean;
  /** Lower sorts first within a section (and after Primary). */
  sortOrder: number;
  /** Soft-hide from roster (Grok “Hide from sidebar”); null when active. */
  archivedAt: string | null;
  createdAt: string;
  lastPreview?: string;
}

export interface MarketplaceBot {
  id: string;
  name: string;
  avatarLabel: string;
  description: string;
  ownerId: string;
  skillNames: string[];
  createdAt: string;
}

/** `user` chats are the ones people open and start; routine and handoff chats are made by the system. */
export type ChatKind = 'user' | 'routine' | 'handoff';

export interface Chat {
  id: string;
  botId: string;
  userId?: string;
  title: string;
  /** Absent means `user`. */
  kind?: ChatKind;
  /** Set on routine chats: one chat per routine. */
  routineId?: string;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  lastPreview?: string;
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
  /** The run that wrote this message, when it came from agent work. */
  runId?: string;
  /** Files the person attached to this (user) message. */
  attachments?: AttachmentRef[];
}

/** A conversation that matches a search, shown by its latest matching message. */
export interface SearchHit {
  chatId: string;
  botId: string;
  chatTitle: string;
  messageId: string;
  role: 'user' | 'assistant';
  /** The words around the match, on one line. */
  snippet: string;
  createdAt: string;
}

export interface CreateBotInput {
  name: string;
  spaceId?: string | null;
  ownerId: string;
  avatarLabel?: string;
  isPrimary?: boolean;
  description?: string;
  isShared?: boolean;
  sourceBotId?: string | null;
}

export interface UpdateBotInput {
  name?: string;
  avatarLabel?: string;
  spaceId?: string | null;
  description?: string;
  isShared?: boolean;
  /** Catalog model id, or null for the default. */
  model?: string | null;
}

export interface MoveBotInput {
  /** Target section; null = unsectioned. */
  spaceId: string | null;
  /** 0-based index among non-primary bots in that section (active roster only). */
  index: number;
}

export interface CreateSpaceInput {
  name: string;
  ownerId: string;
}

export interface ListBotsOptions {
  spaceId?: string | null;
  ownerId?: string;
  /** Default `active`. */
  archived?: 'active' | 'archived' | 'all';
}

export interface ChatStore {
  ensureBootstrap(ownerId: string): Promise<{ space: Space; primary: Bot }>;
  listSpaces(ownerId: string): Promise<Space[]>;
  createSpace(input: CreateSpaceInput): Promise<Space>;
  getSpace(spaceId: string): Promise<Space | null>;
  listSpaceMembers(spaceId: string): Promise<SpaceMember[]>;
  addSpaceMember(spaceId: string, userId: string, role: SpaceRole): Promise<SpaceMember>;
  removeSpaceMember(spaceId: string, userId: string): Promise<void>;
  listBots(options?: ListBotsOptions): Promise<Bot[]>;
  createBot(input: CreateBotInput): Promise<Bot>;
  updateBot(botId: string, input: UpdateBotInput): Promise<Bot>;
  moveBot(botId: string, input: MoveBotInput): Promise<Bot>;
  archiveBot(botId: string): Promise<Bot>;
  unarchiveBot(botId: string): Promise<Bot>;
  deleteBot(botId: string): Promise<void>;
  getBot(botId: string): Promise<Bot | null>;
  /** @deprecated Prefer ensureBootstrap — kept for older call sites during Phase 3. */
  ensurePrimaryBot(): Promise<Bot>;
  listMarketplaceBots(): Promise<Bot[]>;
  /** The user's most recently active chat with the bot; creates the first one. */
  getDefaultChat(botId: string, userId?: string): Promise<Chat>;
  /** Every active chat the user has with the bot (user, routine and handoff), newest first. */
  listChats(botId: string, userId: string): Promise<Chat[]>;
  /** Every active chat the user has, across bots, newest first. */
  listUserChats(userId: string): Promise<Chat[]>;
  createChat(botId: string, userId: string, title?: string): Promise<Chat>;
  renameChat(chatId: string, title: string): Promise<Chat>;
  archiveChat(chatId: string): Promise<Chat>;
  /** The one chat a routine runs in, created on first use. */
  getRoutineChat(routine: { id: string; botId: string; ownerId: string; name: string }): Promise<Chat>;
  /** Takes a deleted routine's chat off the lists; its history stays. */
  archiveRoutineChat(routineId: string): Promise<void>;
  /** The one chat where `userId`'s handoffs to the bot land, created on first use. */
  getHandoffChat(botId: string, userId: string): Promise<Chat>;
  getChat(chatId: string): Promise<Chat | null>;
  findBotIdForChat(chatId: string): Promise<string | null>;
  listMessages(chatId: string): Promise<Message[]>;
  /** The user's own active chats that mention every word of `query` (user and assistant text), newest first. */
  searchMessages(userId: string, query: string, options?: { botId?: string; limit?: number }): Promise<SearchHit[]>;
  addMessage(
    chatId: string,
    role: MessageRole,
    content: string,
    options?: { toolCallId?: string; toolCalls?: ToolCall[]; runId?: string; attachments?: AttachmentRef[] }
  ): Promise<Message>;
}
