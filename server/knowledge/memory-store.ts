import type { KnowledgeDoc, KnowledgeStore } from '../../shared/knowledge/types.js';
import { nowIso } from '../lib/coerce.js';

export class MemoryKnowledgeStore implements KnowledgeStore {
  private readonly rows = new Map<string, KnowledgeDoc>();

  create(input: Omit<KnowledgeDoc, 'createdAt' | 'status' | 'chunkCount'>): Promise<KnowledgeDoc> {
    const doc: KnowledgeDoc = { ...input, status: 'processing', chunkCount: 0, createdAt: nowIso() };
    this.rows.set(doc.id, doc);
    return Promise.resolve({ ...doc });
  }

  get(botId: string, id: string): Promise<KnowledgeDoc | null> {
    const row = this.rows.get(id);
    return Promise.resolve(row && row.botId === botId ? { ...row } : null);
  }

  list(botId: string): Promise<KnowledgeDoc[]> {
    return Promise.resolve(
      [...this.rows.values()]
        .filter((row) => row.botId === botId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((row) => ({ ...row }))
    );
  }

  update(
    botId: string,
    id: string,
    patch: Partial<Pick<KnowledgeDoc, 'status' | 'chunkCount' | 'error'>>
  ): Promise<KnowledgeDoc | null> {
    const row = this.rows.get(id);
    if (!row || row.botId !== botId) return Promise.resolve(null);
    Object.assign(row, patch);
    return Promise.resolve({ ...row });
  }

  delete(botId: string, id: string): Promise<KnowledgeDoc | null> {
    const row = this.rows.get(id);
    const mine = row && row.botId === botId ? row : null;
    if (mine) this.rows.delete(id);
    return Promise.resolve(mine);
  }
}
