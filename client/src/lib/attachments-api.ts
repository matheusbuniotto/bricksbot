import {
  attachmentKindFor,
  type AttachmentConfig,
  type AttachmentRef,
  type AttachmentSummary,
} from '../../../shared/chat/attachments';
import { readJson } from './http';

export const fetchAttachmentConfig = async (): Promise<AttachmentConfig> =>
  readJson(await fetch('/api/attachments/config'));

/** Raw bytes in the body and the name in the query: the server streams them straight to the Volume. */
export async function uploadAttachment(chatId: string, file: File): Promise<AttachmentRef> {
  const { attachment } = await readJson<{ attachment: AttachmentRef }>(
    await fetch(`/api/chats/${chatId}/attachments?name=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: file,
    })
  );
  return attachment;
}

export async function listAttachments(chatId: string): Promise<AttachmentSummary[]> {
  return (await readJson<{ attachments: AttachmentSummary[] }>(await fetch(`/api/chats/${chatId}/attachments`)))
    .attachments;
}

export async function deleteAttachment(chatId: string, id: string): Promise<void> {
  await readJson(await fetch(`/api/chats/${chatId}/attachments/${id}/delete`, { method: 'POST' }));
}

export const attachmentDownloadUrl = (chatId: string, id: string) => `/api/chats/${chatId}/attachments/${id}/content`;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Why this file cannot be attached, or null. The server checks again; this just spares the round trip. */
export function attachmentProblem(file: File, config: AttachmentConfig, alreadyAttached: number): string | null {
  if (alreadyAttached >= config.maxPerMessage) return `At most ${config.maxPerMessage} files per message`;
  if (!attachmentKindFor(file.name)) return `${file.name}: only ${config.extensions.join(', ')} files can be attached`;
  if (file.size > config.maxBytes) return `${file.name} is over ${formatBytes(config.maxBytes)}`;
  if (file.size === 0) return `${file.name} is empty`;
  return null;
}
