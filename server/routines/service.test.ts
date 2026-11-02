import { describe, expect, test } from 'vitest';
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
});
