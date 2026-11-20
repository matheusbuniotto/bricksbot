import { describe, expect, test, vi } from 'vitest';
import type { ChatClient, ChatCompletionResult, UsageAttribution } from '../../shared/agents/types.js';
import { ModelCatalog } from '../agents/models.js';
import { MeteredChatClient } from './metered-client.js';
import { MemoryUsageStore, type UsageStore } from './usage-store.js';

const attribution: UsageAttribution = {
  kind: 'turn',
  payerUserId: 'bob',
  botId: 'bot-1',
  chatId: 'chat-1',
  runId: 'run-1',
  routine: false,
};

function inner(result: Partial<ChatCompletionResult> = {}): ChatClient {
  return {
    provider: 'openai-compatible',
    model: 'a/one',
    complete: () =>
      Promise.resolve({
        content: 'ok',
        toolCalls: [],
        usage: { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 },
        ...result,
      }),
  };
}

const catalog = new ModelCatalog([{ id: 'a/one', label: 'one', inputUsdPerMTok: 2, outputUsdPerMTok: 10 }]);
const request = { messages: [{ role: 'user' as const, content: 'hi' }] };

describe('MeteredChatClient', () => {
  test('writes one row per attributed call and none otherwise', async () => {
    const store = new MemoryUsageStore();
    const client = new MeteredChatClient(inner(), store, catalog);
    await client.complete(request, { attribution });
    await client.complete(request, { attribution: { ...attribution, kind: 'compaction' } });
    await client.complete(request);
    expect(store.entries.map((e) => e.kind)).toEqual(['turn', 'compaction']);
    expect(store.entries[0]).toMatchObject({
      payerUserId: 'bob',
      botId: 'bot-1',
      runId: 'run-1',
      model: 'a/one',
      promptTokens: 1000,
      completionTokens: 500,
    });
  });

  test('cost is the provider figure, else the catalog price, else unknown', async () => {
    const store = new MemoryUsageStore();
    await new MeteredChatClient(
      inner({ usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, cost: 0.42 } }),
      store,
      catalog
    ).complete(request, { attribution });
    await new MeteredChatClient(inner(), store, catalog).complete(request, { attribution });
    await new MeteredChatClient(inner(), store, new ModelCatalog()).complete(request, { attribution });
    expect(store.entries.map((e) => [e.costSource, e.costUsd])).toEqual([
      ['provider', 0.42],
      ['price_table', 0.007],
      ['unknown', null],
    ]);
  });

  test('prices the model that was requested, and records the one that answered', async () => {
    const store = new MemoryUsageStore();
    const client = new MeteredChatClient(inner({ model: 'a/one-2026-01-01' }), store, catalog);
    await client.complete({ ...request, model: 'a/one' }, { attribution });
    expect(store.entries[0]).toMatchObject({ model: 'a/one-2026-01-01', costSource: 'price_table' });
  });

  test('ledger down: an interactive call goes through, a routine call fails closed', async () => {
    const down: UsageStore = { record: () => Promise.reject(new Error('lakebase down')) };
    const warn = vi.fn();
    const client = new MeteredChatClient(inner(), down, catalog, warn);
    await expect(client.complete(request, { attribution })).resolves.toMatchObject({ content: 'ok' });
    await expect(client.complete(request, { attribution: { ...attribution, routine: true } })).rejects.toThrow(
      /ledger unavailable/
    );
    expect(warn).toHaveBeenCalledTimes(2);
  });

  test('a routine call survives one failed ledger write', async () => {
    const record = vi.fn().mockRejectedValueOnce(new Error('blip')).mockResolvedValue(undefined);
    const client = new MeteredChatClient(inner(), { record }, catalog, vi.fn());
    await expect(client.complete(request, { attribution: { ...attribution, routine: true } })).resolves.toMatchObject({
      content: 'ok',
    });
    expect(record).toHaveBeenCalledTimes(2);
  });

  test('a negative provider cost is ignored in favour of the catalog price; zero is a free model', async () => {
    const store = new MemoryUsageStore();
    const usage = (cost: number) => ({ promptTokens: 1000, completionTokens: 500, totalTokens: 1500, cost });
    await new MeteredChatClient(inner({ usage: usage(-5) }), store, catalog).complete(request, { attribution });
    await new MeteredChatClient(inner({ usage: usage(0) }), store, catalog).complete(request, { attribution });
    expect(store.entries.map((e) => [e.costSource, e.costUsd])).toEqual([
      ['price_table', 0.007],
      ['provider', 0],
    ]);
  });
});
