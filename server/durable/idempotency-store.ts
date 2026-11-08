import type { IdempotencyRecord, IdempotencyStore } from '../../shared/durable/types.js';
import type { LakebaseQuery } from '../chat/lakebase-store.js';
import { asString, nowIso } from '../lib/coerce.js';

export class MemoryIdempotencyStore implements IdempotencyStore {
  private byId = new Map<string, IdempotencyRecord>();

  async get(requestId: string): Promise<IdempotencyRecord | null> {
    return this.byId.get(requestId) ?? null;
  }

  async put(requestId: string, chatId: string, resultJson: string): Promise<void> {
    this.byId.set(requestId, {
      requestId,
      chatId,
      resultJson,
      createdAt: nowIso(),
    });
  }
}

export class LakebaseIdempotencyStore implements IdempotencyStore {
  constructor(private readonly query: LakebaseQuery) {}

  async get(requestId: string): Promise<IdempotencyRecord | null> {
    const result = await this.query(
      `SELECT request_id, chat_id, result_json, created_at
       FROM bricksbot.message_requests
       WHERE request_id = $1`,
      [requestId]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      requestId: asString(row.request_id),
      chatId: asString(row.chat_id),
      resultJson: asString(row.result_json),
      createdAt: asString(row.created_at),
    };
  }

  async put(requestId: string, chatId: string, resultJson: string): Promise<void> {
    await this.query(
      `INSERT INTO bricksbot.message_requests (request_id, chat_id, result_json)
       VALUES ($1, $2, $3)
       ON CONFLICT (request_id) DO NOTHING`,
      [requestId, chatId, resultJson]
    );
  }
}
