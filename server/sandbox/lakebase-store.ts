import { randomUUID } from 'node:crypto';
import type {
  BackendId,
  CreateSandboxSessionInput,
  SandboxEvent,
  SandboxEventType,
  SandboxSession,
  SandboxSessionStatus,
  SandboxStore,
} from '../../shared/sandbox/types.js';
import type { LakebaseQuery } from '../chat/lakebase-store.js';
import { asJsonObject, asString } from '../lib/coerce.js';

function asNullableString(value: unknown): string | null {
  return asString(value) || null;
}

function mapSession(row: Record<string, unknown>): SandboxSession {
  return {
    id: asString(row.id),
    chatId: asString(row.chat_id),
    botId: asString(row.bot_id),
    userId: asString(row.user_id),
    backend: asString(row.backend) as BackendId,
    externalId: asString(row.external_id),
    status: asString(row.status) as SandboxSessionStatus,
    createdAt: asString(row.created_at),
    lastUsedAt: asString(row.last_used_at),
    stoppedAt: asNullableString(row.stopped_at),
    metadata: asJsonObject(row.metadata),
  };
}

function mapEvent(row: Record<string, unknown>): SandboxEvent {
  return {
    id: asString(row.id),
    sessionId: asString(row.session_id),
    type: asString(row.type) as SandboxEventType,
    payload: asJsonObject(row.payload),
    createdAt: asString(row.created_at),
  };
}

export class LakebaseSandboxStore implements SandboxStore {
  constructor(private readonly query: LakebaseQuery) {}

  async getSession(id: string): Promise<SandboxSession | null> {
    const result = await this.query(
      `SELECT id, chat_id, bot_id, user_id, backend, external_id, status, created_at, last_used_at, stopped_at, metadata
       FROM bricksbot.sandbox_sessions
       WHERE id = $1`,
      [id]
    );
    const row = result.rows[0];
    return row ? mapSession(row) : null;
  }

  async getActiveSessionForChat(chatId: string): Promise<SandboxSession | null> {
    const result = await this.query(
      `SELECT id, chat_id, bot_id, user_id, backend, external_id, status, created_at, last_used_at, stopped_at, metadata
       FROM bricksbot.sandbox_sessions
       WHERE chat_id = $1 AND status IN ('creating', 'ready', 'running')
       ORDER BY created_at DESC
       LIMIT 1`,
      [chatId]
    );
    const row = result.rows[0];
    return row ? mapSession(row) : null;
  }

  async getLatestSessionForChat(chatId: string): Promise<SandboxSession | null> {
    const result = await this.query(
      `SELECT id, chat_id, bot_id, user_id, backend, external_id, status, created_at, last_used_at, stopped_at, metadata
       FROM bricksbot.sandbox_sessions
       WHERE chat_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [chatId]
    );
    const row = result.rows[0];
    return row ? mapSession(row) : null;
  }

  async listActiveSessionsForUser(userId: string): Promise<SandboxSession[]> {
    const result = await this.query(
      `SELECT id, chat_id, bot_id, user_id, backend, external_id, status, created_at, last_used_at, stopped_at, metadata
       FROM bricksbot.sandbox_sessions
       WHERE user_id = $1 AND status IN ('creating', 'ready', 'running')
       ORDER BY created_at DESC`,
      [userId]
    );
    return result.rows.map(mapSession);
  }

  async listActiveSessions(): Promise<SandboxSession[]> {
    const result = await this.query(
      `SELECT id, chat_id, bot_id, user_id, backend, external_id, status, created_at, last_used_at, stopped_at, metadata
       FROM bricksbot.sandbox_sessions
       WHERE status IN ('creating', 'ready', 'running')
       ORDER BY created_at DESC`,
      []
    );
    return result.rows.map(mapSession);
  }

  async createSession(input: CreateSandboxSessionInput): Promise<SandboxSession> {
    const id = randomUUID();
    const status = input.status ?? 'creating';
    const metadataJson = JSON.stringify(input.metadata ?? {});
    const result = await this.query(
      `INSERT INTO bricksbot.sandbox_sessions
         (id, chat_id, bot_id, user_id, backend, external_id, status, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       RETURNING id, chat_id, bot_id, user_id, backend, external_id, status, created_at, last_used_at, stopped_at, metadata`,
      [id, input.chatId, input.botId, input.userId, input.backend, input.externalId, status, metadataJson]
    );
    const row = result.rows[0];
    if (!row) throw new Error('Sandbox session create failed');
    return mapSession(row);
  }

  async updateSessionStatus(
    id: string,
    status: SandboxSessionStatus,
    patch?: {
      backend?: SandboxSession['backend'];
      externalId?: string;
      lastUsedAt?: string;
      stoppedAt?: string | null;
      metadata?: Record<string, unknown>;
    }
  ): Promise<SandboxSession> {
    const existing = await this.getSession(id);
    if (!existing) {
      throw new Error(`Sandbox session not found: ${id}`);
    }
    const backend = patch?.backend ?? existing.backend;
    const externalId = patch?.externalId ?? existing.externalId;
    const lastUsedAt = patch?.lastUsedAt ?? existing.lastUsedAt;
    const stoppedAt = patch?.stoppedAt !== undefined ? patch.stoppedAt : existing.stoppedAt;
    const metadataJson = JSON.stringify(patch?.metadata ?? existing.metadata);

    const result = await this.query(
      `UPDATE bricksbot.sandbox_sessions
       SET status = $2,
           backend = $3,
           external_id = $4,
           last_used_at = $5::timestamptz,
           stopped_at = $6::timestamptz,
           metadata = $7::jsonb
       WHERE id = $1
       RETURNING id, chat_id, bot_id, user_id, backend, external_id, status, created_at, last_used_at, stopped_at, metadata`,
      [id, status, backend, externalId, lastUsedAt, stoppedAt, metadataJson]
    );
    const row = result.rows[0];
    if (!row) throw new Error(`Sandbox session not found: ${id}`);
    return mapSession(row);
  }

  async touchSession(id: string, usedAt?: string): Promise<SandboxSession> {
    const timestamp = usedAt ?? new Date().toISOString();
    const result = await this.query(
      `UPDATE bricksbot.sandbox_sessions
       SET last_used_at = $2::timestamptz
       WHERE id = $1
       RETURNING id, chat_id, bot_id, user_id, backend, external_id, status, created_at, last_used_at, stopped_at, metadata`,
      [id, timestamp]
    );
    const row = result.rows[0];
    if (!row) throw new Error(`Sandbox session not found: ${id}`);
    return mapSession(row);
  }

  async addEvent(sessionId: string, type: SandboxEventType, payload: Record<string, unknown>): Promise<SandboxEvent> {
    const id = randomUUID();
    const payloadJson = JSON.stringify(payload);
    const result = await this.query(
      `INSERT INTO bricksbot.sandbox_events (id, session_id, type, payload)
       VALUES ($1, $2, $3, $4::jsonb)
       RETURNING id, session_id, type, payload, created_at`,
      [id, sessionId, type, payloadJson]
    );
    const row = result.rows[0];
    if (!row) throw new Error('Sandbox event insert failed');
    return mapEvent(row);
  }

  async listEvents(sessionId: string, limit: number = 50): Promise<SandboxEvent[]> {
    const result = await this.query(
      `SELECT id, session_id, type, payload, created_at
       FROM bricksbot.sandbox_events
       WHERE session_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [sessionId, limit]
    );
    return result.rows.map(mapEvent);
  }
}
