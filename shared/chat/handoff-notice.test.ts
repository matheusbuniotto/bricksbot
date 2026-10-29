import { describe, expect, test } from 'vitest';
import {
  collapseHandoffNotices,
  parseHandoffNotice,
  serializeHandoffNotice,
} from './handoff-notice.js';

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
    expect(JSON.parse(collapsed[1]!.content).direction).toBe('thread');
    expect(JSON.parse(collapsed[1]!.content).messageCount).toBe(4);
  });
});
