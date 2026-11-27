import type { Request, Response } from 'express';
import { effectiveKnowledgeStatus, knowledgeConfig } from '../../shared/knowledge/types.js';
import type { ChatStore } from '../../shared/chat/types.js';
import { runWithDatabricksRequestAuth } from '../chat/databricks-auth.js';
import { requireBotAccess } from '../chat/route-guards.js';
import type { ChatHttpApp } from '../chat/routes.js';
import { createErrorResponder } from '../lib/http.js';
import { KnowledgeError, type KnowledgeService } from './service.js';

const sendError = createErrorResponder([[401, /no_user_token/]]);

/**
 * Knowledge routes. Anyone who can see the bot lists its files; only the bot owner adds or deletes them.
 * Without a service only the config route answers, saying `enabled: false`.
 */
export function registerKnowledgeRoutes(app: ChatHttpApp, store: ChatStore, knowledge?: KnowledgeService): void {
  function fail(res: Response, err: unknown) {
    if (err instanceof KnowledgeError) res.status(err.status).json({ error: err.message });
    else sendError(res, err, 502);
  }

  async function knowledgeBot(req: Request, res: Response, ownerOnly: boolean) {
    if (!knowledge) {
      res
        .status(404)
        .json({ error: 'The knowledge base is not enabled (set BRICKSBOT_KB_TABLE and BRICKSBOT_KB_INDEX)' });
      return null;
    }
    const access = await requireBotAccess(store, String(req.params.botId), req, res);
    if (access && ownerOnly && access.bot.ownerId !== access.callerId) {
      res.status(403).json({ error: 'Only the bot owner can change its knowledge base' });
      return null;
    }
    return access;
  }

  app.get('/api/knowledge/config', (_req: Request, res: Response) => {
    res.json(knowledgeConfig(Boolean(knowledge)));
  });

  app.get('/api/bots/:botId/knowledge', async (req: Request, res: Response) => {
    try {
      const access = await knowledgeBot(req, res, false);
      if (!access || !knowledge) return;
      const docs = await knowledge.store.list(access.bot.id);
      res.json({ docs: docs.map((doc) => effectiveKnowledgeStatus(doc)) });
    } catch (err) {
      fail(res, err);
    }
  });

  // Raw bytes in the body, the file name in `?name=`, like chat attachments.
  app.post('/api/bots/:botId/knowledge', async (req: Request, res: Response) => {
    try {
      const access = await knowledgeBot(req, res, true);
      if (!access || !knowledge) return;
      const length = Number(req.header('content-length'));
      if (!Number.isFinite(length)) {
        res.status(411).json({ error: 'Content-Length is required' });
        return;
      }
      const name = typeof req.query.name === 'string' ? req.query.name : '';
      // Indexing goes on after the response, still inside this request's auth context (the owner's token).
      const { doc } = await runWithDatabricksRequestAuth(req, () =>
        knowledge.upload(access.bot, access.callerId, { name, length, body: req })
      );
      res.status(201).json({ doc });
    } catch (err) {
      fail(res, err);
    }
  });

  app.post('/api/bots/:botId/knowledge/:id/delete', async (req: Request, res: Response) => {
    try {
      const access = await knowledgeBot(req, res, true);
      if (!access || !knowledge) return;
      const doc = await knowledge.store.get(access.bot.id, String(req.params.id));
      if (!doc) {
        res.status(404).json({ error: 'Knowledge file not found' });
        return;
      }
      await runWithDatabricksRequestAuth(req, () => knowledge.remove(doc));
      res.json({ ok: true });
    } catch (err) {
      fail(res, err);
    }
  });
}
