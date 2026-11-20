import { describe, expect, it } from 'vitest';
import { isWaitingOnYou } from './waiting-on-you';

describe('isWaitingOnYou', () => {
  it("holds the composer for this chat's own approvals and choices", () => {
    expect(isWaitingOnYou('c1', [{ chatId: 'c1' }], [])).toBe(true);
    expect(isWaitingOnYou('c1', [], [{ chatId: 'c1' }])).toBe(true);
  });

  it("ignores cards from the bot's routine and handoff chats", () => {
    expect(isWaitingOnYou('c1', [{ chatId: 'routine' }], [{ chatId: 'handoff' }])).toBe(false);
  });

  it('is false with no chat open', () => {
    expect(isWaitingOnYou(undefined, [{ chatId: 'c1' }], [])).toBe(false);
  });
});
