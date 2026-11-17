import type { Bot, ChatStore, Space, SpaceMember } from '../../shared/chat/types.js';

type SpacePolicy = (
  space: Pick<Space, 'id' | 'ownerId'>,
  members: ReadonlyArray<Pick<SpaceMember, 'spaceId' | 'userId' | 'role'>>,
  viewerId: string
) => boolean;

export function canViewerAccessSpace(
  space: Pick<Space, 'id' | 'ownerId'>,
  members: ReadonlyArray<Pick<SpaceMember, 'spaceId' | 'userId'>>,
  viewerId: string
): boolean {
  if (space.ownerId === viewerId) return true;
  return members.some((m) => m.spaceId === space.id && m.userId === viewerId);
}

/** Owner, admins, and members may use shared bots; viewers only see them. */
export function canUseSpaceBots(
  space: Pick<Space, 'id' | 'ownerId'>,
  members: ReadonlyArray<Pick<SpaceMember, 'spaceId' | 'userId' | 'role'>>,
  viewerId: string
): boolean {
  if (space.ownerId === viewerId) return true;
  return members.some((m) => m.spaceId === space.id && m.userId === viewerId && m.role !== 'viewer');
}

/** Owner or space admin may invite / change roles. */
export function canManageSpaceMembers(
  space: Pick<Space, 'id' | 'ownerId'>,
  members: ReadonlyArray<Pick<SpaceMember, 'spaceId' | 'userId' | 'role'>>,
  viewerId: string
): boolean {
  if (space.ownerId === viewerId) return true;
  return members.some((m) => m.spaceId === space.id && m.userId === viewerId && m.role === 'admin');
}

export function isBotVisibleToViewer(
  bot: Pick<Bot, 'ownerId' | 'spaceId' | 'isPrimary'> & { isShared?: boolean },
  viewerId: string,
  accessibleSpaceIds: ReadonlySet<string>
): boolean {
  if (bot.ownerId === viewerId) return true;
  if (bot.isPrimary) return false;
  if (!bot.isShared) return false;
  return bot.spaceId !== null && accessibleSpaceIds.has(bot.spaceId);
}

type SpaceLookup = Pick<ChatStore, 'getSpace' | 'listSpaceMembers'>;

async function sharedBotAllows(store: SpaceLookup, bot: Bot, userId: string, policy: SpacePolicy): Promise<boolean> {
  if (bot.ownerId === userId) return true;
  if (bot.isPrimary || !bot.isShared || !bot.spaceId) return false;
  const space = await store.getSpace(bot.spaceId);
  if (!space) return false;
  return policy(space, await store.listSpaceMembers(space.id), userId);
}

/** The owner, or anyone in the Space holding a shared non-Primary bot, may see it. */
export function canViewBot(store: SpaceLookup, bot: Bot, userId: string): Promise<boolean> {
  return sharedBotAllows(store, bot, userId, canViewerAccessSpace);
}

/** Like canViewBot, but Space viewers may not chat with, approve for, or schedule the bot. */
export function canUseBot(store: SpaceLookup, bot: Bot, userId: string): Promise<boolean> {
  return sharedBotAllows(store, bot, userId, canUseSpaceBots);
}

export function buildBotVisibilitySqlClause(ownerParamIndex: number): string {
  return `(owner_id = $${ownerParamIndex} OR (is_primary = FALSE AND is_shared = TRUE AND space_id IS NOT NULL AND EXISTS (SELECT 1 FROM bricksbot.spaces s LEFT JOIN bricksbot.space_members m ON m.space_id = s.id WHERE s.id = bricksbot.bots.space_id AND (s.owner_id = $${ownerParamIndex} OR m.user_id = $${ownerParamIndex}))))`;
}
