import express from 'express';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type {
  ChatClient,
  ChatCompletionOptions,
  ChatCompletionRequest,
  ChatCompletionResult,
} from '../../shared/agents/types.js';
import { ActiveRunError } from '../../shared/runs/types.js';
import { MemoryIdempotencyStore } from '../durable/idempotency-store.js';
import { MemoryRunStore } from '../runs/memory-store.js';
import { RunService } from '../runs/run-service.js';
import { MemoryChatStore } from './memory-store.js';
import { registerChatRoutes } from './routes.js';
import { ChatService } from './service.js';

/** Completions wait until the test releases them; aborting the signal rejects like a real client. */
class GatedClient implements ChatClient {
  readonly provider = 'stub' as const;
  readonly requests: ChatCompletionRequest[] = [];
  private readonly waiting: Array<{
    resolve: (result: ChatCompletionResult) => void;
    reject: (err: Error) => void;
  }> = [];

  complete(request: ChatCompletionRequest, options?: ChatCompletionOptions): Promise<ChatCompletionResult> {
    this.requests.push(request);
    return new Promise((resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      this.waiting.push({ resolve, reject });
    });
  }

  release(result: ChatCompletionResult) {
    const next = this.waiting.shift();
    if (!next) throw new Error('No completion is waiting');
    next.resolve(result);
  }

  fail(err: Error) {
    const next = this.waiting.shift();
    if (!next) throw new Error('No completion is waiting');
    next.reject(err);
  }
}

const answer = (content: string): ChatCompletionResult => ({ content, toolCalls: [] });
const sqlCalls = (...ids: string[]): ChatCompletionResult => ({
  content: null,
  toolCalls: ids.map((id) => ({ id, name: 'sql_query', arguments: { statement: 'SELECT 1' } })),
});

async function until(condition: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 200; i += 1) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for condition');
}

async function setup(options: { sql?: () => Promise<string>; runs?: MemoryRunStore } = {}) {
  const store = new MemoryChatStore();
  const bot = await store.ensurePrimaryBot();
  const chat = await store.getOrCreateChatForBot(bot.id);
  const client = new GatedClient();
  const runs = options.runs ?? new MemoryRunStore();
  const service = new ChatService({
    store,
    client,
    runs,
    idempotency: new MemoryIdempotencyStore(),
    sqlQuery: { executeImpl: options.sql ?? (() => Promise.resolve('rows')) },
  });
  await service.getApprovals().setAutoApproved(chat.id, 'sql_query');
  const waitForCompletion = (count: number) => until(() => client.requests.length >= count);
  return { store, bot, chat, client, runs, service, waitForCompletion };
}

afterEach(() => vi.useRealTimers());

