import type { Request, Response } from 'express';
import { z } from 'zod';
import type { Bot, ChatStore } from '../../../shared/chat/types.js';
import type { MemorySkillStore } from '../../../shared/agents/memory/types.js';
import { canViewerAccessSpace } from '../../chat/access-policy.js';
import { resolveOwnerId } from '../../chat/identity.js';
import type { ChatHttpApp } from '../../chat/routes.js';

const upsertMemorySchema = z.object({
  key: z.string().trim().min(1).max(128),
  content: z.string().trim().min(1).max(8_000),
});

const createSkillSchema = z.object({
  name: z.string().trim().min(1).max(64),
  body: z.string().trim().min(1).max(16_000),
});

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Unexpected error';
}

function isNotFound(err: unknown): boolean {
  return err instanceof Error && /not found/i.test(err.message);
}

function isConflict(err: unknown): boolean {
  return err instanceof Error && /already exists/i.test(err.message);
}

function isBadRequest(err: unknown): boolean {
  return err instanceof Error && /required/i.test(err.message);
}

async function assertBotAccess(
  chats: ChatStore,
  botId: string,
  req: Request,
  res: Response
): Promise<{ bot: Bot; callerId: string } | null> {
  const bot = await chats.getBot(botId);
  if (!bot) {
    res.status(404).json({ error: 'Bot not found' });
    return null;
  }
  const callerId = resolveOwnerId(req);
  if (bot.ownerId === callerId) {
    return { bot, callerId };
  }
  if (bot.isPrimary || !bot.isShared || !bot.spaceId) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }
  const space = await chats.getSpace(bot.spaceId);
  if (!space) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }
  const members = await chats.listSpaceMembers(bot.spaceId);
  if (!canViewerAccessSpace(space, members, callerId)) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }
  return { bot, callerId };
}

/** Register per-bot memory upsert and skill CRUD on the chat app. */
export function registerMemoryRoutes(app: ChatHttpApp, chats: ChatStore, memory: MemorySkillStore): void {
  app.get('/api/bots/:botId/memories', async (req: Request, res: Response) => {
    try {
      const access = await assertBotAccess(chats, String(req.params.botId), req, res);
      if (!access) return;
      const memories = await memory.listMemories(access.bot.id, access.callerId);
      res.json({ memories });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  app.put('/api/bots/:botId/memories', async (req: Request, res: Response) => {
    const parsed = upsertMemorySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Memory key and content are required' });
      return;
    }
    try {
      const access = await assertBotAccess(chats, String(req.params.botId), req, res);
      if (!access) return;
      const entry = await memory.upsertMemory(access.bot.id, parsed.data.key, parsed.data.content, access.callerId);
      res.json({ memory: entry });
    } catch (err) {
      const status = isNotFound(err) ? 404 : isBadRequest(err) ? 400 : 500;
      res.status(status).json({ error: errorMessage(err) });
    }
  });

  app.get('/api/bots/:botId/skills', async (req: Request, res: Response) => {
    try {
      const access = await assertBotAccess(chats, String(req.params.botId), req, res);
      if (!access) return;
      const skills = await memory.listSkills(access.bot.id);
      res.json({ skills });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  app.post('/api/bots/:botId/skills', async (req: Request, res: Response) => {
    const parsed = createSkillSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Skill name and body are required' });
      return;
    }
    try {
      const access = await assertBotAccess(chats, String(req.params.botId), req, res);
      if (!access) return;
      if (access.bot.ownerId !== access.callerId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      const skill = await memory.createSkill(access.bot.id, parsed.data.name, parsed.data.body);
      res.status(201).json({ skill });
    } catch (err) {
      const status = isNotFound(err) ? 404 : isConflict(err) ? 409 : isBadRequest(err) ? 400 : 500;
      res.status(status).json({ error: errorMessage(err) });
    }
  });

  app.delete('/api/bots/:botId/skills/:skillId', async (req: Request, res: Response) => {
    try {
      const access = await assertBotAccess(chats, String(req.params.botId), req, res);
      if (!access) return;
      if (access.bot.ownerId !== access.callerId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      await memory.deleteSkill(access.bot.id, String(req.params.skillId));
      res.status(204).end();
    } catch (err) {
      const status = isNotFound(err) ? 404 : 500;
      res.status(status).json({ error: errorMessage(err) });
    }
  });
}
