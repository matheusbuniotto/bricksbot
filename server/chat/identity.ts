import type { Request } from 'express';

/** Resolve a stable user id for Spaces ownership (OAuth email when available). */
export function resolveOwnerId(req?: Request): string {
  const headerEmail =
    req?.header?.('x-forwarded-email') ||
    req?.header?.('x-forwarded-user') ||
    (req as { headers?: Record<string, string | string[] | undefined> } | undefined)?.headers?.[
      'x-forwarded-email'
    ];
  if (typeof headerEmail === 'string' && headerEmail.trim()) {
    return headerEmail.trim().toLowerCase();
  }
  if (Array.isArray(headerEmail) && headerEmail[0]?.trim()) {
    return headerEmail[0].trim().toLowerCase();
  }
  return process.env.BRICKSBOT_USER_ID?.trim() || 'workspace-user';
}
