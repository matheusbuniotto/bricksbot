import { describe, expect, test } from 'vitest';
import { chatRoute, parseChatRoute } from './chat-route';

describe('chat route', () => {
  test('round-trips a bot and chat id', () => {
    expect(parseChatRoute(chatRoute('bot-1', 'chat/2'))).toEqual({ botId: 'bot-1', chatId: 'chat/2' });
    expect(chatRoute('b', 'c')).toBe('#/bots/b/chats/c');
  });

  test('a bot link alone opens that bot', () => {
    expect(parseChatRoute('#/bots/bot-1')).toEqual({ botId: 'bot-1', chatId: undefined });
  });

  test('ignores other hashes', () => {
    for (const hash of ['', '#', '#/settings', '#/bots/', '#/bots/a/chats/', '#/bots/a/extra']) {
      expect(parseChatRoute(hash)).toBeNull();
    }
  });
});
