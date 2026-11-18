import { randomUUID } from 'node:crypto';
import type {
  CreateRoutineInput,
  CreateRoutineResult,
  Routine,
  RoutineStore,
  UpdateRoutineInput,
} from '../../shared/routines/types.js';
import { assertValidRoutinePatch, normalizeNewRoutine } from './input.js';
import { generateWebhookSecret, hashWebhookSecret } from './webhook-auth.js';
import { nowIso } from '../lib/coerce.js';

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

  async getRoutineAuth(routineId: string): Promise<{ routine: Routine; webhookKeyHash: string } | null> {
    const routine = this.routines.get(routineId);
    const webhookKeyHash = this.hashes.get(routineId);
    if (!routine || !webhookKeyHash) return null;
    return { routine, webhookKeyHash };
  }

  async createRoutine(input: CreateRoutineInput): Promise<CreateRoutineResult> {
    const webhookSecret = generateWebhookSecret();
    const routine: Routine = {
      id: randomUUID(),
      botId: input.botId,
      ownerId: input.ownerId,
      ...normalizeNewRoutine(input),
      lastRunAt: null,
      createdAt: nowIso(),
    };
    this.routines.set(routine.id, routine);
    this.hashes.set(routine.id, hashWebhookSecret(webhookSecret));
    return { routine, webhookSecret };
  }

  async updateRoutine(routineId: string, ownerId: string, patch: UpdateRoutineInput): Promise<Routine> {
    const routine = this.routines.get(routineId);
    if (!routine || routine.ownerId !== ownerId) {
      throw new Error('Routine not found');
    }
    assertValidRoutinePatch(patch);
    const updated: Routine = {
      ...routine,
      enabled: patch.enabled ?? routine.enabled,
      name: patch.name?.trim() ?? routine.name,
      cron: patch.cron?.trim() ?? routine.cron,
      prompt: patch.prompt?.trim() || routine.prompt,
      runAs: patch.runAs ?? routine.runAs,
    };
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
