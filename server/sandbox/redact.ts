import * as path from 'node:path';

/** Default cap for command/output previews stored in `sandbox_events`. */
export const MAX_PREVIEW_CHARS = 2_048;

/** Common credential patterns redacted even if not in the explicit secrets list. */
const BUILTIN_SECRET_PATTERNS: RegExp[] = [
  /\bdapi[a-f0-9]{20,}\b/gi,
  /\be2b_[A-Za-z0-9_-]{12,}\b/g,
  /\bsk-or-v1-[A-Za-z0-9_-]{16,}\b/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]{16,}/gi,
];

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Redact known secret values and common token shapes from text before logging or storing.
 */
export function redactSecrets(text: string, secrets: Iterable<string> = []): string {
  if (!text) return '';
  let out = text;

  for (const raw of secrets) {
    const trimmed = raw?.trim();
    if (!trimmed || trimmed === '__UNSET__' || trimmed.length < 4) continue;
    out = out.replace(new RegExp(escapeRegExp(trimmed), 'g'), '[REDACTED]');
  }

  for (const pattern of BUILTIN_SECRET_PATTERNS) {
    out = out.replace(pattern, (match) => (/^Bearer\s+/i.test(match) ? 'Bearer [REDACTED]' : '[REDACTED]'));
  }

  return out;
}

/**
 * Truncate text to `maxChars` after redacting secrets.
 */
export function truncatePreview(
  text: string,
  secrets: Iterable<string> = [],
  maxChars: number = MAX_PREVIEW_CHARS
): string {
  const redacted = redactSecrets(text, secrets);
  if (redacted.length <= maxChars) return redacted;
  return `${redacted.slice(0, maxChars)}…[truncated]`;
}

/**
 * Recursively redact and truncate strings in an event payload before persisting.
 */
export function sanitizeEventPayload(
  payload: Record<string, unknown>,
  secrets: Iterable<string> = [],
  maxChars: number = MAX_PREVIEW_CHARS
): Record<string, unknown> {
  const secretList = [...secrets];
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === 'string') {
      out[key] = truncatePreview(value, secretList, maxChars);
    } else if (Array.isArray(value)) {
      out[key] = value.map((item) => (typeof item === 'string' ? truncatePreview(item, secretList, maxChars) : item));
    } else if (value && typeof value === 'object') {
      out[key] = sanitizeEventPayload(value as Record<string, unknown>, secretList, maxChars);
    } else {
      out[key] = value;
    }
  }

  return out;
}

/**
 * Extract only the artifact basename (never expose raw sandbox paths in UI per §5.6).
 */
export function safeArtifactName(rawPath: string | undefined | null): string | undefined {
  if (!rawPath) return undefined;
  const trimmed = rawPath.trim();
  if (!trimmed) return undefined;
  const base = path.posix.basename(trimmed.replace(/\\/g, '/'));
  return base && base !== '.' && base !== '..' ? base : undefined;
}

/**
 * Replace raw sandbox paths (`/home/sandbox-agent/...`, `/home/user/...`, `/tmp/...`)
 * with just their basename for UI display.
 */
export function stripSandboxPaths(text: string): string {
  if (!text) return '';
  return text.replace(
    /(?:\/home\/(?:sandbox-agent|user)|\/tmp|\/workspace)(?:\/[^\s"'`:;]+)+/g,
    (match) => safeArtifactName(match) ?? 'file'
  );
}
