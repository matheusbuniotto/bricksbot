import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ChatClient, ChatCompletionResult } from '../../shared/agents/types.js';
import { recorded, resetFakeMlflow } from '../observability/fake-mlflow.js';
import { initTracing, resetTracing } from '../observability/tracing.js';
import { MemoryChatStore } from './memory-store.js';
import { ChatService } from './service.js';

vi.mock('@mlflow/core', async () => (await import('../observability/fake-mlflow.js')).fakeMlflow);

class ScriptedClient implements ChatClient {
  readonly provider = 'stub' as const;
  readonly model = 'test-model';
  constructor(private readonly script: ChatCompletionResult[]) {}
  complete(): Promise<ChatCompletionResult> {
    return Promise.resolve(this.script.shift()!);
  }
}

const spanNamed = (name: string) => recorded.find((span) => span.name === name);

beforeEach(() => {
  resetTracing();
  resetFakeMlflow();
});

describe('ChatService tracing', () => {
  test('one trace per turn with LLM and tool spans, and no message content', async () => {
    await initTracing({ MLFLOW_EXPERIMENT_ID: '1' });
    const store = new MemoryChatStore();
    const bot = await store.ensurePrimaryBot();
    const chat = await store.getOrCreateChatForBot(bot.id);
    const service = new ChatService({
      store,
      client: new ScriptedClient([
        {
          content: null,
          toolCalls: [{ id: 't1', name: 'remember', arguments: { key: 'sauce', content: 'secret-sauce' } }],
        },
        { content: 'private answer', toolCalls: [] },
      ]),
    });

    await service.sendUserMessage(chat.id, 'private question', { routine: true });

    expect(recorded.map((s) => [s.name, s.parent])).toEqual([
      ['chat_turn', undefined],
      ['llm_call', 'chat_turn'],
      ['remember', 'chat_turn'],
      ['llm_call', 'chat_turn'],
    ]);
    expect(spanNamed('chat_turn')?.attributes).toMatchObject({
      'bricksbot.chat_id': chat.id,
      'bricksbot.bot_id': bot.id,
      'bricksbot.routine': true,
    });
    expect(spanNamed('llm_call')?.attributes).toMatchObject({
      'bricksbot.model': 'test-model',
      'bricksbot.provider': 'stub',
      'bricksbot.tool_calls': 1,
    });
    expect(spanNamed('remember')?.attributes).toMatchObject({
      'bricksbot.tool': 'remember',
      'bricksbot.approval': 'auto',
      'bricksbot.chat_id': chat.id,
    });
    expect(JSON.stringify(recorded)).not.toMatch(/secret-sauce|private/);
  });

  test('approval decision, denial and handoff nest under one trace', async () => {
    await initTracing({ MLFLOW_EXPERIMENT_ID: '1' });
    const store = new MemoryChatStore();
    const primary = await store.ensurePrimaryBot();
    const analyst = await store.createBot({ name: 'Analyst', ownerId: primary.ownerId, spaceId: primary.spaceId });
    const chat = await store.getOrCreateChatForBot(primary.id);
    const service = new ChatService({
      store,
      client: new ScriptedClient([
        {
          content: null,
          toolCalls: [{ id: 'h1', name: 'handoff_to_bot', arguments: { bot_id: analyst.id, brief: 'revenue' } }],
        },
        { content: 'up 12%', toolCalls: [] },
        { content: 'done', toolCalls: [] },
      ]),
    });

    const pending = await service.sendUserMessage(chat.id, 'ask analyst');
    expect(spanNamed('chat_turn')?.attributes).toMatchObject({ 'bricksbot.pending_approvals': 1 });
    recorded.length = 0;

    await service.decideApproval(pending.pendingApprovals[0].id, 'approved');

    expect(recorded.map((s) => [s.name, s.parent])).toEqual([
      ['approval_decision', undefined],
      ['handoff_to_bot', 'approval_decision'],
      ['chat_turn', 'handoff_to_bot'],
      ['llm_call', 'chat_turn'],
      ['chat_turn', 'approval_decision'],
      ['llm_call', 'chat_turn'],
    ]);
    expect(spanNamed('handoff_to_bot')?.attributes).toMatchObject({
      'bricksbot.approval': 'user_approved',
      'bricksbot.target_bot_id': analyst.id,
    });
    expect(recorded[2]?.attributes).toMatchObject({ 'bricksbot.handoff': true, 'bricksbot.bot_id': analyst.id });
  });

  test('a denied tool call is recorded as denied', async () => {
    await initTracing({ MLFLOW_EXPERIMENT_ID: '1' });
    const store = new MemoryChatStore();
    const bot = await store.ensurePrimaryBot();
    const chat = await store.getOrCreateChatForBot(bot.id);
    const service = new ChatService({
      store,
      client: new ScriptedClient([
        { content: null, toolCalls: [{ id: 'w1', name: 'web_fetch', arguments: { url: 'https://example.com' } }] },
      ]),
      webFetchAllowlist: ['example.com'],
    });
    const pending = await service.sendUserMessage(chat.id, 'fetch');
    await service.decideApproval(pending.pendingApprovals[0].id, 'denied');

    expect(recorded.find((s) => s.name === 'web_fetch')?.attributes).toMatchObject({
      'bricksbot.approval': 'user_denied',
    });
  });

  test('chats behave the same with tracing off', async () => {
    const store = new MemoryChatStore();
    const bot = await store.ensurePrimaryBot();
    const chat = await store.getOrCreateChatForBot(bot.id);
    const service = new ChatService({ store, client: new ScriptedClient([{ content: 'hi', toolCalls: [] }]) });
    expect((await service.sendUserMessage(chat.id, 'hello')).assistant?.content).toBe('hi');
    expect(recorded).toEqual([]);
  });
});
