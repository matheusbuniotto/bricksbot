import type { Request, Response } from 'express';
import { z } from 'zod';
import type { ChatStore } from '../../shared/chat/types.js';
import type { ChatClient } from '../../shared/agents/types.js';
import type { RoutineStore } from '../../shared/routines/types.js';
import { resolveOwnerId } from '../chat/identity.js';
import { routineAppIdentityAllowed, runWithDatabricksRequestAuth } from '../chat/databricks-auth.js';
import { requireBotUse } from '../chat/route-guards.js';
import { createErrorResponder } from '../lib/http.js';
import type { ChatHttpApp } from '../chat/routes.js';
import { RoutineService } from './service.js';
import { buildSetupStatus } from './setup-status.js';
import { extractWebhookSecretBearer, extractWebhookSecretHeader, WEBHOOK_HEADER } from './webhook-auth.js';

const createRoutineSchema = z.object({
  botId: z.string().uuid(),
  name: z.string().trim().min(1).max(64),
  cron: z.string().trim().min(1).max(128),
  prompt: z.string().trim().min(1).max(4000).optional(),
  enabled: z.boolean().optional(),
  runAs: z.enum(['owner_approval', 'app']).optional(),
});

const patchRoutineSchema = z.object({
  enabled: z.boolean().optional(),
  name: z.string().trim().min(1).max(64).optional(),
  cron: z.string().trim().min(1).max(128).optional(),
  prompt: z.string().trim().min(1).max(4000).optional(),
  runAs: z.enum(['owner_approval', 'app']).optional(),
});

const APP_IDENTITY_REQUIRED =
  'Routines can run as the App service principal only when BRICKSBOT_ROUTINE_APP_IDENTITY=allow';

const sendError = createErrorResponder([
  [400, /required|disabled/i],
  [409, /run is already active/i],
]);
const sendWebhookError = createErrorResponder([
  [401, /invalid webhook/i],
  [403, /required|disabled/i],
  [409, /run is already active/i],
]);

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
  }
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
      sendError(res, err);
    }
  });

  app.post('/api/routines', async (req: Request, res: Response) => {
    const parsed = createRoutineSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'botId, name, and cron are required' });
      return;
    }
    if (parsed.data.runAs === 'app' && !routineAppIdentityAllowed(env)) {
      res.status(403).json({ error: APP_IDENTITY_REQUIRED });
      return;
    }
    try {
      const access = await requireBotUse(options.chats, parsed.data.botId, req, res);
      if (!access) return;
      const created = await store.createRoutine({
        ...parsed.data,
        ownerId: access.callerId,
      });
      res.status(201).json(created);
    } catch (err) {
      sendError(res, err);
    }
  });

  const patchHandler = async (req: Request, res: Response) => {
    const parsed = patchRoutineSchema.safeParse(req.body);
    if (!parsed.success || Object.keys(parsed.data).length === 0) {
      res.status(400).json({ error: 'At least one field to update is required' });
      return;
    }
    if (parsed.data.runAs === 'app' && !routineAppIdentityAllowed(env)) {
      res.status(403).json({ error: APP_IDENTITY_REQUIRED });
      return;
    }
    try {
      const routine = await store.updateRoutine(String(req.params.id), resolveOwnerId(req), parsed.data);
      res.json({ routine });
    } catch (err) {
      sendError(res, err);
    }
  };

  if (typeof app.patch === 'function') {
    app.patch('/api/routines/:id', patchHandler);
  }
  // Fallback when the host only exposes get/post (same body as PATCH).
  app.post('/api/routines/:id/update', patchHandler);

  app.post('/api/routines/:id/run', async (req: Request, res: Response) => {
    try {
      // Test runs as the caller: their OBO token reaches the routine's data tools.
      const result = await runWithDatabricksRequestAuth(req, () =>
        service.runNow(String(req.params.id), resolveOwnerId(req))
      );
      res.status(201).json(result);
    } catch (err) {
      sendError(res, err);
    }
  });

  const deleteHandler = async (req: Request, res: Response) => {
    try {
      await store.deleteRoutine(String(req.params.id), resolveOwnerId(req));
      res.status(204).end();
    } catch (err) {
      sendError(res, err);
    }
  };

  app.delete('/api/routines/:id', deleteHandler);
  app.post('/api/routines/:id/delete', deleteHandler);

  app.post('/api/webhooks/routines/:routineId', async (req: Request, res: Response) => {
    // Order: dedicated header → body.webhookKey → Bearer.
    // Jobs send Apps OAuth in Authorization and the shared secret in header/body;
    // do not treat OAuth Bearer as the webhook secret before checking the body.
    const headers = (req.headers ?? {}) as Record<string, string | string[] | undefined>;
    const bodyKey =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? ((req.body as { webhookKey?: unknown; webhookSecret?: unknown }).webhookKey ??
          (req.body as { webhookSecret?: unknown }).webhookSecret)
        : undefined;
    const secretFromBody = typeof bodyKey === 'string' && bodyKey.trim() ? bodyKey.trim() : null;
    const secret = extractWebhookSecretHeader(headers) ?? secretFromBody ?? extractWebhookSecretBearer(headers);
    if (!secret) {
      res.status(401).json({
        error: `Missing ${WEBHOOK_HEADER} header, body.webhookKey, or Authorization Bearer webhook secret`,
      });
      return;
    }
    try {
      const result = await service.runFromWebhook(String(req.params.routineId), secret);
      res.status(201).json(result);
    } catch (err) {
      sendWebhookError(res, err);
    }
  });
}
