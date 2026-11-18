import type { Bot, ChatStore } from '../../../shared/chat/types.js';
import type { Routine, RoutineStore, UpdateRoutineInput } from '../../../shared/routines/types.js';
import { describeCronExpression } from '../../../shared/routines/types.js';
import type { ToolDefinition } from '../../../shared/agents/types.js';
import type { HandoffTurnContext } from '../handoff.js';
import {
  createScheduleRoutineTool,
  SCHEDULE_ROUTINE_TOOL_NAME,
  scheduleRoutineToolDefinition,
} from './schedule-routine.js';
import { readText } from '../../lib/coerce.js';

export { SCHEDULE_ROUTINE_TOOL_NAME, scheduleRoutineToolDefinition, createScheduleRoutineTool };

export const LIST_ROUTINES_TOOL_NAME = 'list_routines';
export const UPDATE_ROUTINE_TOOL_NAME = 'update_routine';
export const DELETE_ROUTINE_TOOL_NAME = 'delete_routine';

/** Read tools that never Ask-first (like list_memories). */
export const AUTO_ROUTINE_TOOL_NAMES = [LIST_ROUTINES_TOOL_NAME] as const;

export function isAutoRoutineTool(name: string): boolean {
  return (AUTO_ROUTINE_TOOL_NAMES as readonly string[]).includes(name);
}

function summarize(routine: Routine) {
  return {
    id: routine.id,
    name: routine.name,
    cron: routine.cron,
    scheduleLabel: describeCronExpression(routine.cron, 'en'),
    prompt: routine.prompt,
    enabled: routine.enabled,
    lastRunAt: routine.lastRunAt,
    botId: routine.botId,
  };
}

/** Routine tools act on the caller's own routines, never the bot owner's (shared bots). */
async function resolveRoutineForBot(
  routines: RoutineStore,
  bot: Bot,
  ownerId: string,
  args: Record<string, unknown>
): Promise<{ ok: true; routine: Routine } | { ok: false; error: string }> {
  const id = readText(args.routine_id) || readText(args.id);
  const name = readText(args.name);

  if (id) {
    const routine = await routines.getRoutine(id);
    if (!routine || routine.ownerId !== ownerId) {
      return { ok: false, error: 'Routine not found' };
    }
    if (routine.botId !== bot.id) {
      return { ok: false, error: 'That routine belongs to another bot' };
    }
    return { ok: true, routine };
  }

  if (!name) {
    return { ok: false, error: 'routine_id or name is required' };
  }

  const listed = await routines.listRoutines(ownerId);
  const matches = listed.filter((r) => r.botId === bot.id && r.name.toLowerCase() === name.toLowerCase());
  if (matches.length === 0) {
    return { ok: false, error: `No routine named ${name} on this bot` };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      error: `Multiple routines named ${name}; pass routine_id instead`,
    };
  }
  return { ok: true, routine: matches[0] };
}

export const listRoutinesToolDefinition: ToolDefinition = {
  name: LIST_ROUTINES_TOOL_NAME,
  description:
    'List scheduled routines for this bot (id, name, cron, schedule label, prompt, enabled, lastRunAt). ' +
    'Auto-runs (no approval). Use before update_routine / delete_routine when the id is unknown.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {},
    required: [],
  },
};

export const updateRoutineToolDefinition: ToolDefinition = {
  name: UPDATE_ROUTINE_TOOL_NAME,
  description:
    'Update a routine on this bot (name, cron, prompt, and/or enabled). Ask-first. ' +
    'Identify by routine_id or name. Cron must stay Unix 5-field when set. ' +
    'Use enabled=false to pause webhook/Job runs (Test still works).',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      routine_id: { type: 'string', description: 'Routine UUID (preferred)' },
      name: {
        type: 'string',
        description: 'Current routine name to find when routine_id is omitted',
      },
      new_name: { type: 'string', description: 'Rename the routine' },
      cron: { type: 'string', description: 'New Unix 5-field cron' },
      prompt: { type: 'string', description: 'New prompt for scheduled runs' },
      enabled: { type: 'boolean', description: 'On/Off for webhook/Job runs' },
    },
    required: [],
  },
};

export const deleteRoutineToolDefinition: ToolDefinition = {
  name: DELETE_ROUTINE_TOOL_NAME,
  description:
    'Delete a routine on this bot permanently. Ask-first every time (never Always allow). ' +
    'Identify by routine_id or name. Does not remove the Lakeflow Job — user should disable/delete that separately.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      routine_id: { type: 'string', description: 'Routine UUID (preferred)' },
      name: {
        type: 'string',
        description: 'Routine name when routine_id is omitted',
      },
    },
    required: [],
  },
};

