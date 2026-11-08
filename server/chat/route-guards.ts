import type { Request, Response } from 'express';
import type { Bot, ChatStore } from '../../shared/chat/types.js';
import { canViewerAccessSpace } from './access-policy.js';
import { resolveOwnerId } from './identity.js';

type AccessStore = Pick<ChatStore, 'getBot' | 'getSpace' | 'listSpaceMembers'>;

async function spaceAccess(
  store: AccessStore,
  spaceId: string,
  viewerId: string
): Promise<'ok' | 'missing' | 'forbidden'> {
  const space = await store.getSpace(spaceId);
  if (!space) return 'missing';
  const members = await store.listSpaceMembers(spaceId);
  return canViewerAccessSpace(space, members, viewerId) ? 'ok' : 'forbidden';
}

/** True when the caller may use the space; otherwise responds 404/403 and returns false. */
export async function requireSpaceAccess(
  store: AccessStore,
  spaceId: string,
  callerId: string,
  res: Response
): Promise<boolean> {
  const access = await spaceAccess(store, spaceId, callerId);
  if (access === 'missing') res.status(404).json({ error: 'Space not found' });
  if (access === 'forbidden') res.status(403).json({ error: 'Forbidden' });
  return access === 'ok';
}

/**
 * The owner, or a member of the space holding a shared non-Primary bot, may use it.
 * Otherwise responds 404/403 and returns null.
 */
export async function requireBotAccess(
  store: AccessStore,
  botId: string,
  req: Request,
  res: Response
): Promise<{ bot: Bot; callerId: string } | null> {
  const bot = await store.getBot(botId);
  if (!bot) {
    res.status(404).json({ error: 'Bot not found' });
    return null;
  }
  const callerId = resolveOwnerId(req);
  if (bot.ownerId === callerId) return { bot, callerId };
  if (!bot.isPrimary && bot.isShared && bot.spaceId && (await spaceAccess(store, bot.spaceId, callerId)) === 'ok') {
    return { bot, callerId };
  }
  res.status(403).json({ error: 'Forbidden' });
  return null;
}
