import { describe, expect, test } from 'vitest';
import type { ChatClient, ChatCompletionRequest } from '../../shared/agents/types.js';
import { ModelCatalog } from '../agents/models.js';
import { MemoryCompactionStore } from '../durable/compaction-store.js';
import { MemoryChatStore } from '../chat/memory-store.js';
import { ChatService } from '../chat/service.js';
import { MemoryRoutineStore } from '../routines/memory-store.js';
import { MeteredChatClient } from './metered-client.js';
import { MemoryUsageStore } from './usage-store.js';

/** Answers every call and remembers what it was asked. */
class RecordingClient implements ChatClient {
  readonly provider = 'openai-compatible' as const;
  readonly model = 'a/default';
  readonly requests: ChatCompletionRequest[] = [];
  complete(request: ChatCompletionRequest) {
    this.requests.push(request);
    return Promise.resolve({
      content: 'ok',
      toolCalls: [],
      usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110, cost: 0.01 },
    });
  }
}

const catalog = new ModelCatalog(
  [
    { id: 'a/default', label: 'default' },
    { id: 'b/bot', label: 'bot' },
    { id: 'c/routine', label: 'routine', contextWindow: 20_000 },
  ],
  'a/default'
);

function setup(options: { compaction?: boolean } = {}) {
  const store = new MemoryChatStore();
  const usage = new MemoryUsageStore();
  const inner = new RecordingClient();
  const routines = new MemoryRoutineStore();
  const service = new ChatService({
    store,
    client: new MeteredChatClient(inner, usage, catalog),
    models: catalog,
    routines,
    compaction: options.compaction ? new MemoryCompactionStore() : undefined,
    compactionSettings: { contextWindow: 128_000, reserveTokens: 16_384, keepRecentMessages: 2 },
  });
  return { store, usage, inner, routines, service };
}

describe('usage ledger through the chat service', () => {
  test('a turn writes one row charged to the chat user, not the bot owner', async () => {
    const { store, usage, service } = setup();
    const space = await store.createSpace({ name: 'Team', ownerId: 'alice' });
    await store.addSpaceMember(space.id, 'bob', 'member');
    const bot = await store.createBot({ name: 'Shared', ownerId: 'alice', spaceId: space.id, isShared: true });
    const chat = await store.createChat(bot.id, 'bob');

    await service.sendUserMessage(chat.id, 'hello', { callerUserId: 'bob' });

    expect(usage.entries).toHaveLength(1);
    expect(usage.entries[0]).toMatchObject({
      kind: 'turn',
      payerUserId: 'bob',
      botId: bot.id,
      chatId: chat.id,
      costUsd: 0.01,
    });
    expect(usage.entries[0].runId).toBeTruthy();
  });

  test('the bot owner pick reaches the provider, and no pick means the client default', async () => {
    const { store, inner, service } = setup();
    const bot = await store.createBot({ name: 'Picky', ownerId: 'alice' });
    const chat = await store.createChat(bot.id, 'alice');
    await service.sendUserMessage(chat.id, 'one');
    await store.updateBot(bot.id, { model: 'b/bot' });
    await service.sendUserMessage(chat.id, 'two');
    await store.updateBot(bot.id, { model: 'gone/model' });
    await service.sendUserMessage(chat.id, 'three');
    expect(inner.requests.map((r) => r.model)).toEqual([undefined, 'b/bot', undefined]);
  });

  test('a routine pick beats the bot pick, and the routine is on the ledger', async () => {
    const { store, usage, inner, routines, service } = setup();
    const bot = await store.createBot({ name: 'Picky', ownerId: 'alice', spaceId: null });
    await store.updateBot(bot.id, { model: 'b/bot' });
    const { routine } = await routines.createRoutine({
      botId: bot.id,
      ownerId: 'alice',
      name: 'Nightly',
      cron: '0 9 * * *',
      model: 'c/routine',
    });
    const chat = await store.getRoutineChat(routine);
    await service.sendUserMessage(chat.id, 'go', { routine: true });
    expect(inner.requests.map((r) => r.model)).toEqual(['c/routine']);
    expect(usage.entries[0]).toMatchObject({ routineId: routine.id, model: 'c/routine' });
  });

  test('compaction is metered and uses the chosen model and its window', async () => {
    const { store, usage, inner, routines, service } = setup({ compaction: true });
    const bot = await store.createBot({ name: 'Wordy', ownerId: 'alice' });
    const { routine } = await routines.createRoutine({
      botId: bot.id,
      ownerId: 'alice',
      name: 'Digest',
      cron: '0 9 * * *',
      model: 'c/routine',
    });
    const chat = await store.getRoutineChat(routine);
    for (let i = 0; i < 6; i += 1) {
      await store.addMessage(chat.id, i % 2 === 0 ? 'user' : 'assistant', `turn ${i} ${'word '.repeat(600)}`);
    }

    await service.sendUserMessage(chat.id, 'and now?', { routine: true });

    // c/routine's 20k window overflows here; the 128k default would not.
    expect(usage.entries.map((e) => e.kind)).toEqual(['compaction', 'turn']);
    expect(inner.requests.map((r) => r.model)).toEqual(['c/routine', 'c/routine']);
  });
});
