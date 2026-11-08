import type { Request, Response } from 'express';
import { z } from 'zod';
import type { ChatStore } from '../../../shared/chat/types.js';
import type { MemorySkillStore } from '../../../shared/agents/memory/types.js';
import { requireBotAccess } from '../../chat/route-guards.js';
import { createErrorResponder } from '../../lib/http.js';
import type { ChatHttpApp } from '../../chat/routes.js';
import { importSkillFromUrl } from './skill-import.js';
import { loadBundledSkillPack } from './skill-packs.js';

const upsertMemorySchema = z.object({
  key: z.string().trim().min(1).max(128),
  content: z.string().trim().min(1).max(8_000),
});

const importSkillSchema = z.object({
  url: z.string().trim().max(2_000).optional(),
  pack: z.string().trim().max(128).optional(),
});

const createSkillSchema = z.object({
  name: z.string().trim().min(1).max(64),
  body: z.string().trim().min(1).max(32_000),
});

const sendError = createErrorResponder([
  [409, /already exists/i],
  [400, /required/i],
]);

/** Register per-bot memory upsert and skill CRUD on the chat app. */
export function registerMemoryRoutes(
  app: ChatHttpApp,
  chats: ChatStore,
  memory: MemorySkillStore,
  options: { fetchImpl?: typeof fetch } = {}
): void {
  app.get('/api/bots/:botId/memories', async (req: Request, res: Response) => {
    try {
      const access = await requireBotAccess(chats, String(req.params.botId), req, res);
      if (!access) return;
      const memories = await memory.listMemories(access.bot.id, access.callerId);
      res.json({ memories });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.put('/api/bots/:botId/memories', async (req: Request, res: Response) => {
    const parsed = upsertMemorySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Memory key and content are required' });
      return;
    }
    try {
      const access = await requireBotAccess(chats, String(req.params.botId), req, res);
      if (!access) return;
      const entry = await memory.upsertMemory(access.bot.id, parsed.data.key, parsed.data.content, access.callerId);
      res.json({ memory: entry });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get('/api/bots/:botId/skills', async (req: Request, res: Response) => {
    try {
      const access = await requireBotAccess(chats, String(req.params.botId), req, res);
      if (!access) return;
      const skills = await memory.listSkills(access.bot.id);
      res.json({ skills });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/bots/:botId/skills', async (req: Request, res: Response) => {
    const parsed = createSkillSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Skill name and body are required' });
      return;
    }
    try {
      const access = await requireBotAccess(chats, String(req.params.botId), req, res);
      if (!access) return;
      if (access.bot.ownerId !== access.callerId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      const skill = await memory.createSkill(access.bot.id, parsed.data.name, parsed.data.body);
      res.status(201).json({ skill });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/bots/:botId/skills/import', async (req: Request, res: Response) => {
    const parsed = importSkillSchema.safeParse(req.body);
    const url = parsed.success ? parsed.data.url?.trim() : '';
    const packName = parsed.success ? parsed.data.pack?.trim() : '';
    if (!url && !packName) {
      res.status(400).json({ error: 'Skill URL or pack name is required' });
      return;
    }
    try {
      const access = await requireBotAccess(chats, String(req.params.botId), req, res);
      if (!access) return;
      if (access.bot.ownerId !== access.callerId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      if (packName) {
        const pack = await loadBundledSkillPack(packName);
        if (!pack) {
          res.status(404).json({ error: `Skill pack not found: ${packName}` });
          return;
        }
        const skill = await memory.upsertSkill(access.bot.id, pack.entry.name, pack.body);
        res.status(201).json({ skill });
        return;
      }
      const imported = await importSkillFromUrl(url!, options.fetchImpl);
      const skill = await memory.upsertSkill(access.bot.id, imported.name, imported.body);
      res.status(201).json({ skill });
    } catch (err) {
      sendError(res, err, 400);
    }
  });

  app.delete('/api/bots/:botId/skills/:skillId', async (req: Request, res: Response) => {
    try {
      const access = await requireBotAccess(chats, String(req.params.botId), req, res);
      if (!access) return;
      if (access.bot.ownerId !== access.callerId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      await memory.deleteSkill(access.bot.id, String(req.params.skillId));
      res.status(204).end();
    } catch (err) {
      sendError(res, err);
    }
  });
}
