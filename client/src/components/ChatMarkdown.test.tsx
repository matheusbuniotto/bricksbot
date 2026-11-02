import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChatMarkdown } from './ChatMarkdown';

describe('ChatMarkdown', () => {
  it('renders fenced sql blocks with language header and copy button and escapes raw HTML', () => {
    const html = renderToStaticMarkup(
      <ChatMarkdown content={'```sql\nSELECT * FROM t WHERE a < 1;\n```\n\n<script>alert(1)</script>'} />
    );
    expect(html).toContain('class="code-block"');
    expect(html).toContain('<span>sql</span>');
    expect(html).toContain('>Copy</button>');
    expect(html).toContain('SELECT * FROM t WHERE a &lt; 1;');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('routes fenced mermaid blocks through MermaidDiagram and falls back on disallowed diagrams', () => {
    const valid = renderToStaticMarkup(<ChatMarkdown content={'```mermaid\nflowchart LR\n  A --> B\n```'} />);
    expect(valid).toContain('class="artifact-mermaid"');

    const invalid = renderToStaticMarkup(<ChatMarkdown content={'```mermaid\npie title X\n  "a" : 1\n```'} />);
    expect(invalid).toContain('class="artifact-caption"');
    expect(invalid).toContain('mermaid diagram type must be one of');
  });
});
