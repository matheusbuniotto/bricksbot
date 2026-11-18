import { describe, expect, test, vi } from 'vitest';
import type { Request } from 'express';
import {
  createDatabricksTokenProvider,
  createM2mTokenProvider,
  getRequestUserAccessToken,
  resolveForwardedAccessToken,
  RoutineIdentityRequiredError,
  routineNeedsOwnerApproval,
  runWithDatabricksRequestAuth,
  runWithRoutineAuth,
  UserTokenRequiredError,
} from './databricks-auth.js';

function fakeReq(headers: Record<string, string>): Request {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    header: (name: string) => lower[name.toLowerCase()],
    headers: lower,
  } as unknown as Request;
}

describe('resolveForwardedAccessToken', () => {
  test('reads x-forwarded-access-token', () => {
    expect(resolveForwardedAccessToken(fakeReq({ 'x-forwarded-access-token': ' user-tok ' }))).toBe('user-tok');
  });

  test('returns undefined when missing', () => {
    expect(resolveForwardedAccessToken(fakeReq({}))).toBeUndefined();
  });
});

describe('runWithDatabricksRequestAuth', () => {
  test('exposes the OBO token to nested getToken calls', async () => {
    const getToken = createDatabricksTokenProvider({
      env: { DATABRICKS_TOKEN: 'pat-tok' },
    });
    await runWithDatabricksRequestAuth(fakeReq({ 'x-forwarded-access-token': 'obo-tok' }), async () => {
      expect(getRequestUserAccessToken()).toBe('obo-tok');
      await expect(getToken?.()).resolves.toBe('obo-tok');
    });
    expect(getRequestUserAccessToken()).toBeUndefined();
    await expect(getToken?.()).resolves.toBe('pat-tok');
  });
});

describe('createDatabricksTokenProvider', () => {
  test('falls back to PAT when no OBO token is present', async () => {
    const getToken = createDatabricksTokenProvider({
      env: { DATABRICKS_TOKEN: ' pat ' },
    });
    await expect(getToken?.()).resolves.toBe('pat');
  });

  test('falls back to M2M when PAT is absent', async () => {
    const m2mGetToken = vi.fn(async () => 'm2m-tok');
    const getToken = createDatabricksTokenProvider({
      env: {
        DATABRICKS_HOST: 'https://dbc.example.cloud.databricks.com',
        DATABRICKS_CLIENT_ID: 'cid',
        DATABRICKS_CLIENT_SECRET: 'sec',
      },
      m2mGetToken,
    });
    await expect(getToken?.()).resolves.toBe('m2m-tok');
    expect(m2mGetToken).toHaveBeenCalledTimes(1);
  });

  test('prefers OBO over PAT and M2M', async () => {
    const m2mGetToken = vi.fn(async () => 'm2m-tok');
    const getToken = createDatabricksTokenProvider({
      env: { DATABRICKS_TOKEN: 'pat' },
      m2mGetToken,
    });
    await runWithDatabricksRequestAuth(fakeReq({ 'x-forwarded-access-token': 'obo' }), async () => {
      await expect(getToken?.()).resolves.toBe('obo');
    });
    expect(m2mGetToken).not.toHaveBeenCalled();
  });
});

describe('routine turns', () => {
  test('owner_approval throws instead of falling back to the PAT or App SP', async () => {
    const m2mGetToken = vi.fn(() => Promise.resolve('m2m-tok'));
    const getToken = createDatabricksTokenProvider({ env: { DATABRICKS_TOKEN: 'pat' }, m2mGetToken });
    await runWithRoutineAuth('owner_approval', async () => {
      expect(routineNeedsOwnerApproval()).toBe(true);
      await expect(getToken?.()).rejects.toBeInstanceOf(RoutineIdentityRequiredError);
    });
    expect(m2mGetToken).not.toHaveBeenCalled();
  });

  test('app identity uses the PAT / App SP chain', async () => {
    const getToken = createDatabricksTokenProvider({ env: { DATABRICKS_TOKEN: 'pat' } });
    await runWithRoutineAuth('app', async () => {
      expect(routineNeedsOwnerApproval()).toBe(false);
      await expect(getToken?.()).resolves.toBe('pat');
    });
  });

  test('a routine started inside a request (Test) keeps the caller OBO token', async () => {
    const getToken = createDatabricksTokenProvider({ env: { DATABRICKS_TOKEN: 'pat' } });
    await runWithDatabricksRequestAuth(fakeReq({ 'x-forwarded-access-token': 'obo' }), () =>
      runWithRoutineAuth('owner_approval', async () => {
        expect(routineNeedsOwnerApproval()).toBe(false);
        await expect(getToken?.()).resolves.toBe('obo');
      })
    );
  });

  test('app purpose still falls back for non-data calls', async () => {
    const getToken = createDatabricksTokenProvider({ env: { DATABRICKS_TOKEN: 'pat' }, purpose: 'app' });
    await runWithRoutineAuth('owner_approval', async () => {
      await expect(getToken?.()).resolves.toBe('pat');
    });
  });
});

describe('interactive turns in a deployed App', () => {
  const appEnv = { DATABRICKS_APP_NAME: 'bricksbot', DATABRICKS_TOKEN: 'pat' };

  test('fail closed when the proxy omits the OBO token', async () => {
    const getToken = createDatabricksTokenProvider({ env: appEnv });
    await runWithDatabricksRequestAuth(fakeReq({}), async () => {
      await expect(getToken?.()).rejects.toBeInstanceOf(UserTokenRequiredError);
    });
  });

  test('BRICKSBOT_INTERACTIVE_SP_FALLBACK=allow restores the legacy fallback', async () => {
    const getToken = createDatabricksTokenProvider({
      env: { ...appEnv, BRICKSBOT_INTERACTIVE_SP_FALLBACK: 'allow' },
    });
    await runWithDatabricksRequestAuth(fakeReq({}), async () => {
      await expect(getToken?.()).resolves.toBe('pat');
    });
  });

  test('local development and background work keep the fallback', async () => {
    const dev = createDatabricksTokenProvider({ env: { ...appEnv, NODE_ENV: 'development' } });
    await runWithDatabricksRequestAuth(fakeReq({}), async () => {
      await expect(dev?.()).resolves.toBe('pat');
    });
    await expect(createDatabricksTokenProvider({ env: appEnv })?.()).resolves.toBe('pat');
  });
});

describe('createM2mTokenProvider', () => {
  test('requests a client-credentials token and caches it', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify({ access_token: 'm2m', expires_in: 3600 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const getToken = createM2mTokenProvider(
      'https://dbc.example.cloud.databricks.com/',
      'cid',
      'sec',
      fetchImpl as typeof fetch
    );
    await expect(getToken()).resolves.toBe('m2m');
    await expect(getToken()).resolves.toBe('m2m');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://dbc.example.cloud.databricks.com/oidc/v1/token');
    expect(init.method).toBe('POST');
  });
});