describe('runs', () => {
  test('a second send while a run is active is refused with the active run id', async () => {
    const { chat, client, service, runs, waitForCompletion } = await setup();
    const first = service.sendUserMessage(chat.id, 'one');
    await waitForCompletion(1);

    const refused = await service.sendUserMessage(chat.id, 'two').catch((err: unknown) => err);
    expect(refused).toBeInstanceOf(ActiveRunError);
    const [active] = await runs.listRunning();
    expect((refused as ActiveRunError).activeRunId).toBe(active.id);

    client.release(answer('done'));
    await first;

    const third = service.sendUserMessage(chat.id, 'three');
    await waitForCompletion(2);
    client.release(answer('free again'));
    expect((await third).assistant?.content).toBe('free again');
  });

  test('the same requestId runs once, in flight and after it finished', async () => {
    const { chat, client, service, waitForCompletion } = await setup();
    const first = service.sendUserMessage(chat.id, 'one', { requestId: 'req-1' });
    await waitForCompletion(1);

    await expect(service.sendUserMessage(chat.id, 'one', { requestId: 'req-1' })).rejects.toBeInstanceOf(
      ActiveRunError
    );
    const detached = await service.startUserMessage(chat.id, 'one', { requestId: 'req-1' });

    client.release(answer('done'));
    const result = await first;
    expect(detached.user.id).toBe(result.user.id);

    const again = await service.sendUserMessage(chat.id, 'one', { requestId: 'req-1' });
    expect(again.assistant?.id).toBe(result.assistant?.id);
    expect(client.requests).toHaveLength(1);
  });

  test('a repeated requestId of a failed run reports the failure; a new requestId runs again', async () => {
    const { chat, client, service, waitForCompletion } = await setup();
    const first = service.sendUserMessage(chat.id, 'one', { requestId: 'req-1' });
    await waitForCompletion(1);
    client.fail(new Error('gateway down'));
    await expect(first).rejects.toThrow('gateway down');

    await expect(service.sendUserMessage(chat.id, 'one', { requestId: 'req-1' })).rejects.toThrow('gateway down');
    expect(client.requests).toHaveLength(1);

    const retry = service.sendUserMessage(chat.id, 'one', { requestId: 'req-2' });
    await waitForCompletion(2);
    client.release(answer('ok'));
    expect((await retry).assistant?.content).toBe('ok');
  });

  test('a detached send returns before the model answers and finishes in the background', async () => {
    const { chat, client, service, store, runs, waitForCompletion } = await setup();
    const { run, user } = await service.startUserMessage(chat.id, 'hello');

    expect(user.content).toBe('hello');
    expect(user.runId).toBe(run.id);
    expect((await runs.get(run.id))?.status).toBe('running');

    await waitForCompletion(1);
    client.release(answer('hi back'));
    await until(async () => (await runs.get(run.id))?.status === 'completed');
    const messages = await store.listMessages(chat.id);
    expect(messages[messages.length - 1]).toMatchObject({ role: 'assistant', content: 'hi back', runId: run.id });
  });

  test('records a gap-free event feed for a turn with a tool', async () => {
    const { chat, client, service, runs, waitForCompletion } = await setup();
    const sent = service.sendUserMessage(chat.id, 'go');
    await waitForCompletion(1);
    client.release(sqlCalls('call_1'));
    await waitForCompletion(2);
    client.release(answer('all done'));
    await sent;

    const events = await runs.listEvents(chat.id, 0);
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(events.map((event) => event.type)).toEqual([
      'run.started',
      'assistant.committed',
      'tool.started',
      'tool.finished',
      'assistant.committed',
      'run.finished',
    ]);
    expect(events[events.length - 1]?.payload).toEqual({ status: 'completed' });
    expect((await runs.listEvents(chat.id, 4)).map((event) => event.seq)).toEqual([5, 6]);
  });

  test('a run that pauses for approval waits, and the decision resumes the same turn', async () => {
    const { chat, client, service, runs, waitForCompletion } = await setup();
    await service.getApprovals().revokeAutoApproved(chat.id, 'sql_query');
    const sent = service.sendUserMessage(chat.id, 'go');
    await waitForCompletion(1);
    client.release(sqlCalls('call_1'));
    const paused = await sent;
    expect(paused.pendingApprovals).toHaveLength(1);

    const [first] = await runs.listEvents(chat.id, 0);
    expect((await runs.get(first.runId))?.status).toBe('waiting');
    const events = await runs.listEvents(chat.id, 0);
    expect(events.map((event) => event.type)).toContain('approval.pending');

    const runId = await service.decideApprovalDetached(paused.pendingApprovals[0].id, 'once');
    await waitForCompletion(2);
    client.release(answer('finished'));
    await until(async () => (await runs.get(runId))?.status === 'completed');

    const resume = await runs.get(runId);
    expect(resume).toMatchObject({ kind: 'resume', turnId: first.runId });
    expect(runId).not.toBe(first.runId);
  });

  test('a send is refused while a run waits on an approval, and allowed once it is decided', async () => {
    const { chat, client, service, store, waitForCompletion } = await setup();
    await service.getApprovals().revokeAutoApproved(chat.id, 'sql_query');
    const sent = service.sendUserMessage(chat.id, 'go');
    await waitForCompletion(1);
    client.release(sqlCalls('call_1'));
    const paused = await sent;
    const messagesBefore = (await store.listMessages(chat.id)).length;

    for (const refused of [
      service.sendUserMessage(chat.id, 'cron', { routine: true, systemNote: '[routine:x] scheduled run' }),
      service.startUserMessage(chat.id, 'typed anyway'),
    ]) {
      await expect(refused).rejects.toBeInstanceOf(ActiveRunError);
    }
    expect(await store.listMessages(chat.id)).toHaveLength(messagesBefore);

    const resumed = service.decideApproval(paused.pendingApprovals[0].id, 'once');
    await waitForCompletion(2);
    client.release(answer('done'));
    await resumed;

    const next = service.sendUserMessage(chat.id, 'next');
    await waitForCompletion(3);
    client.release(answer('free'));
    expect((await next).assistant?.content).toBe('free');
  });

  test('a repeated requestId while the chat waits returns the original run, not a refusal', async () => {
    const { chat, client, service, waitForCompletion } = await setup();
    await service.getApprovals().revokeAutoApproved(chat.id, 'sql_query');
    const first = await service.startUserMessage(chat.id, 'go', { requestId: 'req-1' });
    await waitForCompletion(1);
    client.release(sqlCalls('call_1'));
    await until(async () => (await service.getApprovals().listPending(chat.id)).length === 1);
    await until(async () => (await service.getRuns().store.get(first.run.id))?.status === 'waiting');

    const again = await service.startUserMessage(chat.id, 'go', { requestId: 'req-1' });
    expect(again.run.id).toBe(first.run.id);
    expect(again.user.id).toBe(first.user.id);
    const sent = await service.sendUserMessage(chat.id, 'go', { requestId: 'req-1' });
    expect(sent.pendingApprovals).toHaveLength(1);

    await expect(service.startUserMessage(chat.id, 'go', { requestId: 'req-2' })).rejects.toBeInstanceOf(
      ActiveRunError
    );
  });

  test('a resumed routine turn stays a routine run', async () => {
    const { chat, client, service, runs, waitForCompletion } = await setup();
    await service.getApprovals().revokeAutoApproved(chat.id, 'sql_query');
    const sent = service.sendUserMessage(chat.id, 'go', { routine: true });
    await waitForCompletion(1);
    client.release(sqlCalls('call_1'));
    const paused = await sent;

    const runId = await service.decideApprovalDetached(paused.pendingApprovals[0].id, 'once');
    await waitForCompletion(2);
    client.release(answer('finished'));
    await until(async () => (await runs.get(runId))?.status === 'completed');
    expect(await runs.get(runId)).toMatchObject({ kind: 'resume', routine: true });
  });

  test('losing access to the bot mid-run fails the run and keeps the history valid', async () => {
    const store = new MemoryChatStore();
    const { space } = await store.ensureBootstrap('alice');
    await store.ensureBootstrap('bob');
    await store.addSpaceMember(space.id, 'bob', 'member');
    const bot = await store.createBot({ name: 'Shared', spaceId: space.id, ownerId: 'alice', isShared: true });
    const chat = await store.getOrCreateChatForBot(bot.id, 'bob');
    const client = new GatedClient();
    const runs = new MemoryRunStore();
    const service = new ChatService({
      store,
      client,
      runs,
      // Alice unshares the bot while Bob's tool is running.
      sqlQuery: { executeImpl: async () => (await store.updateBot(bot.id, { isShared: false }), 'rows') },
    });
    await service.getApprovals().setAutoApproved(chat.id, 'sql_query');

    const sent = service.sendUserMessage(chat.id, 'query');
    await until(() => client.requests.length === 1);
    client.release(sqlCalls('call_1'));
    await expect(sent).rejects.toThrow('Access to this bot was revoked');

    const [run] = await runs.listEvents(chat.id, 0);
    expect(await runs.get(run.runId)).toMatchObject({
      status: 'failed',
      error: 'Access to this bot was revoked',
    });
    expect(client.requests).toHaveLength(1);
  });

  test('Stop during the model call keeps the turn and marks it stopped', async () => {
    const { chat, service, store, runs, waitForCompletion } = await setup();
    const sent = service.sendUserMessage(chat.id, 'think hard');
    await waitForCompletion(1);
    const [active] = await runs.listRunning();

    expect(await service.stopRun(active.id)).toBe(true);
    const result = await sent;

    expect(result.assistant?.content).toBe('(stopped)');
    expect(await runs.get(active.id)).toMatchObject({ status: 'stopped', stopRequested: true });
    expect((await store.listMessages(chat.id)).map((message) => message.role)).toEqual(['user', 'assistant']);
    // The chat is free again.
    expect(await runs.listRunning()).toEqual([]);
  });

  test('Stop keeps text that already streamed, marked as stopped', async () => {
    const { chat, service, store, client, runs, waitForCompletion } = await setup();
    const complete = client.complete.bind(client);
    client.complete = (request, options) => {
      options?.onDelta?.('Half an ans');
      return complete(request, options);
    };
    const sent = service.sendUserMessage(chat.id, 'long answer');
    await waitForCompletion(1);
    const [active] = await runs.listRunning();

    await service.stopRun(active.id);
    await sent;

    expect((await store.listMessages(chat.id)).slice(-1)[0]?.content).toBe('Half an ans\n\n(stopped)');
  });

  test('Stop during a tool answers every dangling tool call so the next turn replays cleanly', async () => {
    const { chat, client, service, store, runs, waitForCompletion } = await setup({
      sql: () => new Promise<string>(() => {}),
    });
    const sent = service.sendUserMessage(chat.id, 'two queries');
    await waitForCompletion(1);
    client.release(sqlCalls('call_1', 'call_2'));
    await until(async () => (await runs.listEvents(chat.id, 0)).some((event) => event.type === 'tool.started'));
    const [active] = await runs.listRunning();

    await service.stopRun(active.id);
    await sent;

    const tools = (await store.listMessages(chat.id)).filter((message) => message.role === 'tool');
    expect(tools.map((message) => message.toolCallId)).toEqual(['call_1', 'call_2']);
    expect(JSON.parse(tools[0].content)).toMatchObject({ error: 'Stopped by user', tool: 'sql_query' });
    expect((await runs.get(active.id))?.status).toBe('stopped');

    const next = service.sendUserMessage(chat.id, 'again');
    await waitForCompletion(2);
    const replayed = client.requests[1].messages;
    const answered = new Set(replayed.filter((message) => message.role === 'tool').map((m) => m.toolCallId));
    const asked = replayed.flatMap((message) => message.toolCalls?.map((call) => call.id) ?? []);
    expect(asked.every((id) => answered.has(id))).toBe(true);
    client.release(answer('ok'));
    await next;
  });

  test('the sweeper fails a run whose server died and answers its dangling tool calls', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const runs = new MemoryRunStore();
    const { chat, store, service, client, waitForCompletion } = await setup({ runs });

    // Another instance started the run, then died: its lease is never renewed.
    const dead = new RunService(runs);
    const ctx = await dead.open({ chatId: chat.id, kind: 'send', routine: false });
    await store.addMessage(chat.id, 'user', 'hi', { runId: ctx.runId });
    await store.addMessage(chat.id, 'assistant', '', {
      toolCalls: [{ id: 'call_x', name: 'sql_query', arguments: { statement: 'SELECT 1' } }],
      runId: ctx.runId,
    });

    expect(await service.sweepInterruptedRuns()).toBe(0); // lease still fresh
    vi.setSystemTime(Date.now() + 31_000);
    expect(await service.sweepInterruptedRuns()).toBe(1);

    expect((await runs.get(ctx.runId))?.status).toBe('failed');
    const tool = (await store.listMessages(chat.id)).find((message) => message.role === 'tool');
    expect(tool?.toolCallId).toBe('call_x');
    expect((await runs.listEvents(chat.id, 0)).slice(-1)[0]).toMatchObject({ type: 'run.finished' });

    const next = service.sendUserMessage(chat.id, 'next');
    await waitForCompletion(1);
    client.release(answer('fine'));
    await next;
  });
});

