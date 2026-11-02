import { describe, expect, test } from 'vitest';
import { MemoryChatStore } from '../../chat/memory-store.js';
import { MemoryRoutineStore } from '../../routines/memory-store.js';
import {
  createScheduleRoutineTool,
  executeScheduleRoutine,
  planScheduleRoutine,
  SCHEDULE_ROUTINE_TOOL_NAME,
} from './schedule-routine.js';

describe('schedule_routine', () => {
  test('tool name is stable', () => {
    expect(SCHEDULE_ROUTINE_TOOL_NAME).toBe('schedule_routine');
  });

  test('plans a daily cron for the active bot', async () => {
    const store = new MemoryChatStore();
    const { primary } = await store.ensureBootstrap('owner-1');
    const planned = planScheduleRoutine(
      {
        name: 'Morning check',
        cron: '0 9 * * *',
        prompt: 'Summarize overnight alerts',
      },
      primary
    );
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.args.enabled).toBe(true);
    expect(planned.args.cron).toBe('0 9 * * *');
  });

  test('refuses missing bot, bad cron shape, empty prompt', () => {
    expect(planScheduleRoutine({ name: 'x', cron: '0 9 * * *', prompt: 'p' }, null).ok).toBe(false);
    expect(
      planScheduleRoutine(
        { name: 'x', cron: '0 9 * *', prompt: 'p' },
        {
          id: 'b',
          name: 'B',
          ownerId: 'o',
          spaceId: null,
          isPrimary: true,
          avatarLabel: 'P',
          presence: 'online',
          sortOrder: 0,
          archivedAt: null,
          createdAt: new Date().toISOString(),
        }
      ).ok
    ).toBe(false);
    expect(
      planScheduleRoutine(
        { name: 'x', cron: '0 9 * * *', prompt: '  ' },
        {
          id: 'b',
          name: 'B',
          ownerId: 'o',
          spaceId: null,
          isPrimary: true,
          avatarLabel: 'P',
          presence: 'online',
          sortOrder: 0,
          archivedAt: null,
          createdAt: new Date().toISOString(),
        }
      ).ok
    ).toBe(false);
  });

  test('creates routine, returns one-time secret, posts system note', async () => {
    const chats = new MemoryChatStore();
    const routines = new MemoryRoutineStore();
    const { primary } = await chats.ensureBootstrap('owner-1');
    const chat = await chats.getOrCreateChatForBot(primary.id);

    const raw = await executeScheduleRoutine(
      routines,
      chats,
      { chatId: chat.id, bot: primary },
      {
        name: 'Weekly health',
        cron: '0 9 * * 1',
        prompt: 'Run table health',
        enabled: true,
      }
    );
    const result = JSON.parse(raw) as {
      ok: boolean;
      routine: { id: string; name: string; scheduleLabel: string };
      webhookSecret: string;
    };
    expect(result.ok).toBe(true);
    expect(result.routine.name).toBe('Weekly health');
    expect(result.webhookSecret.length).toBeGreaterThan(16);
    expect(result.routine.scheduleLabel.toLowerCase()).toMatch(/monday|every monday/);

    const listed = await routines.listRoutines('owner-1');
    expect(listed.some((r) => r.id === result.routine.id)).toBe(true);

    const messages = await chats.listMessages(chat.id);
    expect(messages.some((m) => m.role === 'system' && m.content.includes('[routine:Weekly health] created'))).toBe(
      true
    );
  });

  test('factory preflight + execute round-trip', async () => {
    const chats = new MemoryChatStore();
    const routines = new MemoryRoutineStore();
    const { primary } = await chats.ensureBootstrap('owner-1');
    const chat = await chats.getOrCreateChatForBot(primary.id);
    const tool = createScheduleRoutineTool(routines, chats);

    expect(tool.definition.name).toBe('schedule_routine');
    expect(tool.preflight({ name: '', cron: '0 9 * * *', prompt: 'p' }, { chatId: chat.id, bot: primary })).toMatch(
      /name/i
    );

    const out = await tool.execute(
      { name: 'Probe', cron: '0 9 * * *', prompt: 'hi', enabled: false },
      { chatId: chat.id, bot: primary }
    );
    const parsed = JSON.parse(out) as { ok: boolean; routine: { enabled: boolean } };
    expect(parsed.ok).toBe(true);
    expect(parsed.routine.enabled).toBe(false);
  });
});
