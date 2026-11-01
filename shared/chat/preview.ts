import { artifactPinPreviewLine, parseArtifactPinNotice } from './artifact-pin-notice.js';
import { parseBotCreatedNotice } from './bot-created-notice.js';
import { parseHandoffNotice } from './handoff-notice.js';
import type { Message } from './types.js';

function looksLikeJsonBlob(content: string): boolean {
  const trimmed = content.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

export function messagePreviewLine(
  message: Pick<Message, 'role' | 'content'>,
): string | null {
  if (message.role === 'tool') return null;

  if (message.role === 'system') {
    const created = parseBotCreatedNotice(message.content);
    if (created) {
      return `Created ${created.name}`;
    }
    const handoff = parseHandoffNotice(message.content);
    if (handoff) {
      if (handoff.direction === 'thread' && handoff.messageCount && handoff.messageCount > 0) {
        const n = handoff.messageCount;
        return `${n} message${n === 1 ? '' : 's'} with ${handoff.targetName}`;
      }
      if (handoff.replyPreview?.trim()) return handoff.replyPreview.trim();
      if (handoff.brief?.trim()) return handoff.brief.trim();
      if (handoff.direction === 'sent') return `Sent to ${handoff.targetName}`;
      if (handoff.direction === 'received') {
        return `From ${handoff.senderName || handoff.targetName}`;
      }
      return null;
    }
    const pin = parseArtifactPinNotice(message.content);
    if (pin) {
      return artifactPinPreviewLine(pin);
    }
    if (looksLikeJsonBlob(message.content)) return null;
    const plain = message.content.replace(/\s+/g, ' ').trim();
    return plain || null;
  }

  const plain = message.content.replace(/\s+/g, ' ').trim();
  if (!plain) return null;
  // Legacy synthetic wait copy — approval cards own that state.
  if (/^Waiting for your approval:/i.test(plain)) return null;
  return plain;
}

export function lastUserFacingPreview(
  messages: ReadonlyArray<Pick<Message, 'role' | 'content'>>,
): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message) {
      const line = messagePreviewLine(message);
      if (line !== null) return line;
    }
  }
  return '';
}
