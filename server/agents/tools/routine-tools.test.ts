import { describe, expect, test } from 'vitest';
import { MemoryChatStore } from '../../chat/memory-store.js';
import { MemoryRoutineStore } from '../../routines/memory-store.js';
import {
  createRoutineTools,
  DELETE_ROUTINE_TOOL_NAME,
  isAutoRoutineTool,
  LIST_ROUTINES_TOOL_NAME,
  UPDATE_ROUTINE_TOOL_NAME,
} from './routine-tools.js';
import { SCHEDULE_ROUTINE_TOOL_NAME } from './schedule-routine.js';

describe('routine tools CRUD', () => {
  test('registers list / schedule / update / delete', () => {
    const tools = createRoutineTools(new MemoryRoutineStore(), new MemoryChatStore());
    const names = tools.map((t) => t.definition.name);
    expect(names).toEqual([
      LIST_ROUTINES_TOOL_NAME,
      SCHEDULE_ROUTINE_TOOL_NAME,
      UPDATE_ROUTINE_TOOL_NAME,
      DELETE_ROUTINE_TOOL_NAME,
    ]);
    expect(isAutoRoutineTool('list_routines')).toBe(true);
    expect(isAutoRoutineTool('delete_routine')).toBe(false);
  });

  test('list → update → delete round-trip', async () => {
    const chats = new MemoryChatStore();
    const routines = new MemoryRoutineStore();
    const { primary } = await chats.ensureBootstrap('owner-1');
    const chat = await chats.getOrCreateChatForBot(primary.id);
    const ctx = { chatId: chat.id, bot: primary };
    const [listTool, scheduleTool, updateTool, deleteTool] = createRoutineTools(routines, chats);

    await scheduleTool.execute({ name: 'Dawn', cron: '0 6 * * *', prompt: 'Morning brief' }, ctx);

    const listed = JSON.parse(await listTool.execute({}, ctx)) as {
      count: number;
      routines: Array<{ id: string; name: string }>;
    };
    expect(listed.count).toBe(1);
    const id = listed.routines[0].id;

    const updated = JSON.parse(
      await updateTool.execute({ routine_id: id, cron: '0 7 * * *', enabled: false, new_name: 'Dawn v2' }, ctx)
    ) as { ok: boolean; routine: { name: string; cron: string; enabled: boolean } };
    expect(updated.ok).toBe(true);
    expect(updated.routine.name).toBe('Dawn v2');
    expect(updated.routine.cron).toBe('0 7 * * *');
    expect(updated.routine.enabled).toBe(false);

    const deleted = JSON.parse(await deleteTool.execute({ name: 'Dawn v2' }, ctx)) as { ok: boolean };
    expect(deleted.ok).toBe(true);
    expect((await routines.listRoutines('owner-1')).length).toBe(0);

    const messages = await chats.listMessages(chat.id);
    expect(messages.some((m) => m.content.includes('[routine:Dawn] created'))).toBe(true);
    expect(messages.some((m) => m.content.includes('[routine:Dawn v2] updated'))).toBe(true);
    expect(messages.some((m) => m.content.includes('[routine:Dawn v2] deleted'))).toBe(true);
  });
});
