import { AsyncLocalStorage } from 'node:async_hooks';
import type { Request } from 'express';
import { presentEnv } from '../lib/env.js';

/**
 * Request-scoped Databricks credentials for lakehouse tools.
 *
 * Interactive chat prefers the Apps proxy OBO token (`x-forwarded-access-token`)
 * so Unity Catalog / warehouse permissions match the signed-in user. Falls back
 * to PAT or app service-principal M2M when no user token is present (local,
 * routines, background work).
 */

type DatabricksAuthStore = {
  userAccessToken?: string;
};

const authAls = new AsyncLocalStorage<DatabricksAuthStore>();

function headerValue(req: Request | undefined, name: string): string | undefined {
  if (!req) return undefined;
  const fromHelper = typeof req.header === 'function' ? req.header(name) : undefined;
  if (typeof fromHelper === 'string' && fromHelper.trim()) return fromHelper.trim();
  const raw = (req as { headers?: Record<string, string | string[] | undefined> }).headers?.[name.toLowerCase()];
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  if (Array.isArray(raw) && raw[0]?.trim()) return raw[0].trim();
  return undefined;
}

/** Extract the short-lived user OAuth token forwarded by Databricks Apps. */
export function resolveForwardedAccessToken(req?: Request): string | undefined {
  return headerValue(req, 'x-forwarded-access-token');
}

export function getRequestUserAccessToken(): string | undefined {
  return authAls.getStore()?.userAccessToken;
}

/** Run work with the request's OBO token available to lakehouse tools. */
export function runWithDatabricksRequestAuth<T>(req: Request | undefined, fn: () => Promise<T>): Promise<T> {
  const userAccessToken = resolveForwardedAccessToken(req);
  return authAls.run({ userAccessToken }, fn);
}

export function normalizeHostUrl(rawHost: string): string {
  const trimmed = rawHost.trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function createM2mTokenProvider(
  host: string,
  clientId: string,
  clientSecret: string,
  fetchImpl: typeof fetch = globalThis.fetch
): () => Promise<string> {
  let cached: { token: string; expiresAtMs: number } | null = null;
  const baseUrl = normalizeHostUrl(host);

  return async () => {
    if (cached && Date.now() < cached.expiresAtMs - 60_000) {
      return cached.token;
    }
    const basic = Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64');
    const res = await fetchImpl(`${baseUrl}/oidc/v1/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials&scope=all-apis',
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Databricks OAuth token request failed (${res.status}): ${detail || res.statusText}`);
    }
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) {
      throw new Error('Databricks OAuth token response missing access_token');
    }
    const ttlSec = typeof data.expires_in === 'number' ? data.expires_in : 3600;
    cached = {
      token: data.access_token,
      expiresAtMs: Date.now() + ttlSec * 1000,
    };
    return cached.token;
  };
}

export type DatabricksTokenProviderOptions = {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  /** Override static PAT (tests). */
  staticToken?: string;
  /** Override M2M provider (tests). */
  m2mGetToken?: () => Promise<string>;
};

/**
 * Prefer request OBO → PAT → app SP M2M. Returns undefined when nothing can
 * authenticate (caller should surface a config error).
 */
export function createDatabricksTokenProvider(
  options: DatabricksTokenProviderOptions = {}
): (() => Promise<string>) | undefined {
  const env = options.env ?? process.env;
  const staticToken = options.staticToken ?? presentEnv(env.DATABRICKS_TOKEN);
  const host = presentEnv(env.DATABRICKS_HOST) ?? presentEnv(env.DATABRICKS_WORKSPACE_URL);
  const clientId = presentEnv(env.DATABRICKS_CLIENT_ID);
  const clientSecret = presentEnv(env.DATABRICKS_CLIENT_SECRET);
  const m2mGetToken =
    options.m2mGetToken ??
    (host && clientId && clientSecret
      ? createM2mTokenProvider(host, clientId, clientSecret, options.fetchImpl)
      : undefined);

  if (!staticToken && !m2mGetToken) {
    // Still return a provider that can succeed when an OBO token is on the ALS.
    return async () => {
      const user = getRequestUserAccessToken();
      if (user) return user;
      throw new Error(
        'No Databricks credentials: missing x-forwarded-access-token, DATABRICKS_TOKEN, and CLIENT_ID/SECRET'
      );
    };
  }

  return async () => {
    const user = getRequestUserAccessToken();
    if (user) return user;
    if (staticToken) return staticToken;
    if (m2mGetToken) return m2mGetToken();
    throw new Error('No Databricks credentials available');
  };
}
