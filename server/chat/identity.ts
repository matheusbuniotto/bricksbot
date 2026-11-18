import type { Request } from 'express';

export function isDatabricksProxyEnvironment(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(
    env.DATABRICKS_APP_NAME || env.DATABRICKS_APP_ID || (env.DATABRICKS_HOST && env.NODE_ENV === 'production')
  );
}

/** Resolve a stable user id for Spaces ownership (OAuth email when available). */
export function resolveOwnerId(req?: Request): string {
  const headerEmail =
    req?.header?.('x-forwarded-email') ||
    req?.header?.('x-forwarded-user') ||
    (req as { headers?: Record<string, string | string[] | undefined> } | undefined)?.headers?.['x-forwarded-email'];
  if (typeof headerEmail === 'string' && headerEmail.trim()) {
    return headerEmail.trim().toLowerCase();
  }
  if (Array.isArray(headerEmail) && headerEmail[0]?.trim()) {
    return headerEmail[0].trim().toLowerCase();
  }
  // Local `npm run dev` often keeps DATABRICKS_APP_NAME from deploy templates; the browser
  // has no Apps proxy headers. Fall back in development so the UI can bootstrap.
  if (isDatabricksProxyEnvironment() && process.env.NODE_ENV !== 'development') {
    throw new Error('Authentication required: missing identity headers in Databricks proxy environment');
  }
  return process.env.BRICKSBOT_USER_ID?.trim() || 'workspace-user';
}
