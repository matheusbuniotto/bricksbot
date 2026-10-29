import type { ToolDefinition } from '../../../shared/llm/types.js';

export function isUrlAllowlisted(url: string, allowlist: string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  return allowlist.some((entry) => {
    const needle = entry.trim().toLowerCase();
    if (!needle) return false;
    return host === needle || host.endsWith(`.${needle}`);
  });
}

export function parseAllowlist(raw: string | undefined): string[] {
  if (!raw?.trim() || raw.trim() === '__UNSET__') return [];
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

export function cleanHtmlText(html: string): string {
  let text = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ')
    .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*[/]?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  text = text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

export const webFetchToolDefinition: ToolDefinition = {
  name: 'web_fetch',
  description: 'Fetch the text content of an allowlisted HTTPS URL. Requires user approval.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      url: { type: 'string', description: 'HTTPS URL to fetch' },
    },
    required: ['url'],
  },
};

export function createWebFetchTool(options: {
  allowlist: string[];
  fetchImpl?: typeof fetch;
  maxChars?: number;
  timeoutMs?: number;
}) {
  const maxChars = options.maxChars ?? 20_000;
  const timeoutMs = options.timeoutMs ?? 15_000;

  return {
    definition: webFetchToolDefinition,
    preflight(args: Record<string, unknown>): string | null {
      const url = typeof args.url === 'string' ? args.url.trim() : '';
      if (!url) return 'web_fetch requires a url';
      if (!isUrlAllowlisted(url, options.allowlist)) {
        return `URL is not on the web_fetch allowlist: ${url}`;
      }
      return null;
    },
    async execute(args: Record<string, unknown>): Promise<string> {
      const fetchImpl = options.fetchImpl ?? globalThis.fetch;
      const url = typeof args.url === 'string' ? args.url.trim() : '';
      if (!isUrlAllowlisted(url, options.allowlist)) {
        throw new Error(`URL is not on the web_fetch allowlist: ${url}`);
      }

      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

      try {
        const response = await fetchImpl(url, {
          method: 'GET',
          redirect: 'follow',
          signal: controller?.signal,
          headers: { Accept: 'text/plain, text/html, application/json' },
        });
        if (!response.ok) {
          throw new Error(`web_fetch failed (${response.status}) for ${url}`);
        }
        const contentType = response.headers?.get?.('content-type') ?? '';
        const rawText = await response.text();
        const text = contentType.includes('text/html') || /<html[\s>]/i.test(rawText)
          ? cleanHtmlText(rawText)
          : rawText;
        return text.length > maxChars ? `${text.slice(0, maxChars)}\n…[truncated]` : text;
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };
}
