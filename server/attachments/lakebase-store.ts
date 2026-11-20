import type { Attachment, AttachmentKind, AttachmentStore } from '../../shared/chat/attachments.js';
import type { LakebaseQuery } from '../chat/lakebase-store.js';
import { asString } from '../lib/coerce.js';

const COLUMNS = 'id, chat_id, user_id, message_id, name, kind, size_bytes, volume_path, preview, created_at';

function mapAttachment(row: Record<string, unknown>): Attachment {
  return {
    id: asString(row.id),
    chatId: asString(row.chat_id),
    userId: asString(row.user_id),
    messageId: row.message_id ? asString(row.message_id) : undefined,
    name: asString(row.name),
    kind: asString(row.kind) as AttachmentKind,
    sizeBytes: Number(row.size_bytes),
    volumePath: asString(row.volume_path),
    preview: row.preview ? asString(row.preview) : undefined,
    createdAt: asString(row.created_at),
  };
}

export class LakebaseAttachmentStore implements AttachmentStore {
  constructor(private readonly query: LakebaseQuery) {}

  async create(input: Omit<Attachment, 'createdAt' | 'messageId'>): Promise<Attachment> {
    const result = await this.query(
      `INSERT INTO bricksbot.chat_attachments (id, chat_id, user_id, name, kind, size_bytes, volume_path, preview)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${COLUMNS}`,
      [
        input.id,
        input.chatId,
        input.userId,
        input.name,
        input.kind,
        input.sizeBytes,
        input.volumePath,
        input.preview ?? null,
      ]
    );
    return mapAttachment(result.rows[0]);
  }

  async get(chatId: string, userId: string, id: string): Promise<Attachment | null> {
    const result = await this.query(
      `SELECT ${COLUMNS} FROM bricksbot.chat_attachments WHERE id = $1 AND chat_id = $2 AND user_id = $3`,
      [id, chatId, userId]
    );
    return result.rows[0] ? mapAttachment(result.rows[0]) : null;
  }

  async list(chatId: string, userId: string): Promise<Attachment[]> {
    const result = await this.query(
      `SELECT ${COLUMNS} FROM bricksbot.chat_attachments
       WHERE chat_id = $1 AND user_id = $2
       ORDER BY created_at`,
      [chatId, userId]
    );
    return result.rows.map(mapAttachment);
  }

  async attach(chatId: string, userId: string, ids: string[], messageId: string): Promise<Attachment[]> {
    if (ids.length === 0) return [];
    const result = await this.query(
      `UPDATE bricksbot.chat_attachments SET message_id = $4
       WHERE chat_id = $1 AND user_id = $2 AND id = ANY($3::uuid[]) AND message_id IS NULL
       RETURNING ${COLUMNS}`,
      [chatId, userId, ids, messageId]
    );
    return result.rows.map(mapAttachment);
  }

  async delete(chatId: string, userId: string, id: string): Promise<Attachment | null> {
    const result = await this.query(
      `DELETE FROM bricksbot.chat_attachments WHERE id = $1 AND chat_id = $2 AND user_id = $3
       RETURNING ${COLUMNS}`,
      [id, chatId, userId]
    );
    return result.rows[0] ? mapAttachment(result.rows[0]) : null;
  }
}
