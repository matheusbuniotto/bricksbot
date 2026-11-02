import { randomUUID } from 'node:crypto';
import type { CompactionRecord, CompactionStore } from '../../shared/durable/types.js';
import type { LakebaseQuery } from '../chat/lakebase-store.js';

function nowIso(): string {
  return new Date().toISOString();
}

function asString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (value === null || value === undefined) return '';
  return String(value);
}

function mapCompaction(row: Record<string, unknown>): CompactionRecord {
  return {
    id: asString(row.id),
    chatId: asString(row.chat_id),
    summary: asString(row.summary),
    keepFromMessageId: asString(row.keep_from_message_id),
    createdAt: asString(row.created_at),
  };
}

export class MemoryCompactionStore implements CompactionStore {
  private byChat = new Map<string, CompactionRecord>();

  async getLatest(chatId: string): Promise<CompactionRecord | null> {
    return this.byChat.get(chatId) ?? null;
  }

  async save(input: { chatId: string; summary: string; keepFromMessageId: string }): Promise<CompactionRecord> {
    const record: CompactionRecord = {
      id: randomUUID(),
      chatId: input.chatId,
      summary: input.summary.trim(),
      keepFromMessageId: input.keepFromMessageId,
      createdAt: nowIso(),
    };
    this.byChat.set(input.chatId, record);
    return record;
  }
}

export class LakebaseCompactionStore implements CompactionStore {
  constructor(private readonly query: LakebaseQuery) {}

  async getLatest(chatId: string): Promise<CompactionRecord | null> {
    const result = await this.query(
      `SELECT id, chat_id, summary, keep_from_message_id, created_at
       FROM bricksbot.compactions
       WHERE chat_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [chatId]
    );
    return result.rows[0] ? mapCompaction(result.rows[0]) : null;
  }

  async save(input: { chatId: string; summary: string; keepFromMessageId: string }): Promise<CompactionRecord> {
    const id = randomUUID();
    const result = await this.query(
      `INSERT INTO bricksbot.compactions (id, chat_id, summary, keep_from_message_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, chat_id, summary, keep_from_message_id, created_at`,
      [id, input.chatId, input.summary.trim(), input.keepFromMessageId]
    );
    return mapCompaction(result.rows[0]!);
  }
}
