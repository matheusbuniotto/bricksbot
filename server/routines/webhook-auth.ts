import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { ROUTINE_WEBHOOK_HEADER } from '../../shared/routines/types.js';

const WEBHOOK_HEADER = ROUTINE_WEBHOOK_HEADER;

/** Generate a URL-safe webhook secret for a new routine. */
export function generateWebhookSecret(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 hex hash of a webhook secret (stored; plaintext never persisted). */
export function hashWebhookSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

/** Constant-time compare of a presented secret against a stored hash. */
export function verifyWebhookSecret(secret: string, storedHash: string): boolean {
  if (!secret || !storedHash) return false;
  const presented = Buffer.from(hashWebhookSecret(secret), 'utf8');
  const expected = Buffer.from(storedHash, 'utf8');
  if (presented.length !== expected.length) return false;
  return timingSafeEqual(presented, expected);
}

/** Read only the dedicated webhook header (not Authorization — Apps OAuth uses Bearer). */
export function extractWebhookSecretHeader(
  headers: Record<string, string | string[] | undefined>,
): string | null {
  const raw = headers[WEBHOOK_HEADER] ?? headers[WEBHOOK_HEADER.toLowerCase()];
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  if (Array.isArray(raw) && raw[0]?.trim()) return raw[0].trim();
  return null;
}

/** Read Authorization Bearer token (legacy local callers; Jobs should prefer header/body). */
export function extractWebhookSecretBearer(
  headers: Record<string, string | string[] | undefined>,
): string | null {
  const auth = headers.authorization ?? headers.Authorization;
  const value = typeof auth === 'string' ? auth : Array.isArray(auth) ? auth[0] : undefined;
  if (!value) return null;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match?.[1]?.trim() || null;
}

/** Read the shared-secret header (or Authorization Bearer) from a request-like object. */
export function extractWebhookSecret(headers: Record<string, string | string[] | undefined>): string | null {
  return extractWebhookSecretHeader(headers) ?? extractWebhookSecretBearer(headers);
}

export { WEBHOOK_HEADER };
