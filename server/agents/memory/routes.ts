import type { Request, Response } from 'express';
import { z } from 'zod';
import type { ChatStore } from '../../../shared/chat/types.js';
import type { MemorySkillStore } from '../../../shared/agents/memory/types.js';
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

async function requireBot(store: ChatStore, botId: string): Promise<boolean> {
  const bot = await store.getBot(botId);
  return Boolean(bot);
}

/** Register per-bot memory upsert and skill CRUD on the chat app. */
export function registerMemoryRoutes(app: ChatHttpApp, chats: ChatStore, memory: MemorySkillStore): void {
  app.get('/api/bots/:botId/memories', async (req: Request, res: Response) => {
    try {
      const botId = String(req.params.botId);
      if (!(await requireBot(chats, botId))) {
        res.status(404).json({ error: 'Bot not found' });
        return;
      }
      const memories = await memory.listMemories(botId);
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
      const botId = String(req.params.botId);
      if (!(await requireBot(chats, botId))) {
        res.status(404).json({ error: 'Bot not found' });
        return;
      }
      const entry = await memory.upsertMemory(botId, parsed.data.key, parsed.data.content);
      res.json({ memory: entry });
    } catch (err) {
      const status = isNotFound(err) ? 404 : isBadRequest(err) ? 400 : 500;
      res.status(status).json({ error: errorMessage(err) });
    }
  });

  app.get('/api/bots/:botId/skills', async (req: Request, res: Response) => {
    try {
      const botId = String(req.params.botId);
      if (!(await requireBot(chats, botId))) {
        res.status(404).json({ error: 'Bot not found' });
        return;
      }
      const skills = await memory.listSkills(botId);
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
      const botId = String(req.params.botId);
      if (!(await requireBot(chats, botId))) {
        res.status(404).json({ error: 'Bot not found' });
        return;
      }
      const skill = await memory.createSkill(botId, parsed.data.name, parsed.data.body);
      res.status(201).json({ skill });
    } catch (err) {
      const status = isNotFound(err) ? 404 : isConflict(err) ? 409 : isBadRequest(err) ? 400 : 500;
      res.status(status).json({ error: errorMessage(err) });
    }
  });

  app.delete('/api/bots/:botId/skills/:skillId', async (req: Request, res: Response) => {
    try {
      const botId = String(req.params.botId);
      if (!(await requireBot(chats, botId))) {
        res.status(404).json({ error: 'Bot not found' });
        return;
      }
      await memory.deleteSkill(botId, String(req.params.skillId));
      res.status(204).end();
    } catch (err) {
      const status = isNotFound(err) ? 404 : 500;
      res.status(status).json({ error: errorMessage(err) });
    }
  });
}
