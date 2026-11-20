import express from 'express';
import { describe, expect, test, vi } from 'vitest';
import type { ChatClient, ChatCompletionRequest, ChatCompletionResult } from '../../shared/agents/types.js';
import { MemoryChatStore } from '../chat/memory-store.js';
import { ChatService } from '../chat/service.js';
import { MemoryRoutineStore } from '../routines/memory-store.js';
import { ModelCatalog } from '../agents/models.js';
import { BudgetService, MemoryBudgetStore, budgetCapsFromEnv, type BudgetCaps } from './budget-service.js';
import { MeteredChatClient } from './metered-client.js';
import { registerUsageRoutes } from './routes.js';
import { MemoryUsageStore, type LlmUsageRecord } from './usage-store.js';

const call = (payerUserId: string, costUsd: number | null, botId = 'bot-1'): LlmUsageRecord => ({
  kind: 'turn',
  payerUserId,
  botId,
  model: 'a/one',
  provider: 'openai-compatible',
  promptTokens: 10,
  completionTokens: 5,
  cachedTokens: 0,
  reasoningTokens: 0,
  costUsd,
  costSource: costUsd === null ? 'unknown' : 'provider',
});

const caps = (overrides: Partial<BudgetCaps> = {}): BudgetCaps => ({
  user: {},
  bot: {},
  action: 'block',
  ...overrides,
});

describe('budgetCapsFromEnv', () => {
  test('is unset by default, warn unless told to block, and ignores junk', () => {
    expect(budgetCapsFromEnv({})).toEqual({ user: {}, bot: {}, action: 'warn' });
    expect(
      budgetCapsFromEnv({
        BRICKSBOT_BUDGET_USER_DAILY_USD: '5',
        BRICKSBOT_BUDGET_USER_MONTHLY_USD: 'lots',
        BRICKSBOT_BUDGET_BOT_MONTHLY_USD: '0',
        BRICKSBOT_BUDGET_ACTION: 'Block',
      })
    ).toEqual({ user: { day: 5, month: undefined }, bot: { day: undefined, month: 0 }, action: 'block' });
  });
});

