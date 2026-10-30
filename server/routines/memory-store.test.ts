import { describe, expect, test } from 'vitest';
import { MemoryChatStore } from '../chat/memory-store.js';
import { MemoryRoutineStore } from './memory-store.js';
import { verifyWebhookSecret } from './webhook-auth.js';

describe('MemoryRoutineStore', () => {
  test('creates, lists, updates enable, and marks runs for an owner', async () => {
    const bots = new MemoryChatStore();
    const { primary } = await bots.ensureBootstrap('owner-a');
    const store = new MemoryRoutineStore();

    const created = await store.createRoutine({
      botId: primary.id,
      ownerId: 'owner-a',
      name: 'Morning brief',
      cron: '0 9 * * *',
      prompt: 'Summarize overnight lakehouse jobs',
    });

    expect(created.routine.name).toBe('Morning brief');
    expect(created.routine.enabled).toBe(true);
    expect(created.routine.lastRunAt).toBeNull();
    expect(created.webhookSecret.length).toBeGreaterThan(16);
    expect(created.routine).not.toHaveProperty('webhookKeyHash');

    const auth = await store.getRoutineAuth(created.routine.id);
    expect(auth).not.toBeNull();
    expect(verifyWebhookSecret(created.webhookSecret, auth!.webhookKeyHash)).toBe(true);

    const listed = await store.listRoutines('owner-a');
    expect(listed).toHaveLength(1);
    expect(await store.listRoutines('other')).toHaveLength(0);

    const disabled = await store.updateRoutine(created.routine.id, 'owner-a', { enabled: false });
    expect(disabled.enabled).toBe(false);

    const ran = await store.markRoutineRun(created.routine.id, '2026-10-28T12:00:00.000Z');
    expect(ran.lastRunAt).toBe('2026-10-28T12:00:00.000Z');

    await store.deleteRoutine(created.routine.id, 'owner-a');
    expect(await store.getRoutine(created.routine.id)).toBeNull();
    await expect(store.deleteRoutine(created.routine.id, 'owner-a')).rejects.toThrow(/not found/i);
  });

  test('rejects empty name or cron', async () => {
    const store = new MemoryRoutineStore();
    await expect(
      store.createRoutine({
        botId: 'bot',
        ownerId: 'o',
        name: '  ',
        cron: '0 * * * *',
      }),
    ).rejects.toThrow(/name/i);
    await expect(
      store.createRoutine({
        botId: 'bot',
        ownerId: 'o',
        name: 'ok',
        cron: ' ',
      }),
    ).rejects.toThrow(/cron/i);
  });
});
