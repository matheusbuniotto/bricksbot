import type { CreateRoutineInput, UpdateRoutineInput } from '../../shared/routines/types.js';

/** Validation shared by the Lakebase and in-memory RoutineStore. */

export function normalizeNewRoutine(input: CreateRoutineInput) {
  const name = input.name.trim();
  const cron = input.cron.trim();
  if (!name) throw new Error('Routine name is required');
  if (!cron) throw new Error('Cron expression is required');
  if (!input.botId.trim()) throw new Error('Bot id is required');
  return {
    name,
    cron,
    prompt: input.prompt?.trim() || `Scheduled routine: ${name}`,
    enabled: input.enabled ?? true,
  };
}

export function assertValidRoutinePatch(patch: UpdateRoutineInput): void {
  if (patch.name !== undefined && !patch.name.trim()) {
    throw new Error('Routine name is required');
  }
  if (patch.cron !== undefined && !patch.cron.trim()) {
    throw new Error('Cron expression is required');
  }
}