describe('BudgetService', () => {
  test('unset means no reads and no block', async () => {
    const usage = new MemoryUsageStore();
    const spent = vi.spyOn(usage, 'spent');
    const budgets = new BudgetService(usage, new MemoryBudgetStore(), caps());
    expect(await budgets.check({ payerUserId: 'bob', botId: 'bot-1' })).toBeUndefined();
    expect(spent).not.toHaveBeenCalled();
  });

  test('warn flags the limit but never blocks; block stops the call', async () => {
    const usage = new MemoryUsageStore();
    await usage.record(call('bob', 0.6));
    const warn = new BudgetService(usage, new MemoryBudgetStore(), caps({ user: { day: 0.5 }, action: 'warn' }));
    expect(await warn.check({ payerUserId: 'bob' })).toBeUndefined();
    expect(await warn.statuses('user', 'bob')).toMatchObject([{ period: 'day', exceeded: true, action: 'warn' }]);

    const block = new BudgetService(usage, new MemoryBudgetStore(), caps({ user: { day: 0.5 } }));
    expect(await block.check({ payerUserId: 'bob' })).toMatch(/daily budget of \$0\.50 \(estimated\) is used up/);
    expect(await block.check({ payerUserId: 'alice' })).toBeUndefined();
  });

  test('a block limit fails closed once an unpriced call has made the spend unknown; warn only reports', async () => {
    const usage = new MemoryUsageStore();
    await usage.record(call('bob', null));
    const block = new BudgetService(usage, new MemoryBudgetStore(), caps({ user: { day: 5 } }));
    expect(await block.check({ payerUserId: 'bob' })).toMatch(/cannot be enforced: 1 call\(s\) this day had no price/);
    expect(await block.check({ payerUserId: 'alice' })).toBeUndefined();
    const warn = new BudgetService(usage, new MemoryBudgetStore(), caps({ user: { day: 5 }, action: 'warn' }));
    expect(await warn.check({ payerUserId: 'bob' })).toBeUndefined();
    expect(await warn.statuses('user', 'bob')).toMatchObject([{ exceeded: false, unpricedCalls: 1 }]);
  });

  test('the bot cap counts everyone who used the bot', async () => {
    const usage = new MemoryUsageStore();
    await usage.record(call('bob', 0.3));
    await usage.record(call('carol', 0.3));
    const budgets = new BudgetService(usage, new MemoryBudgetStore(), caps({ bot: { month: 0.5 } }));
    expect(await budgets.check({ payerUserId: 'dave', botId: 'bot-1' })).toMatch(/This bot's monthly budget/);
    expect(await budgets.check({ payerUserId: 'dave', botId: 'bot-1' })).not.toMatch(/spent/);
    expect(await budgets.check({ payerUserId: 'dave', botId: 'bot-2' })).toBeUndefined();
  });

  test('a personal limit adds to the operator cap and can only tighten it', async () => {
    const usage = new MemoryUsageStore();
    await usage.record(call('bob', 2));
    const store = new MemoryBudgetStore();
    const budgets = new BudgetService(usage, store, caps({ user: { day: 1 }, action: 'warn' }));
    await store.set('bob', { period: 'day', limitUsd: 100, action: 'block' });
    // The loose personal limit does not lift the operator's cap: both are reported.
    expect((await budgets.statuses('user', 'bob')).map((s) => [s.source, s.exceeded])).toEqual([
      ['app', true],
      ['you', false],
    ]);
    await store.set('bob', { period: 'day', limitUsd: 1, action: 'block' });
    expect(await budgets.check({ payerUserId: 'bob' })).toMatch(/^Your daily budget/);
  });

  test('a failing read lets interactive calls through and stops routine ones', async () => {
    const usage = new MemoryUsageStore();
    usage.spent = () => Promise.reject(new Error('lakebase down'));
    const budgets = new BudgetService(usage, new MemoryBudgetStore(), caps({ user: { day: 1 } }), () => undefined);
    expect(await budgets.check({ payerUserId: 'bob' })).toBeUndefined();
    await expect(budgets.check({ payerUserId: 'bob', routine: true })).rejects.toThrow(/routine call not accepted/);
  });

  test('calls already in flight can overshoot, the next check after them cannot', async () => {
    const usage = new MemoryUsageStore();
    const budgets = new BudgetService(usage, new MemoryBudgetStore(), caps({ user: { day: 0.01 } }));
    const checks = await Promise.all([1, 2, 3].map(() => budgets.check({ payerUserId: 'bob' })));
    expect(checks).toEqual([undefined, undefined, undefined]);
    await Promise.all(checks.map(() => usage.record(call('bob', 0.01))));
    expect(await budgets.check({ payerUserId: 'bob' })).toBeDefined();
    expect(usage.rollups.size).toBe(2);
  });
});

/** Asks for a tool, then answers. Every call costs a cent. */
class ToolThenAnswer implements ChatClient {
  readonly provider = 'openai-compatible' as const;
  readonly model = 'a/one';
  readonly requests: ChatCompletionRequest[] = [];
  complete(request: ChatCompletionRequest): Promise<ChatCompletionResult> {
    this.requests.push(request);
    const usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15, cost: 0.01 };
    return Promise.resolve(
      this.requests.length === 1
        ? { content: '', toolCalls: [{ id: 'call_1', name: 'list_memories', arguments: {} }], usage }
        : { content: 'done', toolCalls: [], usage }
    );
  }
}

describe('budgets in the chat service', () => {
  function setup(action: 'warn' | 'block') {
    const store = new MemoryChatStore();
    const usage = new MemoryUsageStore();
    const inner = new ToolThenAnswer();
    const catalog = new ModelCatalog([{ id: 'a/one', label: 'one' }], 'a/one');
    const budgets = new BudgetService(usage, new MemoryBudgetStore(), caps({ user: { day: 0.01 }, action }));
    const service = new ChatService({
      store,
      client: new MeteredChatClient(inner, usage, catalog),
      models: catalog,
      budgets,
      routines: new MemoryRoutineStore(),
    });
    return { store, inner, service };
  }

  test('a block after a tool call leaves a notice, makes no call, and no orphan tool_calls', async () => {
    const { store, inner, service } = setup('block');
    const bot = await store.createBot({ name: 'Bot', ownerId: 'alice' });
    const chat = await store.createChat(bot.id, 'alice');

    const result = await service.sendUserMessage(chat.id, 'remember?');

    expect(inner.requests).toHaveLength(1);
    expect(result.assistant?.content).toMatch(/daily budget of \$0\.01 \(estimated\) is used up/);
    const history = await store.listMessages(chat.id);
    const assistantCalls = history.flatMap((m) => m.toolCalls ?? []).map((c) => c.id);
    const toolResults = history.flatMap((m) => (m.role === 'tool' && m.toolCallId ? [m.toolCallId] : []));
    expect(toolResults).toEqual(assistantCalls);
    expect(history[history.length - 1]).toMatchObject({ role: 'assistant' });
  });

  test('once the budget is used up the next message makes no model call', async () => {
    const { store, inner, service } = setup('block');
    const bot = await store.createBot({ name: 'Bot', ownerId: 'alice' });
    const chat = await store.createChat(bot.id, 'alice');
    await service.sendUserMessage(chat.id, 'one');
    await service.sendUserMessage(chat.id, 'two');
    expect(inner.requests).toHaveLength(1);
  });

  test('warn lets the turn finish', async () => {
    const { store, inner, service } = setup('warn');
    const bot = await store.createBot({ name: 'Bot', ownerId: 'alice' });
    const chat = await store.createChat(bot.id, 'alice');
    const result = await service.sendUserMessage(chat.id, 'remember?');
    expect(inner.requests).toHaveLength(2);
    expect(result.assistant?.content).toBe('done');
  });
});

