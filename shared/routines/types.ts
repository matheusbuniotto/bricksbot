/** Domain types for scheduled routines (Lakeflow Job → App webhook). */

export interface Routine {
  id: string;
  botId: string;
  ownerId: string;
  name: string;
  /** Cron or schedule expression (stored as opaque string for Phase 4). */
  cron: string;
  /** Prompt enqueued into the bot chat on each run. */
  prompt: string;
  enabled: boolean;
  lastRunAt: string | null;
  createdAt: string;
}

export interface CreateRoutineInput {
  botId: string;
  ownerId: string;
  name: string;
  cron: string;
  prompt?: string;
  enabled?: boolean;
}

export interface CreateRoutineResult {
  routine: Routine;
  /** Plaintext webhook secret returned once at create time. */
  webhookSecret: string;
}

export interface UpdateRoutineInput {
  enabled?: boolean;
  name?: string;
  cron?: string;
  prompt?: string;
}

export interface RoutineStore {
  listRoutines(ownerId: string): Promise<Routine[]>;
  getRoutine(routineId: string): Promise<Routine | null>;
  /** Internal row including webhook key hash (never expose over HTTP). */
  getRoutineAuth(routineId: string): Promise<{ routine: Routine; webhookKeyHash: string } | null>;
  createRoutine(input: CreateRoutineInput): Promise<CreateRoutineResult>;
  updateRoutine(routineId: string, ownerId: string, patch: UpdateRoutineInput): Promise<Routine>;
  markRoutineRun(routineId: string, ranAt?: string): Promise<Routine>;
}
