import type { KnowledgeDoc, KnowledgeKind, KnowledgeStatus, KnowledgeStore } from '../../shared/knowledge/types.js';
import type { LakebaseQuery } from '../chat/lakebase-store.js';
import { asString } from '../lib/coerce.js';

const COLUMNS = 'id, bot_id, user_id, name, kind, size_bytes, volume_path, status, chunk_count, error, created_at';

function mapDoc(row: Record<string, unknown>): KnowledgeDoc {
  return {
    id: asString(row.id),
    botId: asString(row.bot_id),
    userId: asString(row.user_id),
    name: asString(row.name),
    kind: asString(row.kind) as KnowledgeKind,
    sizeBytes: Number(row.size_bytes),
    volumePath: asString(row.volume_path),
    status: asString(row.status) as KnowledgeStatus,
    chunkCount: Number(row.chunk_count ?? 0),
    error: row.error ? asString(row.error) : undefined,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : asString(row.created_at),
  };
}

export class LakebaseKnowledgeStore implements KnowledgeStore {
  constructor(private readonly query: LakebaseQuery) {}

  async create(input: Omit<KnowledgeDoc, 'createdAt' | 'status' | 'chunkCount'>): Promise<KnowledgeDoc> {
    const result = await this.query(
      `INSERT INTO bricksbot.knowledge_docs (id, bot_id, user_id, name, kind, size_bytes, volume_path)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${COLUMNS}`,
      [input.id, input.botId, input.userId, input.name, input.kind, input.sizeBytes, input.volumePath]
    );
    return mapDoc(result.rows[0]);
  }

  async get(botId: string, id: string): Promise<KnowledgeDoc | null> {
    const result = await this.query(`SELECT ${COLUMNS} FROM bricksbot.knowledge_docs WHERE id = $1 AND bot_id = $2`, [
      id,
      botId,
    ]);
    return result.rows[0] ? mapDoc(result.rows[0]) : null;
  }

  async list(botId: string): Promise<KnowledgeDoc[]> {
    const result = await this.query(
      `SELECT ${COLUMNS} FROM bricksbot.knowledge_docs WHERE bot_id = $1 ORDER BY created_at`,
      [botId]
    );
    return result.rows.map(mapDoc);
  }

  async update(
    botId: string,
    id: string,
    patch: Partial<Pick<KnowledgeDoc, 'status' | 'chunkCount' | 'error'>>
  ): Promise<KnowledgeDoc | null> {
    const result = await this.query(
      `UPDATE bricksbot.knowledge_docs
       SET status = COALESCE($3, status), chunk_count = COALESCE($4, chunk_count),
           error = CASE WHEN $5::boolean THEN $6 ELSE error END
       WHERE id = $1 AND bot_id = $2
       RETURNING ${COLUMNS}`,
      [id, botId, patch.status ?? null, patch.chunkCount ?? null, 'error' in patch, patch.error ?? null]
    );
    return result.rows[0] ? mapDoc(result.rows[0]) : null;
  }

  async delete(botId: string, id: string): Promise<KnowledgeDoc | null> {
    const result = await this.query(
      `DELETE FROM bricksbot.knowledge_docs WHERE id = $1 AND bot_id = $2 RETURNING ${COLUMNS}`,
      [id, botId]
    );
    return result.rows[0] ? mapDoc(result.rows[0]) : null;
  }
}
