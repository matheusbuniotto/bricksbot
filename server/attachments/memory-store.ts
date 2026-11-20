import type { Attachment, AttachmentStore } from '../../shared/chat/attachments.js';
import { nowIso } from '../lib/coerce.js';

export class MemoryAttachmentStore implements AttachmentStore {
  private readonly rows = new Map<string, Attachment>();

  create(input: Omit<Attachment, 'createdAt' | 'messageId'>): Promise<Attachment> {
    const attachment = { ...input, createdAt: nowIso() };
    this.rows.set(attachment.id, attachment);
    return Promise.resolve(attachment);
  }

  get(chatId: string, userId: string, id: string): Promise<Attachment | null> {
    const row = this.rows.get(id);
    return Promise.resolve(row && row.chatId === chatId && row.userId === userId ? row : null);
  }

  list(chatId: string, userId: string): Promise<Attachment[]> {
    return Promise.resolve(
      [...this.rows.values()]
        .filter((row) => row.chatId === chatId && row.userId === userId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    );
  }

  async attach(chatId: string, userId: string, ids: string[], messageId: string): Promise<Attachment[]> {
    const attached: Attachment[] = [];
    for (const id of ids) {
      const row = await this.get(chatId, userId, id);
      if (!row || row.messageId) continue;
      row.messageId = messageId;
      attached.push(row);
    }
    return attached;
  }

  // No await between the lookup and the delete: like the SQL DELETE ... RETURNING, only one of two parallel calls gets the row.
  delete(chatId: string, userId: string, id: string): Promise<Attachment | null> {
    const row = this.rows.get(id);
    const mine = row && row.chatId === chatId && row.userId === userId ? row : null;
    if (mine) this.rows.delete(id);
    return Promise.resolve(mine);
  }
}
