import type { Bot, Space, SpaceMember } from '../../shared/chat/types.js';

export function canViewerAccessSpace(
  space: Pick<Space, 'id' | 'ownerId'>,
  members: ReadonlyArray<Pick<SpaceMember, 'spaceId' | 'userId'>>,
  viewerId: string,
): boolean {
  if (space.ownerId === viewerId) return true;
  return members.some((m) => m.spaceId === space.id && m.userId === viewerId);
}

export function isBotVisibleToViewer(
  bot: Pick<Bot, 'ownerId' | 'spaceId' | 'isPrimary'>,
  viewerId: string,
  accessibleSpaceIds: ReadonlySet<string>,
): boolean {
  if (bot.ownerId === viewerId) return true;
  if (bot.isPrimary) return false;
  return bot.spaceId !== null && accessibleSpaceIds.has(bot.spaceId);
}

export function buildBotVisibilitySqlClause(ownerParamIndex: number): string {
  return `(owner_id = $${ownerParamIndex} OR (is_primary = FALSE AND space_id IS NOT NULL AND EXISTS (SELECT 1 FROM bricksbot.spaces s LEFT JOIN bricksbot.space_members m ON m.space_id = s.id WHERE s.id = bricksbot.bots.space_id AND (s.owner_id = $${ownerParamIndex} OR m.user_id = $${ownerParamIndex}))))`;
}
