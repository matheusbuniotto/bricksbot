import { describe, expect, test } from 'vitest';
import type { Message } from './types.js';
import {
  collapseHandoffNotices,
  handoffPeekBotId,
  parseHandoffNotice,
  serializeHandoffNotice,
  sliceHandoffThread,
} from './handoff-notice.js';

function msg(
  role: Message['role'],
  content: string,
  id = Math.random().toString(36).slice(2),
): Message {
  return {
    id,
    chatId: 'c',
    role,
    content,
    createdAt: new Date().toISOString(),
  };
}

describe('handoff-notice', () => {
  test('round-trips structured notices', () => {
    const raw = serializeHandoffNotice({
      kind: 'handoff',
      direction: 'thread',
      targetBotId: 'b1',
      targetName: 'JH',
      targetChatId: 'c1',
      senderBotId: 'p1',
      senderName: 'Primary',
      brief: 'research Tallinn',
      messageCount: 4,
      threadBotId: 'b1',
    });
    expect(parseHandoffNotice(raw)).toEqual({
      kind: 'handoff',
      direction: 'thread',
      targetBotId: 'b1',
      targetName: 'JH',
      targetChatId: 'c1',
      senderBotId: 'p1',
      senderName: 'Primary',
      brief: 'research Tallinn',
      messageCount: 4,
      replyPreview: undefined,
      threadBotId: 'b1',
    });
  });

  test('parses legacy plain notices without ids', () => {
    expect(parseHandoffNotice('Handed off to JH.')).toEqual(
      expect.objectContaining({
        kind: 'handoff',
        direction: 'sent',
        targetName: 'JH',
        targetBotId: '',
      }),
    );
  });

  test('collapses consecutive notices for the same peer', () => {
    const sent = serializeHandoffNotice({
      kind: 'handoff',
      direction: 'sent',
      targetBotId: 'jh',
      targetName: 'JH',
      targetChatId: 'c',
      senderBotId: 'p',
      senderName: 'Primary',
      brief: 'go',
      threadBotId: 'jh',
    });
    const thread = serializeHandoffNotice({
      kind: 'handoff',
      direction: 'thread',
      targetBotId: 'jh',
      targetName: 'JH',
      targetChatId: 'c',
      senderBotId: 'p',
      senderName: 'Primary',
      brief: 'go',
      messageCount: 4,
      threadBotId: 'jh',
    });
    const collapsed = collapseHandoffNotices(
      [
        { role: 'assistant', content: 'asking' },
        { role: 'system', content: sent },
        { role: 'system', content: thread },
        { role: 'assistant', content: 'summary' },
      ],
      (m) => m.role === 'system',
    );
    expect(collapsed).toHaveLength(3);
    const parsedNotice = parseHandoffNotice(collapsed[1]!.content);
    expect(parsedNotice?.direction).toBe('thread');
    expect(parsedNotice?.messageCount).toBe(4);
  });

  test('sliceHandoffThread keeps only the matching brief through reply', () => {
    const older = msg('user', 'From Primary: old brief');
    const olderReply = msg('assistant', 'old answer');
    const brief = msg('user', 'From Primary: research Tallinn');
    const reply = msg('assistant', 'Tallinn is cool');
    const chip = msg(
      'system',
      serializeHandoffNotice({
        kind: 'handoff',
        direction: 'thread',
        targetBotId: 'p',
        targetName: 'Primary',
        targetChatId: 'pc',
        senderBotId: 'jh',
        senderName: 'JH',
        brief: 'research Tallinn',
        messageCount: 2,
        threadBotId: 'jh',
      }),
    );
    const next = msg('user', 'From Primary: another handoff');

    const sliced = sliceHandoffThread(
      [older, olderReply, brief, reply, chip, next],
      { senderName: 'Primary', brief: 'research Tallinn' },
    );
    expect(sliced).toEqual([brief, reply]);

    // Teammate chip swaps display names; still finds the Primary brief line.
    const fromTeammateChip = sliceHandoffThread(
      [older, olderReply, brief, reply, chip, next],
      { senderName: 'JH', brief: 'research Tallinn' },
    );
    expect(fromTeammateChip).toEqual([brief, reply]);
  });

  test('handoffPeekBotId prefers threadBotId', () => {
    expect(
      handoffPeekBotId({
        kind: 'handoff',
        direction: 'thread',
        targetBotId: 'primary',
        targetName: 'Primary',
        targetChatId: 'tc',
        senderBotId: 'jh',
        senderName: 'JH',
        brief: 'x',
        threadBotId: 'jh',
      }),
    ).toBe('jh');
    expect(
      handoffPeekBotId({
        kind: 'handoff',
        direction: 'sent',
        targetBotId: 'jh',
        targetName: 'JH',
        targetChatId: 'c',
        senderBotId: 'p',
        senderName: 'Primary',
        brief: 'x',
      }),
    ).toBe('jh');
  });
});
