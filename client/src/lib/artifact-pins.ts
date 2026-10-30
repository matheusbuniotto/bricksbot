import {
  parseArtifactPinNotice,
  type ArtifactPinNotice,
} from '../../../shared/chat/artifact-pin-notice';
import type { Message } from '../../../shared/chat/types';

export interface ArtifactPinListItem {
  messageId: string;
  createdAt: string;
  notice: ArtifactPinNotice;
}

/** Newest pins first (Library v1 reads transcript only). */
export function listArtifactPinsFromMessages(messages: Message[]): ArtifactPinListItem[] {
  const items: ArtifactPinListItem[] = [];
  for (const message of messages) {
    if (message.role !== 'system') continue;
    const notice = parseArtifactPinNotice(message.content);
    if (!notice) continue;
    items.push({ messageId: message.id, createdAt: message.createdAt, notice });
  }
  return items.reverse();
}