describe('sweeper and handoffs', () => {
  test('a dead run mid-handoff also answers the dangling tool calls in the teammate chat', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { store, bot, chat, client, runs, service, waitForCompletion } = await setup({
      sql: () => new Promise(() => {}),
    });
    const analyst = await store.createBot({ name: 'Analyst', ownerId: bot.ownerId, spaceId: bot.spaceId });
    const targetChat = await store.getOrCreateChatForBot(analyst.id);
    await service.getApprovals().setAutoApproved(chat.id, 'handoff_to_bot');

    void service.sendUserMessage(chat.id, 'ask the analyst').catch(() => {});
    await waitForCompletion(1);
    client.release({
      content: null,
      toolCalls: [{ id: 'call_h', name: 'handoff_to_bot', arguments: { bot_id: analyst.id, brief: 'revenue' } }],
    });
    await waitForCompletion(2);
    client.release(sqlCalls('call_t'));
    await until(async () => (await store.listMessages(targetChat.id)).some((message) => message.toolCalls?.length));

    // A second instance sweeps once the first one's lease has lapsed (the first one is "dead").
    const survivor = new ChatService({ store, client, runs });
    vi.setSystemTime(Date.now() + 31_000);
    expect(await survivor.sweepInterruptedRuns()).toBe(1);

    const answered = (await store.listMessages(targetChat.id)).filter((message) => message.role === 'tool');
    expect(answered.map((message) => message.toolCallId)).toEqual(['call_t']);
  });
});