export function createListRoutinesTool(routines: RoutineStore) {
  return {
    definition: listRoutinesToolDefinition,
    preflight(_args: Record<string, unknown>, ctx: HandoffTurnContext): string | null {
      if (!ctx.userId) return 'list_routines requires a signed-in user';
      return ctx.bot ? null : 'list_routines requires an active Bot';
    },
    async execute(_args: Record<string, unknown>, ctx: HandoffTurnContext): Promise<string> {
      const bot = ctx.bot!;
      const all = await routines.listRoutines(ctx.userId!);
      const mine = all.filter((r) => r.botId === bot.id).map(summarize);
      return JSON.stringify({ ok: true, count: mine.length, routines: mine });
    },
  };
}

export function createUpdateRoutineTool(routines: RoutineStore, store: ChatStore) {
  return {
    definition: updateRoutineToolDefinition,
    async preflight(args: Record<string, unknown>, ctx: HandoffTurnContext): Promise<string | null> {
      if (!ctx.bot) return 'update_routine requires an active Bot';
      if (!ctx.userId) return 'update_routine requires a signed-in user';
      const resolved = await resolveRoutineForBot(routines, ctx.bot, ctx.userId, args);
      if (!resolved.ok) return resolved.error;

      const patch: UpdateRoutineInput = {};
      const newName = readText(args.new_name);
      const cron = readText(args.cron);
      const prompt = readText(args.prompt);
      if (newName) patch.name = newName;
      if (cron) {
        if (cron.split(/\s+/).length !== 5) {
          return 'update_routine cron must be Unix 5-field (minute hour dom month dow)';
        }
        patch.cron = cron;
      }
      if (args.prompt !== undefined) {
        if (!prompt) return 'update_routine prompt cannot be empty';
        patch.prompt = prompt;
      }
      if (args.enabled !== undefined) patch.enabled = Boolean(args.enabled);

      if (Object.keys(patch).length === 0) {
        return 'update_routine needs at least one of: new_name, cron, prompt, enabled';
      }
      return null;
    },
    async execute(args: Record<string, unknown>, ctx: HandoffTurnContext): Promise<string> {
      const resolved = await resolveRoutineForBot(routines, ctx.bot!, ctx.userId!, args);
      if (!resolved.ok) return resolved.error;

      const patch: UpdateRoutineInput = {};
      const newName = readText(args.new_name);
      const cron = readText(args.cron);
      if (newName) patch.name = newName;
      if (cron) patch.cron = cron;
      if (args.prompt !== undefined) patch.prompt = String(args.prompt).trim();
      if (args.enabled !== undefined) patch.enabled = Boolean(args.enabled);

      try {
        const updated = await routines.updateRoutine(resolved.routine.id, ctx.userId!, patch);
        const summary = summarize(updated);
        await store.addMessage(
          ctx.chatId,
          'system',
          `[routine:${updated.name}] updated — ${summary.scheduleLabel}` + (updated.enabled ? ' (On)' : ' (Off)')
        );
        return JSON.stringify({ ok: true, routine: summary });
      } catch (err) {
        return err instanceof Error ? err.message : 'update_routine failed';
      }
    },
  };
}

export function createDeleteRoutineTool(routines: RoutineStore, store: ChatStore) {
  return {
    definition: deleteRoutineToolDefinition,
    async preflight(args: Record<string, unknown>, ctx: HandoffTurnContext): Promise<string | null> {
      if (!ctx.bot) return 'delete_routine requires an active Bot';
      if (!ctx.userId) return 'delete_routine requires a signed-in user';
      const resolved = await resolveRoutineForBot(routines, ctx.bot, ctx.userId, args);
      return resolved.ok ? null : resolved.error;
    },
    async execute(args: Record<string, unknown>, ctx: HandoffTurnContext): Promise<string> {
      const resolved = await resolveRoutineForBot(routines, ctx.bot!, ctx.userId!, args);
      if (!resolved.ok) return resolved.error;

      const { routine } = resolved;
      try {
        await routines.deleteRoutine(routine.id, ctx.userId!);
        await store.addMessage(ctx.chatId, 'system', `[routine:${routine.name}] deleted`);
        return JSON.stringify({
          ok: true,
          deleted: { id: routine.id, name: routine.name },
          note: 'Lakeflow Job is not deleted automatically — disable or remove it in the workspace if wired.',
        });
      } catch (err) {
        return err instanceof Error ? err.message : 'delete_routine failed';
      }
    },
  };
}

/** All routine tools: list (auto), schedule (Ask-first), update (Ask-first), delete (Ask every time). */
export function createRoutineTools(routines: RoutineStore, store: ChatStore) {
  return [
    createListRoutinesTool(routines),
    createScheduleRoutineTool(routines, store),
    createUpdateRoutineTool(routines, store),
    createDeleteRoutineTool(routines, store),
  ];
}
