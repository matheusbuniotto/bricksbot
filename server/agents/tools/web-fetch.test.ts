import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanHtmlText, createWebFetchTool, isUrlAllowlisted } from './web-fetch.js';

describe('cleanHtmlText', () => {
  test('strips scripts, styles, and tags while preserving readable text', () => {
    const html = `
      <html>
        <head>
          <style>body { color: red; }</style>
          <script>console.log('secret');</script>
        </head>
        <body>
          <h1>Welcome &amp; Hello</h1>
          <p>Here is a paragraph with <a href="/test">a link</a> &lt;info&gt;.</p>
        </body>
      </html>
    `;
    const cleaned = cleanHtmlText(html);
    expect(cleaned).not.toContain('color: red');
    expect(cleaned).not.toContain('console.log');
    expect(cleaned).toContain('Welcome & Hello');
    expect(cleaned).toContain('Here is a paragraph with a link <info>.');
  });
});

describe('web_fetch allowlist', () => {
  test('allows exact host and subdomain matches', () => {
    const allow = ['example.com', 'docs.databricks.com'];
    expect(isUrlAllowlisted('https://example.com/a', allow)).toBe(true);
    expect(isUrlAllowlisted('https://www.example.com/a', allow)).toBe(true);
    expect(isUrlAllowlisted('https://docs.databricks.com/x', allow)).toBe(true);
    expect(isUrlAllowlisted('https://evil.com', allow)).toBe(false);
    expect(isUrlAllowlisted('http://example.com', allow)).toBe(false);
  });
});

describe('createWebFetchTool', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('preflight validates url and allowlist', () => {
    const tool = createWebFetchTool({ allowlist: ['example.com'] });
    expect(tool.preflight({ url: '' })).toMatch(/requires a url/);
    expect(tool.preflight({ url: 'https://evil.com' })).toMatch(/allowlist/);
    expect(tool.preflight({ url: 'https://example.com/ok' })).toBeNull();
  });

  test('fetches allowlisted HTTPS pages as text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('hello page', { status: 200, headers: { 'content-type': 'text/plain' } }))
    );
    const tool = createWebFetchTool({ allowlist: ['example.com'] });
    const result = await tool.execute({ url: 'https://example.com/docs' });
    expect(result).toContain('hello page');
  });

  test('cleans HTML responses when content-type is text/html', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('<html><body><h1>Hello HTML</h1><script>alert(1)</script></body></html>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
          })
      )
    );
    const tool = createWebFetchTool({ allowlist: ['example.com'] });
    const result = await tool.execute({ url: 'https://example.com/page' });
    expect(result).toContain('Hello HTML');
    expect(result).not.toContain('alert(1)');
  });

  test('rejects non-allowlisted hosts', async () => {
    const tool = createWebFetchTool({ allowlist: ['example.com'] });
    await expect(tool.execute({ url: 'https://not-allowed.test' })).rejects.toThrow(/allowlist/i);
  });
});
