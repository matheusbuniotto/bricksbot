import { describe, expect, it } from 'vitest';
import { validateMermaidSource } from './mermaid-source.js';
import { parseSqlQueryResult, SQL_TRUNCATION_MARKER } from './sql-result.js';
import { validateVegaLiteSpec } from './vega-spec.js';

describe('validateVegaLiteSpec', () => {
  it('accepts valid bar/line specs and enforces allowData/url/mark/size rules', () => {
    const valid = {
      mark: 'bar',
      encoding: {
        x: { field: 'month', type: 'ordinal' },
        y: { field: 'orders', type: 'quantitative' },
      },
    };
    expect(validateVegaLiteSpec(valid, { allowData: false }).ok).toBe(true);
    expect(validateVegaLiteSpec({ ...valid, data: { values: [] } }, { allowData: false }).ok).toBe(false);
    expect(validateVegaLiteSpec({ ...valid, data: { values: [] } }, { allowData: true }).ok).toBe(true);
    expect(validateVegaLiteSpec({ ...valid, data: { url: 'https://x.test/a.json' } }, { allowData: true }).ok).toBe(
      false
    );
    expect(validateVegaLiteSpec({ mark: 'geoshape' }, { allowData: false }).ok).toBe(false);
    expect(validateVegaLiteSpec({ mark: 'bar', description: 'x'.repeat(20_000) }, { allowData: false }).ok).toBe(false);
  });
});

describe('validateMermaidSource', () => {
  it('accepts the six allowed diagram types and rejects init directives, click handlers, or unknown types', () => {
    for (const prefix of [
      'flowchart LR\n  A --> B',
      'graph TD\n  A --> B',
      'sequenceDiagram\n  A->>B: hi',
      'stateDiagram-v2\n  [*] --> Still',
      'classDiagram\n  Animal <|-- Duck',
      'erDiagram\n  CUSTOMER ||--o{ ORDER : places',
    ]) {
      expect(validateMermaidSource(prefix).ok).toBe(true);
    }
    expect(validateMermaidSource('%%{init: {"theme": "dark"}}%%\nflowchart LR\nA-->B').ok).toBe(false);
    expect(validateMermaidSource('flowchart LR\n  A-->B\n  click A "http://evil"').ok).toBe(false);
    expect(validateMermaidSource('pie title Pets\n  "Dogs" : 1').ok).toBe(false);
  });
});

describe('parseSqlQueryResult', () => {
  it('parses tab-separated output into typed rows and refuses truncated or failed results', () => {
    const parsed = parseSqlQueryResult('month\torders\nJul\t120\nAug\t180');
    expect(parsed).toEqual({
      ok: true,
      columns: ['month', 'orders'],
      rows: [
        { month: 'Jul', orders: 120 },
        { month: 'Aug', orders: 180 },
      ],
    });
    expect(parseSqlQueryResult(`month\torders\nJul\t120\n${SQL_TRUNCATION_MARKER}`).ok).toBe(false);
    expect(parseSqlQueryResult('sql_query failed (500): boom').ok).toBe(false);
    expect(parseSqlQueryResult('(no rows)').ok).toBe(false);
  });
});
