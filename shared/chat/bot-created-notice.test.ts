import { describe, expect, test } from 'vitest';
import { parseBotCreatedNotice, serializeBotCreatedNotice } from './bot-created-notice.js';

describe('bot-created-notice', () => {
  test('round-trips a structured notice', () => {
    const notice = {
      kind: 'bot_created' as const,
      botId: 'b1',
      name: 'Analyst',
      chatId: 'c1',
      spaceId: 's1',
      job: 'Own weekly revenue review',
      createdByBotId: 'primary',
      createdByName: 'Primary',
    };
    expect(parseBotCreatedNotice(serializeBotCreatedNotice(notice))).toEqual(notice);
  });

  test('rejects non-bot_created JSON', () => {
    expect(parseBotCreatedNotice(JSON.stringify({ kind: 'handoff', targetName: 'x' }))).toBeNull();
    expect(parseBotCreatedNotice('Created a bot')).toBeNull();
  });
});
