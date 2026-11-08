import type { ToolDefinition } from '../../../shared/agents/types.js';
import { clip, readText } from '../../lib/coerce.js';
import { presentEnv } from '../../lib/env.js';

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
  return (presentEnv(raw) ?? '')
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
      const url = readText(args.url);
      if (!url) return 'web_fetch requires a url';
      if (!isUrlAllowlisted(url, options.allowlist)) {
        return `URL is not on the web_fetch allowlist: ${url}`;
      }
      return null;
    },
    async execute(args: Record<string, unknown>): Promise<string> {
      const fetchImpl = options.fetchImpl ?? globalThis.fetch;
      const url = readText(args.url);
      if (!isUrlAllowlisted(url, options.allowlist)) {
        throw new Error(`URL is not on the web_fetch allowlist: ${url}`);
      }

      const response = await fetchFollowingAllowlist(url, options.allowlist, fetchImpl, AbortSignal.timeout(timeoutMs));
      if (!response.ok) {
        throw new Error(`web_fetch failed (${response.status}) for ${url}`);
      }
      const contentType = response.headers?.get?.('content-type') ?? '';
      const rawText = await readBodyCapped(response, MAX_BODY_BYTES);
      const text = contentType.includes('text/html') || /<html[\s>]/i.test(rawText) ? cleanHtmlText(rawText) : rawText;
      return clip(text, maxChars);
    },
  };
}

const MAX_REDIRECTS = 5;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

/** Follow redirects by hand so every hop is re-checked against the allowlist. */
async function fetchFollowingAllowlist(
  url: string,
  allowlist: string[],
  fetchImpl: typeof fetch,
  signal: AbortSignal
): Promise<Response> {
  let current = url;
  for (let hop = 0; ; hop += 1) {
    const response = await fetchImpl(current, {
      method: 'GET',
      redirect: 'manual',
      signal,
      headers: { Accept: 'text/plain, text/html, application/json' },
    });
    const location = response.status >= 300 && response.status < 400 ? response.headers.get('location') : null;
    if (!location) return response;
    if (hop === MAX_REDIRECTS) throw new Error(`web_fetch stopped after ${MAX_REDIRECTS} redirects`);
    current = new URL(location, current).href;
    if (!isUrlAllowlisted(current, allowlist)) {
      throw new Error(`web_fetch redirect left the allowlist: ${current}`);
    }
  }
}

async function readBodyCapped(response: Response, maxBytes: number): Promise<string> {
  const reader: ReadableStreamDefaultReader<Uint8Array> | undefined = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, maxBytes));
}
