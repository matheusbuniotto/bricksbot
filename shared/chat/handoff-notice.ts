/** Structured bot-to-bot handoff notice stored in system message content. */

export type HandoffDirection = 'sent' | 'received' | 'thread';

export interface HandoffNotice {
  kind: 'handoff';
  direction: HandoffDirection;
  /** Peer bot to open / display (the other side of the thread). */
  targetBotId: string;
  targetName: string;
  targetChatId: string;
  senderBotId: string;
  senderName: string;
  brief: string;
  /** User+assistant messages in the bot-to-bot thread (for “N messages with …”). */
  messageCount?: number;
  replyPreview?: string;
}

export function serializeHandoffNotice(notice: HandoffNotice): string {
  return JSON.stringify(notice);
}

export function parseHandoffNotice(content: string): HandoffNotice | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith('{')) {
    const legacy = trimmed.match(/^Handed off to (.+)\.$/i);
    if (legacy?.[1]) {
      return {
        kind: 'handoff',
        direction: 'sent',
        targetBotId: '',
        targetName: legacy[1],
        targetChatId: '',
        senderBotId: '',
        senderName: '',
        brief: '',
      };
    }
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as Partial<HandoffNotice>;
    if (parsed.kind !== 'handoff' || !parsed.targetName) return null;
    const direction: HandoffDirection =
      parsed.direction === 'received' || parsed.direction === 'thread' ? parsed.direction : 'sent';
    return {
      kind: 'handoff',
      direction,
      targetBotId: typeof parsed.targetBotId === 'string' ? parsed.targetBotId : '',
      targetName: parsed.targetName,
      targetChatId: typeof parsed.targetChatId === 'string' ? parsed.targetChatId : '',
      senderBotId: typeof parsed.senderBotId === 'string' ? parsed.senderBotId : '',
      senderName: typeof parsed.senderName === 'string' ? parsed.senderName : '',
      brief: typeof parsed.brief === 'string' ? parsed.brief : '',
      messageCount: typeof parsed.messageCount === 'number' ? parsed.messageCount : undefined,
      replyPreview: typeof parsed.replyPreview === 'string' ? parsed.replyPreview : undefined,
    };
  } catch {
    return null;
  }
}

/** Collapse consecutive notices about the same peer — keep the latest (usually “N messages with”). */
export function collapseHandoffNotices<T extends { content: string }>(
  messages: T[],
  isSystem: (message: T) => boolean,
): T[] {
  const out: T[] = [];
  for (const message of messages) {
    if (!isSystem(message)) {
      out.push(message);
      continue;
    }
    const notice = parseHandoffNotice(message.content);
    if (!notice) {
      out.push(message);
      continue;
    }
    const peerKey = notice.targetBotId || notice.targetName;
    const prev = out[out.length - 1];
    if (prev && isSystem(prev)) {
      const prevNotice = parseHandoffNotice(prev.content);
      const prevKey = prevNotice ? prevNotice.targetBotId || prevNotice.targetName : null;
      if (prevKey && prevKey === peerKey) {
        out[out.length - 1] = message;
        continue;
      }
    }
    out.push(message);
  }
  return out;
}
