import { AsyncLocalStorage } from 'node:async_hooks';
import type { Request } from 'express';
import type { RoutineRunAs } from '../../shared/routines/types.js';
import { presentEnv } from '../lib/env.js';
import { isDatabricksProxyEnvironment } from './identity.js';

/**
 * Request-scoped Databricks credentials for lakehouse tools.
 *
 * Lakehouse data (`purpose: 'data'`) runs as the signed-in user via the Apps proxy
 * OBO token (`x-forwarded-access-token`) so Unity Catalog grants, row filters and
 * masks match that user. It never silently becomes the App service principal:
 * - Routine turns have no user token. They throw `RoutineIdentityRequiredError`
 *   unless the routine runs as `app` (operator opt-in via
 *   `BRICKSBOT_ROUTINE_APP_IDENTITY=allow`); the owner's approval click supplies OBO.
 * - Interactive requests in a deployed App throw `UserTokenRequiredError` when the
 *   proxy omits the token, unless `BRICKSBOT_INTERACTIVE_SP_FALLBACK=allow`.
 * Outside a request (local dev, background work) and for `purpose: 'app'`, the
 * chain is OBO → PAT → app SP M2M.
 */

type DatabricksAuthStore = {
  userAccessToken?: string;
  routine?: { runAs: RoutineRunAs };
};

export class RoutineIdentityRequiredError extends Error {
  constructor() {
    super('This routine runs as its owner and needs their approval to access lakehouse data');
    this.name = 'RoutineIdentityRequiredError';
  }
}

export class UserTokenRequiredError extends Error {
  constructor() {
    super('no_user_token: the Databricks Apps proxy did not forward your access token (check user_api_scopes)');
    this.name = 'UserTokenRequiredError';
  }
}

/** Operator opt-in for routines that run as the App service principal. */
export function routineAppIdentityAllowed(env: Record<string, string | undefined> = process.env): boolean {
  return env.BRICKSBOT_ROUTINE_APP_IDENTITY?.trim().toLowerCase() === 'allow';
}

/** Legacy escape hatch: interactive turns fall back to PAT / App SP when OBO is missing. */
export function interactiveSpFallbackAllowed(env: Record<string, string | undefined> = process.env): boolean {
  return env.BRICKSBOT_INTERACTIVE_SP_FALLBACK?.trim().toLowerCase() === 'allow';
}

function requiresUserToken(env: Record<string, string | undefined>): boolean {
  return isDatabricksProxyEnvironment(env) && env.NODE_ENV !== 'development' && !interactiveSpFallbackAllowed(env);
}

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

/** Run a routine turn. Keeps a surrounding request's OBO token (routine Test runs as the caller). */
export function runWithRoutineAuth<T>(runAs: RoutineRunAs, fn: () => Promise<T>): Promise<T> {
  return authAls.run({ ...authAls.getStore(), routine: { runAs } }, fn);
}

/** True when this routine turn has no user token and may not use the App SP, so data tools need the owner. */
export function routineNeedsOwnerApproval(): boolean {
  const store = authAls.getStore();
  return Boolean(store?.routine && store.routine.runAs !== 'app' && !store.userAccessToken);
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
  /** `data` (default) never falls back to the App SP on routine or deployed interactive turns. */
  purpose?: 'data' | 'app';
  /** Override static PAT (tests). */
  staticToken?: string;
  /** Override M2M provider (tests). */
  m2mGetToken?: () => Promise<string>;
};

/**
 * Prefer request OBO → PAT → app SP M2M, with the `data` guards described at the top.
 */
export function createDatabricksTokenProvider(
  options: DatabricksTokenProviderOptions = {}
): (() => Promise<string>) | undefined {
  const env = options.env ?? process.env;
  const purpose = options.purpose ?? 'data';
  const staticToken = options.staticToken ?? presentEnv(env.DATABRICKS_TOKEN);
  const host = presentEnv(env.DATABRICKS_HOST) ?? presentEnv(env.DATABRICKS_WORKSPACE_URL);
  const clientId = presentEnv(env.DATABRICKS_CLIENT_ID);
  const clientSecret = presentEnv(env.DATABRICKS_CLIENT_SECRET);
  const m2mGetToken =
    options.m2mGetToken ??
    (host && clientId && clientSecret
      ? createM2mTokenProvider(host, clientId, clientSecret, options.fetchImpl)
      : undefined);

  return async () => {
    const store = authAls.getStore();
    if (store?.userAccessToken) return store.userAccessToken;
    if (purpose === 'data' && store?.routine && store.routine.runAs !== 'app') {
      throw new RoutineIdentityRequiredError();
    }
    if (purpose === 'data' && store && !store.routine && requiresUserToken(env)) {
      throw new UserTokenRequiredError();
    }
    if (staticToken) return staticToken;
    if (m2mGetToken) return m2mGetToken();
    throw new Error(
      'No Databricks credentials: missing x-forwarded-access-token, DATABRICKS_TOKEN, and CLIENT_ID/SECRET'
    );
  };
}
