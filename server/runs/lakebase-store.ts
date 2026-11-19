import { randomUUID } from 'node:crypto';
import {
  ActiveRunError,
  type Run,
  type RunEvent,
  type RunEventType,
  type RunKind,
  type RunStatus,
  type RunStore,
  type StartRunInput,
} from '../../shared/runs/types.js';
import type { LakebaseQuery } from '../chat/lakebase-store.js';
import { asBool, asJsonObject, asString } from '../lib/coerce.js';

const RUN_COLUMNS =
  'id, chat_id, turn_id, kind, status, routine, request_id, payer_user_id, stop_requested, error, started_at, finished_at';

function mapRun(row: Record<string, unknown>): Run {
  return {
    id: asString(row.id),
    chatId: asString(row.chat_id),
    turnId: asString(row.turn_id),
    kind: asString(row.kind) as RunKind,
    status: asString(row.status) as RunStatus,
    routine: asBool(row.routine),
    requestId: row.request_id ? asString(row.request_id) : undefined,
    payerUserId: row.payer_user_id ? asString(row.payer_user_id) : undefined,
    stopRequested: asBool(row.stop_requested),
    error: row.error ? asString(row.error) : undefined,
    startedAt: asString(row.started_at),
    finishedAt: row.finished_at ? asString(row.finished_at) : undefined,
  };
}

function mapEvent(row: Record<string, unknown>): RunEvent {
  return {
    seq: Number(row.seq),
    chatId: asString(row.chat_id),
    runId: asString(row.run_id),
    type: asString(row.type) as RunEventType,
    payload: asJsonObject(row.payload),
    createdAt: asString(row.created_at),
  };
}

const isUniqueViolation = (err: unknown) => (err as { code?: string } | null)?.code === '23505';

export class LakebaseRunStore implements RunStore {
  constructor(private readonly query: LakebaseQuery) {}

  async start(input: StartRunInput): Promise<{ run: Run; duplicate: boolean }> {
    const sameRequest = await this.findByRequestId(input.requestId);
    if (sameRequest) return { run: sameRequest, duplicate: true };

    const id = randomUUID();
    try {
      // A resume continues the turn of the chat's latest run; a send opens a new turn.
      const result = await this.query(
        `INSERT INTO bricksbot.chat_runs (id, chat_id, turn_id, kind, status, routine, request_id, payer_user_id)
         VALUES ($1, $2,
           CASE WHEN $3 = 'resume'
             THEN COALESCE((SELECT turn_id FROM bricksbot.chat_runs WHERE chat_id = $2 ORDER BY started_at DESC LIMIT 1), $1::uuid)
             ELSE $1::uuid END,
           $3, 'running', $4, $5, $6)
         RETURNING ${RUN_COLUMNS}`,
        [id, input.chatId, input.kind, input.routine, input.requestId ?? null, input.payerUserId ?? null]
      );
      return { run: mapRun(result.rows[0]), duplicate: false };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // Either the same requestId raced us, or the chat already has a running run.
      const raced = await this.findByRequestId(input.requestId);
      if (raced) return { run: raced, duplicate: true };
      const active = await this.query(`SELECT id FROM bricksbot.chat_runs WHERE chat_id = $1 AND status = 'running'`, [
        input.chatId,
      ]);
      if (active.rows[0]) throw new ActiveRunError(asString(active.rows[0].id));
      throw err;
    }
  }

  private async findByRequestId(requestId?: string): Promise<Run | null> {
    if (!requestId) return null;
    const result = await this.query(`SELECT ${RUN_COLUMNS} FROM bricksbot.chat_runs WHERE request_id = $1`, [
      requestId,
    ]);
    return result.rows[0] ? mapRun(result.rows[0]) : null;
  }

  async get(runId: string): Promise<Run | null> {
    const result = await this.query(`SELECT ${RUN_COLUMNS} FROM bricksbot.chat_runs WHERE id = $1`, [runId]);
    return result.rows[0] ? mapRun(result.rows[0]) : null;
  }

  async latest(chatId: string): Promise<Run | null> {
    const result = await this.query(
      `SELECT ${RUN_COLUMNS} FROM bricksbot.chat_runs WHERE chat_id = $1 ORDER BY started_at DESC LIMIT 1`,
      [chatId]
    );
    return result.rows[0] ? mapRun(result.rows[0]) : null;
  }

  async listRunning(): Promise<Run[]> {
    const result = await this.query(`SELECT ${RUN_COLUMNS} FROM bricksbot.chat_runs WHERE status = 'running'`);
    return result.rows.map(mapRun);
  }

  async finish(runId: string, status: Exclude<RunStatus, 'running'>, error?: string): Promise<boolean> {
    const result = await this.query(
      `UPDATE bricksbot.chat_runs SET status = $2, error = $3, finished_at = NOW()
       WHERE id = $1 AND status = 'running'
       RETURNING id`,
      [runId, status, error ?? null]
    );
    return result.rows.length > 0;
  }

  async requestStop(runId: string): Promise<boolean> {
    const result = await this.query(
      `UPDATE bricksbot.chat_runs SET stop_requested = TRUE WHERE id = $1 AND status = 'running' RETURNING id`,
      [runId]
    );
    return result.rows.length > 0;
  }

  async appendEvent(
    chatId: string,
    runId: string,
    type: RunEventType,
    payload: Record<string, unknown>
  ): Promise<RunEvent> {
    // The counter bump and the insert are one statement, so seq stays gap-free per chat.
    const result = await this.query(
      `WITH next AS (
         UPDATE bricksbot.chats SET event_seq = event_seq + 1 WHERE id = $1 RETURNING event_seq
       )
       INSERT INTO bricksbot.run_events (chat_id, seq, run_id, type, payload)
       SELECT $1, event_seq, $2, $3, $4::jsonb FROM next
       RETURNING chat_id, seq, run_id, type, payload, created_at`,
      [chatId, runId, type, JSON.stringify(payload)]
    );
    return mapEvent(result.rows[0]);
  }

  async listEvents(chatId: string, afterSeq: number, runId?: string): Promise<RunEvent[]> {
    const result = await this.query(
      `SELECT chat_id, seq, run_id, type, payload, created_at
       FROM bricksbot.run_events WHERE chat_id = $1 AND seq > $2 AND ($3::uuid IS NULL OR run_id = $3::uuid)
       ORDER BY seq ASC`,
      [chatId, afterSeq, runId ?? null]
    );
    return result.rows.map(mapEvent);
  }

  async acquireLease(name: string, owner: string, ttlMs: number): Promise<boolean> {
    const result = await this.query(
      `INSERT INTO bricksbot.leases (name, owner, expires_at)
       VALUES ($1, $2, NOW() + make_interval(secs => $3::double precision))
       ON CONFLICT (name) DO UPDATE SET owner = EXCLUDED.owner, expires_at = EXCLUDED.expires_at
       WHERE bricksbot.leases.owner = EXCLUDED.owner OR bricksbot.leases.expires_at < NOW()
       RETURNING name`,
      [name, owner, ttlMs / 1000]
    );
    return result.rows.length > 0;
  }

  async releaseLease(name: string, owner: string): Promise<void> {
    await this.query(`DELETE FROM bricksbot.leases WHERE name = $1 AND owner = $2`, [name, owner]);
  }
}
