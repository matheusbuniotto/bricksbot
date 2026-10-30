import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  formatChatTimeSeparator,
  shouldShowChatTimeSeparator,
} from './chat-time';

afterEach(() => {
  vi.useRealTimers();
});

describe('shouldShowChatTimeSeparator', () => {
  test('false when gap is 2h or less', () => {
    expect(
      shouldShowChatTimeSeparator('2026-10-26T10:00:00.000Z', '2026-10-26T12:00:00.000Z'),
    ).toBe(false);
    expect(
      shouldShowChatTimeSeparator('2026-10-26T10:00:00.000Z', '2026-10-26T11:59:59.000Z'),
    ).toBe(false);
  });

  test('true when gap is more than 2h', () => {
    expect(
      shouldShowChatTimeSeparator('2026-10-26T10:00:00.000Z', '2026-10-26T12:00:01.000Z'),
    ).toBe(true);
  });

  test('false for missing or invalid timestamps', () => {
    expect(shouldShowChatTimeSeparator(undefined, '2026-10-26T12:00:01.000Z')).toBe(false);
    expect(shouldShowChatTimeSeparator('2026-10-26T10:00:00.000Z', 'nope')).toBe(false);
  });
});

describe('formatChatTimeSeparator', () => {
  test('today shows clock only', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-30T18:00:00'));
    const label = formatChatTimeSeparator(new Date('2026-10-30T14:30:00').toISOString(), new Date(), 'en-US');
    expect(label).toMatch(/2:30|14:30/);
    expect(label?.toLowerCase()).not.toContain('yesterday');
  });

  test('yesterday prefixes localized Yesterday', () => {
    const now = new Date(2026, 9, 30, 18, 0, 0);
    const yesterday = new Date(2026, 9, 29, 14, 30, 0);
    const en = formatChatTimeSeparator(yesterday.toISOString(), now, 'en-US');
    expect(en?.startsWith('Yesterday ')).toBe(true);
    expect(en).toMatch(/2:30|14:30/);

    const pt = formatChatTimeSeparator(yesterday.toISOString(), now, 'pt-BR');
    expect(pt?.toLowerCase().startsWith('ontem ')).toBe(true);
  });

  test('older days use weekday + date + time', () => {
    const now = new Date(2026, 9, 30, 18, 0, 0);
    const older = new Date(2026, 9, 26, 23, 1, 0);
    const pt = formatChatTimeSeparator(older.toISOString(), now, 'pt-BR');
    expect(pt).toMatch(/26/);
    expect(pt).toMatch(/out/i);
    expect(pt).toMatch(/23:01|11:01/);
    expect(pt?.toLowerCase()).toMatch(/seg/);
  });
});
