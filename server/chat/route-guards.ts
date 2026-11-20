import type { Request, Response } from 'express';
import type { Bot, Chat, ChatStore } from '../../shared/chat/types.js';
import { canUseBot, canViewBot, canViewerAccessSpace } from './access-policy.js';
import { resolveOwnerId } from './identity.js';

type AccessStore = Pick<ChatStore, 'getBot' | 'getSpace' | 'listSpaceMembers'>;
type ChatAccessStore = AccessStore & Pick<ChatStore, 'getChat'>;

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
 * The owner, or a member of the space holding a shared non-Primary bot, may see it.
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
  if (await canViewBot(store, bot, callerId)) return { bot, callerId };
  res.status(403).json({ error: 'Forbidden' });
  return null;
}

/** Like requireBotAccess, but Space viewers are refused: use it before running a bot turn. */
export async function requireBotUse(
  store: AccessStore,
  botId: string,
  req: Request,
  res: Response
): Promise<{ bot: Bot; callerId: string } | null> {
  const access = await requireBotAccess(store, botId, req, res);
  if (!access) return null;
  if (await canUseBot(store, access.bot, access.callerId)) return access;
  res.status(403).json({ error: 'Space viewers can see this bot but not chat with it' });
  return null;
}

/** The caller's own chat. Otherwise responds 404/403 and returns null. */
export async function requireChatOwnership(
  store: ChatAccessStore,
  chatId: string,
  req: Request,
  res: Response
): Promise<Chat | null> {
  const chat = await store.getChat(chatId);
  if (!chat) {
    res.status(404).json({ error: 'Chat not found' });
    return null;
  }
  if (!chat.userId || chat.userId !== resolveOwnerId(req)) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }
  return chat;
}

/** The caller's chat, provided they may still run its bot (not a viewer, still shared). */
export async function requireChatUse(
  store: ChatAccessStore,
  chatId: string,
  req: Request,
  res: Response
): Promise<Chat | null> {
  const chat = await requireChatOwnership(store, chatId, req, res);
  if (!chat) return null;
  return (await requireBotUse(store, chat.botId, req, res)) ? chat : null;
}