describe('usage HTTP API', () => {
  async function withApp(
    run: (ctx: {
      url: string;
      chats: MemoryChatStore;
      routines: MemoryRoutineStore;
      usage: MemoryUsageStore;
    }) => Promise<void>
  ) {
    const chats = new MemoryChatStore();
    const routines = new MemoryRoutineStore();
    const usage = new MemoryUsageStore();
    const app = express();
    app.use(express.json());
    registerUsageRoutes(
      app,
      usage,
      new BudgetService(usage, new MemoryBudgetStore(), caps({ user: { day: 5 }, action: 'warn' })),
      {
        chats,
        routines,
      }
    );
    const server = await new Promise<import('node:http').Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Failed to bind test server');
    try {
      await run({ url: `http://127.0.0.1:${address.port}`, chats, routines, usage });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  }
  const json = async (res: Response) =>
    (await res.json()) as {
      days: unknown[];
      totals: { costUsd: number; llmCalls: number; unpricedCalls: number };
      budgets: Array<{ source: string; period: string }>;
    };
  const as = (email: string, init: RequestInit = {}): RequestInit => ({
    ...init,
    headers: { 'content-type': 'application/json', 'x-forwarded-email': email },
  });

  test('me shows only my spend, totals and the budgets that apply', async () => {
    await withApp(async ({ url, usage }) => {
      await usage.record(call('bob@x.com', 0.25));
      await usage.record(call('bob@x.com', null));
      await usage.record(call('carol@x.com', 9));
      const body = await json(await fetch(`${url}/api/usage/me`, as('bob@x.com')));
      expect(body.totals).toMatchObject({ costUsd: 0.25, llmCalls: 2, unpricedCalls: 1 });
      expect(body.days).toHaveLength(1);
      expect(body.budgets).toMatchObject([
        { period: 'day', limitUsd: 5, spentUsd: 0.25, exceeded: false, source: 'app' },
      ]);
    });
  });

  test('a bot owner sees the bot totals but nothing about who or what; others are refused', async () => {
    await withApp(async ({ url, chats, usage }) => {
      const bot = await chats.createBot({ name: 'Shared', ownerId: 'alice@x.com' });
      await usage.record(call('bob@x.com', 0.5, bot.id));
      const owner = await fetch(`${url}/api/bots/${bot.id}/usage`, as('alice@x.com'));
      const body = await json(owner);
      expect(body.totals.costUsd).toBe(0.5);
      expect(JSON.stringify(body)).not.toMatch(/bob|chat/i);
      expect((await fetch(`${url}/api/bots/${bot.id}/usage`, as('bob@x.com'))).status).toBe(403);
      expect((await fetch(`${url}/api/bots/missing/usage`, as('alice@x.com'))).status).toBe(404);
    });
  });

  test('a routine owner sees the routine totals; others are refused', async () => {
    await withApp(async ({ url, routines, usage }) => {
      const { routine } = await routines.createRoutine({
        botId: 'b',
        ownerId: 'alice@x.com',
        name: 'N',
        cron: '0 9 * * *',
      });
      await usage.record({ ...call('alice@x.com', 0.2), routineId: routine.id });
      const body = await json(await fetch(`${url}/api/routines/${routine.id}/usage`, as('alice@x.com')));
      expect(body.totals.costUsd).toBe(0.2);
      expect((await fetch(`${url}/api/routines/${routine.id}/usage`, as('bob@x.com'))).status).toBe(403);
    });
  });

  test('a person can set, see and clear their own limit, and bad input is a 400', async () => {
    await withApp(async ({ url }) => {
      const put = (body: unknown) =>
        fetch(`${url}/api/usage/me/budgets`, as('bob@x.com', { method: 'PUT', body: JSON.stringify(body) }));
      const set = await json(await put({ period: 'month', limitUsd: 3, action: 'block' }));
      expect(set.budgets.map((b) => [b.source, b.period])).toEqual([
        ['app', 'day'],
        ['you', 'month'],
      ]);
      expect((await put({ period: 'week', limitUsd: 3, action: 'block' })).status).toBe(400);
      expect((await put({ period: 'day', limitUsd: -1, action: 'warn' })).status).toBe(400);
      const cleared = await json(
        await fetch(`${url}/api/usage/me/budgets/month`, as('bob@x.com', { method: 'DELETE' }))
      );
      expect(cleared.budgets).toHaveLength(1);
    });
  });
});
