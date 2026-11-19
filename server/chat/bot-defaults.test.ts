import { describe, expect, test } from 'vitest';
import { titleFromMessage } from './bot-defaults.js';
import { searchTerms, snippetAround } from './search.js';

describe('titleFromMessage', () => {
  test('uses the first non-empty line with tidy spacing and no markdown lead-in', () => {
    expect(titleFromMessage('  \n## Plan   the  Q3 review \nsecond line')).toBe('Plan the Q3 review');
    expect(titleFromMessage('> - quoted ask')).toBe('quoted ask');
  });

  test('cuts long messages at a word and marks the cut', () => {
    const title = titleFromMessage('Please summarise the quarterly revenue by region and flag anything unusual today');
    expect(title).toBe('Please summarise the quarterly revenue by region and flag…');
    expect(title.length).toBeLessThanOrEqual(61);
    expect(titleFromMessage('x'.repeat(100))).toBe(`${'x'.repeat(60)}…`);
  });

  test('is empty when there is nothing to name the chat after', () => {
    expect(titleFromMessage('')).toBe('');
    expect(titleFromMessage(' \n ## ')).toBe('');
  });
});

describe('search helpers', () => {
  test('searchTerms lowercases and splits on whitespace', () => {
    expect(searchTerms('  Revenue   Q3 ')).toEqual(['revenue', 'q3']);
    expect(searchTerms('   ')).toEqual([]);
  });

  test('snippetAround centres on the first match and flattens lines', () => {
    expect(snippetAround('short\ntext here', 'text')).toBe('short text here');
    const long = `${'a '.repeat(100)}needle ${'b '.repeat(100)}`;
    const snippet = snippetAround(long, 'NEEDLE');
    expect(snippet).toContain('needle');
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet.length).toBeLessThan(135);
    expect(snippetAround('no match in this one', 'zzz')).toBe('no match in this one');
  });
});