describe('run routes', () => {
  async function withApp(
    check: (
      api: (path: string, body?: unknown) => Promise<Response>,
      ctx: Awaited<ReturnType<typeof setup>>
    ) => Promise<void>
  ) {
    const ctx = await setup();
    const app = express();
    app.use(express.json());
    registerChatRoutes(app, ctx.store, ctx.service);
    const server = await new Promise<import('node:http').Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const { port } = server.address() as { port: number };
    const api = (path: string, body?: unknown) =>
      fetch(`http://127.0.0.1:${port}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    try {
      await check(api, ctx);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  test('async send answers 202 with the run; a second send gets 409 with the active run; Stop frees the chat', async () => {
    await withApp(async (api, { chat, waitForCompletion }) => {
      const sent = await api(`/api/chats/${chat.id}/messages`, { content: 'hello', async: true });
      expect(sent.status).toBe(202);
      const { runId, user } = (await sent.json()) as { runId: string; user: { content: string } };
      expect(user.content).toBe('hello');
      await waitForCompletion(1);

      const active = await api(`/api/chats/${chat.id}/runs/active`);
      expect(((await active.json()) as { run: { id: string } | null }).run?.id).toBe(runId);

      const busy = await api(`/api/chats/${chat.id}/messages`, { content: 'again' });
      expect(busy.status).toBe(409);
      expect(await busy.json()).toMatchObject({ activeRunId: runId });

      const stopped = await api(`/api/chats/${chat.id}/runs/${runId}/stop`, {});
      expect(stopped.status).toBe(200);
      expect(((await stopped.json()) as { run: { stopRequested: boolean } }).run.stopRequested).toBe(true);
      await until(async () => {
        const res = await api(`/api/chats/${chat.id}/runs/${runId}`);
        return ((await res.json()) as { run: { status: string } }).run.status === 'stopped';
      });
    });
  });

  test('Stop and run lookups are scoped to the chat', async () => {
    await withApp(async (api, { chat }) => {
      const missing = await api(`/api/chats/${chat.id}/runs/not-a-run/stop`, {});
      expect(missing.status).toBe(404);
      const lookup = await api(`/api/chats/${chat.id}/runs/not-a-run`);
      expect(lookup.status).toBe(404);
    });
  });
});
