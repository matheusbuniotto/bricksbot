import { randomUUID } from 'node:crypto';
import type {
  CreateRoutineInput,
  CreateRoutineResult,
  Routine,
  RoutineStore,
  UpdateRoutineInput,
} from '../../shared/routines/types.js';
import type { LakebaseQuery } from '../chat/lakebase-store.js';
import { generateWebhookSecret, hashWebhookSecret } from './webhook-auth.js';

function asString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (value === null || value === undefined) return '';
  return String(value);
}

function asBool(value: unknown): boolean {
  return value === true || value === 't' || value === 'true';
}

function defaultPrompt(name: string): string {
  return `Scheduled routine: ${name}`;
}

function mapRoutine(row: Record<string, unknown>): Routine {
  return {
    id: asString(row.id),
    botId: asString(row.bot_id),
    ownerId: asString(row.owner_id),
    name: asString(row.name),
    cron: asString(row.cron),
    prompt: asString(row.prompt),
    enabled: asBool(row.enabled),
    lastRunAt: row.last_run_at ? asString(row.last_run_at) : null,
    createdAt: asString(row.created_at),
  };
}

export class LakebaseRoutineStore implements RoutineStore {
  constructor(private readonly query: LakebaseQuery) {}

  async listRoutines(ownerId: string): Promise<Routine[]> {
    const result = await this.query(
      `SELECT id, bot_id, owner_id, name, cron, prompt, enabled, last_run_at, created_at
       FROM bricksbot.routines
       WHERE owner_id = $1
       ORDER BY created_at ASC`,
      [ownerId],
    );
    return result.rows.map(mapRoutine);
  }

  async getRoutine(routineId: string): Promise<Routine | null> {
    const result = await this.query(
      `SELECT id, bot_id, owner_id, name, cron, prompt, enabled, last_run_at, created_at
       FROM bricksbot.routines WHERE id = $1`,
      [routineId],
    );
    return result.rows[0] ? mapRoutine(result.rows[0]) : null;
  }

  async getRoutineAuth(
    routineId: string,
  ): Promise<{ routine: Routine; webhookKeyHash: string } | null> {
    const result = await this.query(
      `SELECT id, bot_id, owner_id, name, cron, prompt, enabled, last_run_at, created_at,
              webhook_key_hash
       FROM bricksbot.routines WHERE id = $1`,
      [routineId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      routine: mapRoutine(row),
      webhookKeyHash: asString(row.webhook_key_hash),
    };
  }

  async createRoutine(input: CreateRoutineInput): Promise<CreateRoutineResult> {
    const name = input.name.trim();
    const cron = input.cron.trim();
    if (!name) throw new Error('Routine name is required');
    if (!cron) throw new Error('Cron expression is required');
    if (!input.botId.trim()) throw new Error('Bot id is required');

    const bot = await this.query(`SELECT id FROM bricksbot.bots WHERE id = $1`, [input.botId]);
    if (!bot.rows[0]) throw new Error('Bot not found');

    const webhookSecret = generateWebhookSecret();
    const id = randomUUID();
    const prompt = (input.prompt?.trim() || defaultPrompt(name)).trim();
    const enabled = input.enabled ?? true;
    const inserted = await this.query(
      `INSERT INTO bricksbot.routines
         (id, bot_id, owner_id, name, cron, prompt, webhook_key_hash, enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, bot_id, owner_id, name, cron, prompt, enabled, last_run_at, created_at`,
      [id, input.botId, input.ownerId, name, cron, prompt, hashWebhookSecret(webhookSecret), enabled],
    );
    return { routine: mapRoutine(inserted.rows[0]!), webhookSecret };
  }

  async updateRoutine(
    routineId: string,
    ownerId: string,
    patch: UpdateRoutineInput,
  ): Promise<Routine> {
    const existing = await this.getRoutine(routineId);
    if (!existing || existing.ownerId !== ownerId) {
      throw new Error('Routine not found');
    }
    if (patch.name !== undefined && !patch.name.trim()) {
      throw new Error('Routine name is required');
    }
    if (patch.cron !== undefined && !patch.cron.trim()) {
      throw new Error('Cron expression is required');
    }

    const name = patch.name !== undefined ? patch.name.trim() : existing.name;
    const cron = patch.cron !== undefined ? patch.cron.trim() : existing.cron;
    const prompt =
      patch.prompt !== undefined ? patch.prompt.trim() || existing.prompt : existing.prompt;
    const enabled = patch.enabled ?? existing.enabled;

    const result = await this.query(
      `UPDATE bricksbot.routines
       SET name = $3, cron = $4, prompt = $5, enabled = $6
       WHERE id = $1 AND owner_id = $2
       RETURNING id, bot_id, owner_id, name, cron, prompt, enabled, last_run_at, created_at`,
      [routineId, ownerId, name, cron, prompt, enabled],
    );
    if (!result.rows[0]) throw new Error('Routine not found');
    return mapRoutine(result.rows[0]);
  }

  async markRoutineRun(routineId: string, ranAt?: string): Promise<Routine> {
    const result = await this.query(
      `UPDATE bricksbot.routines
       SET last_run_at = COALESCE($2::timestamptz, NOW())
       WHERE id = $1
       RETURNING id, bot_id, owner_id, name, cron, prompt, enabled, last_run_at, created_at`,
      [routineId, ranAt ?? null],
    );
    if (!result.rows[0]) throw new Error('Routine not found');
    return mapRoutine(result.rows[0]);
  }
}
