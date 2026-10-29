import type { Request, Response } from 'express';
import { z } from 'zod';
import type { ChatStore } from '../../shared/chat/types.js';
import type { ChatClient } from '../../shared/llm/types.js';
import type { RoutineStore } from '../../shared/routines/types.js';
import { resolveOwnerId } from '../chat/identity.js';
import type { ChatHttpApp } from '../chat/routes.js';
import { RoutineService } from './service.js';
import { buildSetupStatus } from './setup-status.js';
import { extractWebhookSecret, WEBHOOK_HEADER } from './webhook-auth.js';

const createRoutineSchema = z.object({
  botId: z.string().uuid(),
  name: z.string().trim().min(1).max(64),
  cron: z.string().trim().min(1).max(128),
  prompt: z.string().trim().min(1).max(4000).optional(),
  enabled: z.boolean().optional(),
});

const patchRoutineSchema = z.object({
  enabled: z.boolean().optional(),
  name: z.string().trim().min(1).max(64).optional(),
  cron: z.string().trim().min(1).max(128).optional(),
  prompt: z.string().trim().min(1).max(4000).optional(),
});

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Unexpected error';
}

function isNotFound(err: unknown): boolean {
  return err instanceof Error && /not found/i.test(err.message);
}

function isBadRequest(err: unknown): boolean {
  return (
    err instanceof Error &&
    (/required/i.test(err.message) || /disabled/i.test(err.message) || /invalid webhook/i.test(err.message))
  );
}

function isUnauthorized(err: unknown): boolean {
  return err instanceof Error && /invalid webhook/i.test(err.message);
}

export type RoutineHttpApp = ChatHttpApp & {
  patch?(path: string, handler: (req: Request, res: Response) => unknown): unknown;
};

/** Register routine CRUD, run, webhook, and setup-status routes. */
export function registerRoutineRoutes(
  app: RoutineHttpApp,
  store: RoutineStore,
  service: RoutineService,
  options: {
    provider: ChatClient['provider'];
    chats: ChatStore;
    env?: Record<string, string | undefined>;
  },
): void {
  const env = options.env ?? process.env;

  app.get('/api/setup/status', (_req: Request, res: Response) => {
    res.json(buildSetupStatus(env, options.provider));
  });

  app.get('/api/routines', async (req: Request, res: Response) => {
    try {
      const routines = await store.listRoutines(resolveOwnerId(req));
      res.json({ routines });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  app.post('/api/routines', async (req: Request, res: Response) => {
    const parsed = createRoutineSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'botId, name, and cron are required' });
      return;
    }
    try {
      const bot = await options.chats.getBot(parsed.data.botId);
      if (!bot) {
        res.status(404).json({ error: 'Bot not found' });
        return;
      }
      const created = await store.createRoutine({
        ...parsed.data,
        ownerId: resolveOwnerId(req),
      });
      res.status(201).json(created);
    } catch (err) {
      res
        .status(isNotFound(err) ? 404 : isBadRequest(err) ? 400 : 500)
        .json({ error: errorMessage(err) });
    }
  });

  const patchHandler = async (req: Request, res: Response) => {
    const parsed = patchRoutineSchema.safeParse(req.body);
    if (!parsed.success || Object.keys(parsed.data).length === 0) {
      res.status(400).json({ error: 'At least one field to update is required' });
      return;
    }
    try {
      const routine = await store.updateRoutine(
        String(req.params.id),
        resolveOwnerId(req),
        parsed.data,
      );
      res.json({ routine });
    } catch (err) {
      res
        .status(isNotFound(err) ? 404 : isBadRequest(err) ? 400 : 500)
        .json({ error: errorMessage(err) });
    }
  };

  if (typeof app.patch === 'function') {
    app.patch('/api/routines/:id', patchHandler);
  }
  // Fallback when the host only exposes get/post (same body as PATCH).
  app.post('/api/routines/:id/update', patchHandler);

  app.post('/api/routines/:id/run', async (req: Request, res: Response) => {
    try {
      const result = await service.runNow(String(req.params.id), resolveOwnerId(req));
      res.status(201).json(result);
    } catch (err) {
      res.status(isNotFound(err) ? 404 : 500).json({ error: errorMessage(err) });
    }
  });

  app.post('/api/webhooks/routines/:routineId', async (req: Request, res: Response) => {
    const secret = extractWebhookSecret(
      (req.headers ?? {}) as Record<string, string | string[] | undefined>,
    );
    if (!secret) {
      res.status(401).json({
        error: `Missing ${WEBHOOK_HEADER} header or Authorization Bearer token`,
      });
      return;
    }
    try {
      const result = await service.runFromWebhook(String(req.params.routineId), secret);
      res.status(201).json(result);
    } catch (err) {
      if (isUnauthorized(err)) {
        res.status(401).json({ error: errorMessage(err) });
        return;
      }
      if (isBadRequest(err)) {
        res.status(403).json({ error: errorMessage(err) });
        return;
      }
      res.status(isNotFound(err) ? 404 : 500).json({ error: errorMessage(err) });
    }
  });
}
