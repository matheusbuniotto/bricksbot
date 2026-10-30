import { describe, expect, it } from 'vitest';
import { parseChartBody, parseTableBody } from './artifact-render';

describe('artifact-render', () => {
  it('parses a table and caps rows', () => {
    const rows = Array.from({ length: 300 }, (_, i) => [i]);
    const t = parseTableBody(JSON.stringify({ columns: ['n'], rows }));
    expect(t?.rows).toHaveLength(200);
  });
  it('rejects malformed table and chart', () => {
    expect(parseTableBody('nope')).toBeNull();
    expect(parseChartBody(JSON.stringify({ type: 'bar', x: ['a'], y: [1, 2] }))).toBeNull();
    expect(parseChartBody(JSON.stringify({ type: 'pie', x: ['a'], y: [1] }))).toBeNull();
  });
  it('parses a chart', () => {
    expect(parseChartBody(JSON.stringify({ type: 'line', x: ['a', 'b'], y: [1, 2] }))?.type).toBe('line');
  });
});

import { parseVegaBody } from './artifact-render';

describe('parseVegaBody', () => {
  it('accepts inline-data specs and rejects remote data or non-specs', () => {
    expect(parseVegaBody(JSON.stringify({ mark: 'bar', data: { values: [] } }))).not.toBeNull();
    expect(parseVegaBody(JSON.stringify({ mark: 'bar', data: { url: 'http://x' } }))).toBeNull();
    expect(parseVegaBody(JSON.stringify({ type: 'bar', x: ['a'], y: [1] }))).toBeNull();
  });
});
