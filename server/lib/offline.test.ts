import { describe, expect, test } from 'vitest';
import { isOfflineMode, offlineWorkspaceClient } from './offline.js';

describe('isOfflineMode', () => {
  test('offline with no host, profile, CLI config or Apps env', () => {
    expect(isOfflineMode({}, false)).toBe(true);
  });

  test('online when any workspace source exists', () => {
    expect(isOfflineMode({ DATABRICKS_HOST: 'https://x.cloud.databricks.com' }, false)).toBe(false);
    expect(isOfflineMode({ DATABRICKS_CONFIG_PROFILE: 'dev' }, false)).toBe(false);
    expect(isOfflineMode({ DATABRICKS_APP_NAME: 'bricksbot' }, false)).toBe(false);
    expect(isOfflineMode({}, true)).toBe(false);
  });

  test('BRICKSBOT_OFFLINE overrides detection', () => {
    expect(isOfflineMode({ BRICKSBOT_OFFLINE: '1', DATABRICKS_HOST: 'https://x' }, true)).toBe(true);
    expect(isOfflineMode({ BRICKSBOT_OFFLINE: '0' }, false)).toBe(false);
  });
});

describe('offlineWorkspaceClient', () => {
  test('answers the startup probes and refuses everything else', async () => {
    const client = offlineWorkspaceClient() as unknown as {
      currentUser: { me(): Promise<{ id: string }> };
      request(req: { path: string }): Promise<{ headers: Headers }>;
    };
    expect((await client.currentUser.me()).id).toBeTruthy();
    const me = await client.request({ path: '/api/2.0/preview/scim/v2/Me' });
    expect(me.headers.get('x-databricks-org-id')).toBe('0');
    await expect(client.request({ path: '/api/2.0/sql/warehouses' })).rejects.toThrow(/offline/);
  });
});
