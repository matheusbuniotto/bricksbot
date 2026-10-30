import { randomUUID } from 'node:crypto';
import type {
  CreateRoutineInput,
  CreateRoutineResult,
  Routine,
  RoutineStore,
  UpdateRoutineInput,
} from '../../shared/routines/types.js';
import { generateWebhookSecret, hashWebhookSecret } from './webhook-auth.js';

function nowIso(): string {
  return new Date().toISOString();
}

function defaultPrompt(name: string): string {
  return `Scheduled routine: ${name}`;
}

/** In-memory RoutineStore for tests and local runs without Lakebase. */
export class MemoryRoutineStore implements RoutineStore {
  private routines = new Map<string, Routine>();
  private hashes = new Map<string, string>();

  async listRoutines(ownerId: string): Promise<Routine[]> {
    return [...this.routines.values()]
      .filter((r) => r.ownerId === ownerId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async getRoutine(routineId: string): Promise<Routine | null> {
    return this.routines.get(routineId) ?? null;
  }

  async getRoutineAuth(
    routineId: string,
  ): Promise<{ routine: Routine; webhookKeyHash: string } | null> {
    const routine = this.routines.get(routineId);
    const webhookKeyHash = this.hashes.get(routineId);
    if (!routine || !webhookKeyHash) return null;
    return { routine, webhookKeyHash };
  }

  async createRoutine(input: CreateRoutineInput): Promise<CreateRoutineResult> {
    const name = input.name.trim();
    const cron = input.cron.trim();
    if (!name) throw new Error('Routine name is required');
    if (!cron) throw new Error('Cron expression is required');
    if (!input.botId.trim()) throw new Error('Bot id is required');

    const webhookSecret = generateWebhookSecret();
    const routine: Routine = {
      id: randomUUID(),
      botId: input.botId,
      ownerId: input.ownerId,
      name,
      cron,
      prompt: (input.prompt?.trim() || defaultPrompt(name)).trim(),
      enabled: input.enabled ?? true,
      lastRunAt: null,
      createdAt: nowIso(),
    };
    this.routines.set(routine.id, routine);
    this.hashes.set(routine.id, hashWebhookSecret(webhookSecret));
    return { routine, webhookSecret };
  }

  async updateRoutine(
    routineId: string,
    ownerId: string,
    patch: UpdateRoutineInput,
  ): Promise<Routine> {
    const routine = this.routines.get(routineId);
    if (!routine || routine.ownerId !== ownerId) {
      throw new Error('Routine not found');
    }
    const updated: Routine = {
      ...routine,
      enabled: patch.enabled ?? routine.enabled,
      name: patch.name !== undefined ? patch.name.trim() || routine.name : routine.name,
      cron: patch.cron !== undefined ? patch.cron.trim() || routine.cron : routine.cron,
      prompt:
        patch.prompt !== undefined ? patch.prompt.trim() || routine.prompt : routine.prompt,
    };
    if (patch.name !== undefined && !patch.name.trim()) {
      throw new Error('Routine name is required');
    }
    if (patch.cron !== undefined && !patch.cron.trim()) {
      throw new Error('Cron expression is required');
    }
    this.routines.set(routineId, updated);
    return updated;
  }

  async deleteRoutine(routineId: string, ownerId: string): Promise<void> {
    const routine = this.routines.get(routineId);
    if (!routine || routine.ownerId !== ownerId) {
      throw new Error('Routine not found');
    }
    this.routines.delete(routineId);
    this.hashes.delete(routineId);
  }

  async markRoutineRun(routineId: string, ranAt: string = nowIso()): Promise<Routine> {
    const routine = this.routines.get(routineId);
    if (!routine) throw new Error('Routine not found');
    const updated = { ...routine, lastRunAt: ranAt };
    this.routines.set(routineId, updated);
    return updated;
  }
}
