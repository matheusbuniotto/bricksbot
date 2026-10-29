import { describe, expect, test } from 'vitest';
import { formatBotContext } from './context.js';

describe('formatBotContext', () => {
  test('includes memories and a skills index without inlining full bodies', () => {
    const longBody = [
      'Prefer concise SQL.',
      'Always qualify tables.',
      'x'.repeat(2_000),
    ].join('\n');
    const section = formatBotContext(
      [{ key: 'warehouse', content: 'us-west', updatedAt: '2026-01-01T00:00:00.000Z' }],
      [{ name: 'SQL style', body: longBody }]
    );

    expect(section).toContain('warehouse: us-west');
    expect(section).toContain('SQL style');
    expect(section).toContain('Prefer concise SQL.');
    expect(section).not.toContain('## SQL style');
    expect(section).not.toContain(longBody);
    expect(section).toMatch(/Skills \(index/);
  });

  test('keeps the newest memories', () => {
    const section = formatBotContext(
      [
        { key: 'old', content: 'stale', updatedAt: '2026-01-01T00:00:00.000Z' },
        { key: 'mid', content: 'kept-mid', updatedAt: '2026-02-01T00:00:00.000Z' },
        { key: 'new', content: 'kept-new', updatedAt: '2026-03-01T00:00:00.000Z' },
      ],
      [],
      { memoryLimit: 2 }
    );

    expect(section).not.toContain('stale');
    expect(section).toContain('kept-mid');
    expect(section).toContain('kept-new');
  });

  test('stops at the character cap', () => {
    const section = formatBotContext(
      [
        {
          key: 'warehouse',
          content: 'x'.repeat(100),
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      [],
      { charCap: 20 }
    );

    expect(section).toHaveLength(20);
    expect(section.startsWith('Memories:')).toBe(true);
  });

  test('returns an empty section when the bot has nothing stored', () => {
    expect(formatBotContext([], [])).toBe('');
  });
});
