import { describe, expect, test } from 'vitest';
import type { ChatCompletionRequest, ChatCompletionResult, ChatClient } from '../../shared/agents/types.js';
import { MemoryChatStore } from '../chat/memory-store.js';
import { ChatService } from '../chat/service.js';
import { StubChatClient } from '../agents/clients/stub-client.js';
import { MemoryRoutineStore } from './memory-store.js';
import { RoutineService } from './service.js';

describe('RoutineService', () => {
  test('runNow enqueues a system note + prompt into the bot chat', async () => {
    const chats = new MemoryChatStore();
    const { primary } = await chats.ensureBootstrap('owner');
    const routines = new MemoryRoutineStore();
    const chatService = new ChatService({ store: chats, client: new StubChatClient() });
    const service = new RoutineService(routines, chats, chatService);

    const { routine } = await routines.createRoutine({
      botId: primary.id,
      ownerId: 'owner',
      name: 'Daily',
      cron: '0 8 * * *',
      prompt: 'Give me the daily brief',
    });

    const result = await service.runNow(routine.id, 'owner');
    expect(result.routine.lastRunAt).toBeTruthy();
    expect(result.chat.user.content).toBe('Give me the daily brief');

    const chat = await chats.getOrCreateChatForBot(primary.id);
    const messages = await chats.listMessages(chat.id);
    expect(messages.some((m) => m.role === 'system' && m.content.includes('Daily'))).toBe(true);
    expect(messages.some((m) => m.role === 'user' && m.content === 'Give me the daily brief')).toBe(true);
    expect(messages.some((m) => m.role === 'assistant')).toBe(true);
  });

  test('webhook accepts the create-time secret and rejects a bad secret', async () => {
    const chats = new MemoryChatStore();
    const { primary } = await chats.ensureBootstrap('owner');
    const routines = new MemoryRoutineStore();
    const chatService = new ChatService({ store: chats, client: new StubChatClient() });
    const service = new RoutineService(routines, chats, chatService);

    const created = await routines.createRoutine({
      botId: primary.id,
      ownerId: 'owner',
      name: 'Hook',
      cron: '*/5 * * * *',
      prompt: 'ping',
    });

    await expect(service.runFromWebhook(created.routine.id, 'nope')).rejects.toThrow(/invalid webhook/i);

    const ok = await service.runFromWebhook(created.routine.id, created.webhookSecret);
    expect(ok.chat.user.content).toBe('ping');
  });

  test('webhook refuses a disabled routine; runNow still works', async () => {
    const chats = new MemoryChatStore();
    const { primary } = await chats.ensureBootstrap('owner');
    const routines = new MemoryRoutineStore();
    const chatService = new ChatService({ store: chats, client: new StubChatClient() });
    const service = new RoutineService(routines, chats, chatService);

    const created = await routines.createRoutine({
      botId: primary.id,
      ownerId: 'owner',
      name: 'Off',
      cron: '0 0 * * *',
      prompt: 'should wait',
    });
    await routines.updateRoutine(created.routine.id, 'owner', { enabled: false });

    await expect(service.runFromWebhook(created.routine.id, created.webhookSecret)).rejects.toThrow(/disabled/i);

    const manual = await service.runNow(created.routine.id, 'owner');
    expect(manual.chat.user.content).toBe('should wait');
  });

  test('refuses to run once the routine owner loses access to a shared bot', async () => {
    const chats = new MemoryChatStore();
    const team = await chats.createSpace({ name: 'Team', ownerId: 'carol' });
    await chats.addSpaceMember(team.id, 'bob', 'member');
    const bot = await chats.createBot({ name: 'Analyst', ownerId: 'carol', spaceId: team.id, isShared: true });
    const routines = new MemoryRoutineStore();
    const service = new RoutineService(
      routines,
      chats,
      new ChatService({ store: chats, client: new StubChatClient() })
    );
    const { routine } = await routines.createRoutine({
      botId: bot.id,
      ownerId: 'bob',
      name: 'Daily',
      cron: '0 8 * * *',
      prompt: 'Brief me',
    });

    await expect(service.runNow(routine.id, 'bob')).resolves.toBeTruthy();
    await chats.removeSpaceMember(team.id, 'bob');
    await expect(service.runNow(routine.id, 'bob')).rejects.toThrow(/Bot access required/);
  });

  test('webhook runs gate sql_query on the owner unless the App identity is allowed', async () => {
    const sqlCall: ChatCompletionResult = {
      content: null,
      toolCalls: [{ id: 'call_sql', name: 'sql_query', arguments: { statement: 'SELECT 1' } }],
    };
    const client: ChatClient = {
      provider: 'stub',
      complete: (request: ChatCompletionRequest) =>
        Promise.resolve(request.messages.some((m) => m.role === 'tool') ? { content: 'done', toolCalls: [] } : sqlCall),
    };
    const chats = new MemoryChatStore();
    const { primary } = await chats.ensureBootstrap('owner');
    const routines = new MemoryRoutineStore();
    const chatService = new ChatService({
      store: chats,
      client,
      sqlQuery: { warehouseId: 'wh-1', executeImpl: () => Promise.resolve('n\n1') },
    });
    const env: Record<string, string | undefined> = {};
    const service = new RoutineService(routines, chats, chatService, env);
    const chat = await chats.getOrCreateChatForBot(primary.id, 'owner');
    await chatService.getApprovals().setAutoApproved(chat.id, 'sql_query');
    const created = await routines.createRoutine({
      botId: primary.id,
      ownerId: 'owner',
      name: 'Hook',
      cron: '0 * * * *',
      prompt: 'count',
      runAs: 'app',
    });

    const gated = await service.runFromWebhook(created.routine.id, created.webhookSecret);
    expect(gated.chat.pendingApprovals.map((a) => a.toolCall.name)).toEqual(['sql_query']);
    await chatService.decideApproval(gated.chat.pendingApprovals[0].id, 'denied');

    env.BRICKSBOT_ROUTINE_APP_IDENTITY = 'allow';
    const ran = await service.runFromWebhook(created.routine.id, created.webhookSecret);
    expect(ran.chat.pendingApprovals).toEqual([]);
    expect(ran.chat.assistant?.content).toBe('done');
  });

  test('new routines default to owner_approval', async () => {
    const chats = new MemoryChatStore();
    const { primary } = await chats.ensureBootstrap('owner');
    const { routine } = await new MemoryRoutineStore().createRoutine({
      botId: primary.id,
      ownerId: 'owner',
      name: 'Daily',
      cron: '0 8 * * *',
    });
    expect(routine.runAs).toBe('owner_approval');
  });
});
