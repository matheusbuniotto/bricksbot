import { randomUUID } from 'node:crypto';
import type {
  CreateRoutineInput,
  CreateRoutineResult,
  Routine,
  RoutineStore,
  UpdateRoutineInput,
} from '../../shared/routines/types.js';
import type { LakebaseQuery } from '../chat/lakebase-store.js';
import { assertValidRoutinePatch, normalizeNewRoutine } from './input.js';
import { generateWebhookSecret, hashWebhookSecret } from './webhook-auth.js';

const ROUTINE_COLUMNS = 'id, bot_id, owner_id, name, cron, prompt, enabled, run_as, model, last_run_at, created_at';
import { asBool, asString } from '../lib/coerce.js';

function mapRoutine(row: Record<string, unknown>): Routine {
  return {
    id: asString(row.id),
    botId: asString(row.bot_id),
    ownerId: asString(row.owner_id),
    name: asString(row.name),
    cron: asString(row.cron),
    prompt: asString(row.prompt),
    enabled: asBool(row.enabled),
    runAs: asString(row.run_as) === 'app' ? 'app' : 'owner_approval',
    model: row.model ? asString(row.model) : null,
    lastRunAt: row.last_run_at ? asString(row.last_run_at) : null,
    createdAt: asString(row.created_at),
  };
}

export class LakebaseRoutineStore implements RoutineStore {
  constructor(private readonly query: LakebaseQuery) {}

  async listRoutines(ownerId: string): Promise<Routine[]> {
    const result = await this.query(
      `SELECT ${ROUTINE_COLUMNS}
       FROM bricksbot.routines
       WHERE owner_id = $1
       ORDER BY created_at ASC`,
      [ownerId]
    );
    return result.rows.map(mapRoutine);
  }

  async getRoutine(routineId: string): Promise<Routine | null> {
    const result = await this.query(
      `SELECT ${ROUTINE_COLUMNS}
       FROM bricksbot.routines WHERE id = $1`,
      [routineId]
    );
    return result.rows[0] ? mapRoutine(result.rows[0]) : null;
  }

  async getRoutineAuth(routineId: string): Promise<{ routine: Routine; webhookKeyHash: string } | null> {
    const result = await this.query(
      `SELECT ${ROUTINE_COLUMNS}, webhook_key_hash
       FROM bricksbot.routines WHERE id = $1`,
      [routineId]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      routine: mapRoutine(row),
      webhookKeyHash: asString(row.webhook_key_hash),
    };
  }

  async createRoutine(input: CreateRoutineInput): Promise<CreateRoutineResult> {
    const { name, cron, prompt, enabled, runAs, model } = normalizeNewRoutine(input);
    const bot = await this.query(`SELECT id FROM bricksbot.bots WHERE id = $1`, [input.botId]);
    if (!bot.rows[0]) throw new Error('Bot not found');

    const webhookSecret = generateWebhookSecret();
    const id = randomUUID();
    const inserted = await this.query(
      `INSERT INTO bricksbot.routines
         (id, bot_id, owner_id, name, cron, prompt, webhook_key_hash, enabled, run_as, model)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING ${ROUTINE_COLUMNS}`,
      [id, input.botId, input.ownerId, name, cron, prompt, hashWebhookSecret(webhookSecret), enabled, runAs, model]
    );
    return { routine: mapRoutine(inserted.rows[0]), webhookSecret };
  }

  async updateRoutine(routineId: string, ownerId: string, patch: UpdateRoutineInput): Promise<Routine> {
    const existing = await this.getRoutine(routineId);
    if (!existing || existing.ownerId !== ownerId) {
      throw new Error('Routine not found');
    }
    assertValidRoutinePatch(patch);

    const name = patch.name?.trim() ?? existing.name;
    const cron = patch.cron?.trim() ?? existing.cron;
    const prompt = patch.prompt?.trim() || existing.prompt;
    const enabled = patch.enabled ?? existing.enabled;
    const runAs = patch.runAs ?? existing.runAs;
    const model = patch.model !== undefined ? patch.model : existing.model;

    const result = await this.query(
      `UPDATE bricksbot.routines
       SET name = $3, cron = $4, prompt = $5, enabled = $6, run_as = $7, model = $8
       WHERE id = $1 AND owner_id = $2
       RETURNING ${ROUTINE_COLUMNS}`,
      [routineId, ownerId, name, cron, prompt, enabled, runAs, model]
    );
    if (!result.rows[0]) throw new Error('Routine not found');
    return mapRoutine(result.rows[0]);
  }

  async deleteRoutine(routineId: string, ownerId: string): Promise<void> {
    const result = await this.query(`DELETE FROM bricksbot.routines WHERE id = $1 AND owner_id = $2 RETURNING id`, [
      routineId,
      ownerId,
    ]);
    if (!result.rows[0]) throw new Error('Routine not found');
  }

  async markRoutineRun(routineId: string, ranAt?: string): Promise<Routine> {
    const result = await this.query(
      `UPDATE bricksbot.routines
       SET last_run_at = COALESCE($2::timestamptz, NOW())
       WHERE id = $1
       RETURNING ${ROUTINE_COLUMNS}`,
      [routineId, ranAt ?? null]
    );
    if (!result.rows[0]) throw new Error('Routine not found');
    return mapRoutine(result.rows[0]);
  }
}
