/** Structured bot-to-bot handoff notice stored in system message content. */

import type { Message } from './types.js';

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
  /**
   * Bot whose chat holds the brief + teammate reply (always the teammate).
   * Peek loads this chat; display still uses targetBotId / targetName.
   */
  threadBotId?: string;
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
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!('kind' in parsed) || parsed.kind !== 'handoff') return null;
    if (!('targetName' in parsed) || typeof parsed.targetName !== 'string' || !parsed.targetName) return null;
    const rawDir = 'direction' in parsed && typeof parsed.direction === 'string' ? parsed.direction : '';
    const direction: HandoffDirection =
      rawDir === 'received' || rawDir === 'thread' ? rawDir : 'sent';
    return {
      kind: 'handoff',
      direction,
      targetBotId: 'targetBotId' in parsed && typeof parsed.targetBotId === 'string' ? parsed.targetBotId : '',
      targetName: parsed.targetName,
      targetChatId: 'targetChatId' in parsed && typeof parsed.targetChatId === 'string' ? parsed.targetChatId : '',
      senderBotId: 'senderBotId' in parsed && typeof parsed.senderBotId === 'string' ? parsed.senderBotId : '',
      senderName: 'senderName' in parsed && typeof parsed.senderName === 'string' ? parsed.senderName : '',
      brief: 'brief' in parsed && typeof parsed.brief === 'string' ? parsed.brief : '',
      messageCount: 'messageCount' in parsed && typeof parsed.messageCount === 'number' ? parsed.messageCount : undefined,
      replyPreview: 'replyPreview' in parsed && typeof parsed.replyPreview === 'string' ? parsed.replyPreview : undefined,
      threadBotId: 'threadBotId' in parsed && typeof parsed.threadBotId === 'string' ? parsed.threadBotId : undefined,
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

export function handoffBriefUserLine(senderName: string, brief: string): string {
  return `From ${senderName}: ${brief}`;
}

function isHandoffBriefUserLine(content: string, brief: string, senderName?: string): boolean {
  if (senderName && content === handoffBriefUserLine(senderName, brief)) return true;
  // Teammate-side chips swap display sender/target; match the brief body either way.
  return content.startsWith('From ') && content.endsWith(`: ${brief}`);
}

/**
 * Slice the teammate chat to the handoff thread: from the “From …: brief” user line
 * through the following assistant/tool rows until the next handoff brief or end.
 */
export function sliceHandoffThread(
  messages: Message[],
  notice: Pick<HandoffNotice, 'senderName' | 'brief'>,
): Message[] {
  if (!notice.brief) return messages;
  let start = -1;
  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i];
    if (message && message.role === 'user' && isHandoffBriefUserLine(message.content, notice.brief, notice.senderName)) {
      start = i;
    }
  }
  if (start < 0) return messages;

  let end = messages.length;
  for (let i = start + 1; i < messages.length; i += 1) {
    const message = messages[i];
    if (message && message.role === 'user' && message.content.startsWith('From ') && message.content.includes(': ')) {
      end = i;
      break;
    }
    if (message.role === 'system' && parseHandoffNotice(message.content)?.direction === 'thread') {
      end = i; // stop before the chip itself in peek
      break;
    }
  }
  return messages.slice(start, end).filter((message) => message.role !== 'system');
}

/** Bot id whose chat should be loaded for peek. */
export function handoffPeekBotId(notice: HandoffNotice): string {
  return notice.threadBotId || notice.targetBotId;
}
