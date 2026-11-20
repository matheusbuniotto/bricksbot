import type { Request, Response } from 'express';
import { z } from 'zod';
import type { ChatStore } from '../../shared/chat/types.js';
import type { RoutineStore } from '../../shared/routines/types.js';
import type { BudgetedUsageView, UsageScopeKind, UsageView } from '../../shared/usage/types.js';
import type { ChatHttpApp } from '../chat/routes.js';
import { resolveOwnerId } from '../chat/identity.js';
import { createErrorResponder } from '../lib/http.js';
import type { BudgetService } from './budget-service.js';
import type { UsageStore } from './usage-store.js';

const sendError = createErrorResponder();

const budgetSchema = z.object({
  period: z.enum(['day', 'month']),
  limitUsd: z.number().min(0).max(1_000_000),
  action: z.enum(['warn', 'block']),
});

function readDays(req: Request): number {
  const days = Math.floor(Number(req.query.days));
  return Number.isFinite(days) ? Math.min(Math.max(days, 1), 90) : 30;
}

/**
 * Usage views carry counts and money only. A person sees their own spend; a bot or routine owner sees
 * that bot's or routine's totals across everyone who used it, with no names, chats or prompts.
 */
export function registerUsageRoutes(
  app: ChatHttpApp,
  usage: UsageStore,
  budgets: BudgetService,
  stores: { chats: ChatStore; routines: RoutineStore }
): void {
  async function view(kind: UsageScopeKind, id: string, days: number): Promise<UsageView> {
    const rows = await usage.daily({ kind, id }, days);
    const totals = { costUsd: 0, promptTokens: 0, completionTokens: 0, llmCalls: 0, unpricedCalls: 0, genieCalls: 0 };
    for (const { day: _day, ...row } of rows) {
      for (const key of Object.keys(totals) as Array<keyof typeof totals>) totals[key] += row[key];
    }
    return { days: rows, totals };
  }

  app.get('/api/usage/me', async (req: Request, res: Response) => {
    try {
      const me = resolveOwnerId(req);
      const body: BudgetedUsageView = {
        ...(await view('user', me, readDays(req))),
        budgets: await budgets.statuses('user', me),
      };
      res.json(body);
    } catch (err) {
      sendError(res, err);
    }
  });

  // People can only tighten: their limit adds to the operator's caps and never replaces them.
  app.put('/api/usage/me/budgets', async (req: Request, res: Response) => {
    try {
      const me = resolveOwnerId(req);
      const parsed = budgetSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid budget' });
        return;
      }
      await budgets.store.set(me, parsed.data);
      res.json({ budgets: await budgets.statuses('user', me) });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.delete('/api/usage/me/budgets/:period', async (req: Request, res: Response) => {
    try {
      const me = resolveOwnerId(req);
      const period = z.enum(['day', 'month']).safeParse(req.params.period);
      if (!period.success) {
        res.status(400).json({ error: 'Invalid period' });
        return;
      }
      await budgets.store.clear(me, period.data);
      res.json({ budgets: await budgets.statuses('user', me) });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get('/api/bots/:id/usage', async (req: Request, res: Response) => {
    try {
      const me = resolveOwnerId(req);
      const bot = await stores.chats.getBot(String(req.params.id));
      if (!bot) {
        res.status(404).json({ error: 'Bot not found' });
        return;
      }
      if (bot.ownerId !== me) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      res.json({ ...(await view('bot', bot.id, readDays(req))), budgets: await budgets.statuses('bot', bot.id) });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get('/api/routines/:id/usage', async (req: Request, res: Response) => {
    try {
      const me = resolveOwnerId(req);
      const routine = await stores.routines.getRoutine(String(req.params.id));
      if (!routine) {
        res.status(404).json({ error: 'Routine not found' });
        return;
      }
      if (routine.ownerId !== me) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      res.json(await view('routine', routine.id, readDays(req)));
    } catch (err) {
      sendError(res, err);
    }
  });
}
