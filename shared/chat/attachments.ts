/** Files a person attaches to a chat message. The bytes live on a Unity Catalog Volume. */

export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
export const ATTACHMENTS_PER_MESSAGE = 5;
export const ATTACHMENTS_PER_CHAT = 25;
/** What the upload keeps from the start of a file to build its preview. */
export const ATTACHMENT_HEAD_BYTES = 64 * 1024;

export type AttachmentKind = 'csv' | 'excel' | 'pdf';

/** Extension allowlist. The leading bytes must agree (see `server/attachments/validate.ts`). */
export const ATTACHMENT_EXTENSIONS: Record<string, AttachmentKind> = {
  csv: 'csv',
  tsv: 'csv',
  xlsx: 'excel',
  xls: 'excel',
  pdf: 'pdf',
};

export function attachmentKindFor(fileName: string): AttachmentKind | null {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  return fileName.includes('.') ? (ATTACHMENT_EXTENSIONS[extension] ?? null) : null;
}

export interface Attachment {
  id: string;
  chatId: string;
  userId: string;
  /** Set once a message carries it; an attachment travels with one message only. */
  messageId?: string;
  name: string;
  kind: AttachmentKind;
  sizeBytes: number;
  volumePath: string;
  /** CSV: the header and a few rows. Other kinds have none (metadata only). */
  preview?: string;
  createdAt: string;
}

/** What a message remembers about its files. Small enough to live on the message row. */
export type AttachmentRef = Pick<Attachment, 'id' | 'name' | 'kind' | 'sizeBytes'>;

export function attachmentRef({ id, name, kind, sizeBytes }: Attachment): AttachmentRef {
  return { id, name, kind, sizeBytes };
}

/** One row of the Uploads list: a ref plus when it was uploaded and whether a message carries it yet. */
export type AttachmentSummary = AttachmentRef & { createdAt: string; sent: boolean };

export function attachmentSummary(attachment: Attachment): AttachmentSummary {
  return { ...attachmentRef(attachment), createdAt: attachment.createdAt, sent: Boolean(attachment.messageId) };
}

/** Every method is scoped by (chat, user): another person's id finds nothing. */
export interface AttachmentStore {
  create(input: Omit<Attachment, 'createdAt' | 'messageId'>): Promise<Attachment>;
  get(chatId: string, userId: string, id: string): Promise<Attachment | null>;
  list(chatId: string, userId: string): Promise<Attachment[]>;
  /** Ties the attachments to a message. Only ones not yet sent are attached; returns those. */
  attach(chatId: string, userId: string, ids: string[], messageId: string): Promise<Attachment[]>;
  delete(chatId: string, userId: string, id: string): Promise<Attachment | null>;
}

export interface AttachmentConfig {
  enabled: boolean;
  maxBytes: number;
  maxPerMessage: number;
  maxPerChat: number;
  extensions: string[];
}

export function attachmentConfig(enabled: boolean): AttachmentConfig {
  return {
    enabled,
    maxBytes: ATTACHMENT_MAX_BYTES,
    maxPerMessage: ATTACHMENTS_PER_MESSAGE,
    maxPerChat: ATTACHMENTS_PER_CHAT,
    extensions: Object.keys(ATTACHMENT_EXTENSIONS),
  };
}
