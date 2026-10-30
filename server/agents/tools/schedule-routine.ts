import type { ChatStore } from '../../../shared/chat/types.js';
import type { RoutineStore } from '../../../shared/routines/types.js';
import { describeCronExpression } from '../../../shared/routines/types.js';
import type { ToolDefinition } from '../../../shared/agents/types.js';
import type { HandoffTurnContext } from '../handoff.js';

export const SCHEDULE_ROUTINE_TOOL_NAME = 'schedule_routine';

export const scheduleRoutineToolDefinition: ToolDefinition = {
  name: SCHEDULE_ROUTINE_TOOL_NAME,
  description:
    'Create a scheduled routine for this bot (cron + prompt into its chat). Ask-first. ' +
    'Use when the user wants recurring work (daily/weekly health checks, digests, reminders). ' +
    'Cron is Unix 5-field (minute hour day-of-month month day-of-week), e.g. "0 9 * * *" daily at 09:00. ' +
    'Does not auto-create the Lakeflow Job — user wires Job from Bot details / README after create. ' +
    'Prefer ask_choice if the schedule or prompt is ambiguous.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      name: { type: 'string', description: 'Short routine name shown in Bot details' },
      cron: {
        type: 'string',
        description: 'Unix 5-field cron, e.g. "0 9 * * *" (daily 09:00) or "30 14 * * 1" (Mondays 14:30)',
      },
      prompt: {
        type: 'string',
        description: 'Prompt enqueued into this bot chat on each run',
      },
      enabled: {
        type: 'boolean',
        description: 'Whether webhook/Job runs are accepted (default true). Test always works when Off.',
      },
    },
    required: ['name', 'cron', 'prompt'],
  },
};

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export interface ScheduleRoutineArgs {
  name: string;
  cron: string;
  prompt: string;
  enabled: boolean;
}

type Planned = { ok: true; args: ScheduleRoutineArgs } | { ok: false; error: string };

export function planScheduleRoutine(
  args: Record<string, unknown>,
  bot: HandoffTurnContext['bot'],
): Planned {
  if (!bot) {
    return { ok: false, error: 'schedule_routine requires an active Bot' };
  }

  const name = readText(args.name);
  if (!name) {
    return { ok: false, error: 'schedule_routine requires name' };
  }

  const cron = readText(args.cron);
  if (!cron) {
    return { ok: false, error: 'schedule_routine requires cron' };
  }
  const cronParts = cron.split(/\s+/);
  if (cronParts.length !== 5) {
    return {
      ok: false,
      error: 'schedule_routine cron must be Unix 5-field (minute hour dom month dow)',
    };
  }

  const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';
  if (!prompt) {
    return { ok: false, error: 'schedule_routine requires prompt' };
  }

  const enabled = args.enabled === undefined ? true : Boolean(args.enabled);

  return { ok: true, args: { name, cron, prompt, enabled } };
}

export async function executeScheduleRoutine(
  routines: RoutineStore,
  store: ChatStore,
  ctx: HandoffTurnContext,
  args: Record<string, unknown>,
): Promise<string> {
  const planned = planScheduleRoutine(args, ctx.bot);
  if (!planned.ok) return planned.error;

  const bot = ctx.bot!;
  const { name, cron, prompt, enabled } = planned.args;

  const created = await routines.createRoutine({
    botId: bot.id,
    ownerId: bot.ownerId,
    name,
    cron,
    prompt,
    enabled,
  });

  const scheduleLabel = describeCronExpression(created.routine.cron, 'en');

  await store.addMessage(
    ctx.chatId,
    'system',
    `[routine:${created.routine.name}] created — ${scheduleLabel}` +
      (created.routine.enabled ? ' (On)' : ' (Off)'),
  );

  return JSON.stringify({
    ok: true,
    routine: {
      id: created.routine.id,
      name: created.routine.name,
      cron: created.routine.cron,
      scheduleLabel,
      prompt: created.routine.prompt,
      enabled: created.routine.enabled,
    },
    webhookSecret: created.webhookSecret,
    note:
      'Webhook secret is shown once. User stores it via put-secret and wires the Lakeflow Job (Bot details / README). ' +
      'Do not put the secret in remember/save_skill.',
  });
}

export function createScheduleRoutineTool(routines: RoutineStore, store: ChatStore) {
  return {
    definition: scheduleRoutineToolDefinition,
    preflight(args: Record<string, unknown>, ctx: HandoffTurnContext): string | null {
      const planned = planScheduleRoutine(args, ctx.bot);
      return planned.ok ? null : planned.error;
    },
    execute(args: Record<string, unknown>, ctx: HandoffTurnContext): Promise<string> {
      return executeScheduleRoutine(routines, store, ctx, args);
    },
  };
}
