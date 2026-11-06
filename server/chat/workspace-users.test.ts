import { describe, expect, test, vi } from 'vitest';
import { DatabricksWorkspaceUserDirectory } from './workspace-users.js';

describe('DatabricksWorkspaceUserDirectory', () => {
  test('returns empty array if search query is shorter than 2 chars', async () => {
    const fetchImpl = vi.fn();
    const directory = new DatabricksWorkspaceUserDirectory({
      host: 'https://example.cloud.databricks.com',
      getToken: async () => 'test-token',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const res = await directory.searchUsers('a');
    expect(res).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('searches active users with SCIM filter and maps attributes', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        Resources: [
          {
            id: '123',
            userName: 'alice@example.com',
            displayName: 'Alice Smith',
            active: true,
          },
          {
            id: '456',
            userName: 'inactive@example.com',
            displayName: 'Inactive User',
            active: false,
          },
          {
            id: '789',
            emails: [{ value: 'bob@example.com', primary: true }],
            active: true,
          },
        ],
      }),
    });

    const directory = new DatabricksWorkspaceUserDirectory({
      host: 'https://example.cloud.databricks.com',
      getToken: async () => 'test-token',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const results = await directory.searchUsers('ice');
    expect(results).toEqual([
      {
        id: '123',
        userName: 'alice@example.com',
        displayName: 'Alice Smith',
        active: true,
      },
      {
        id: '789',
        userName: 'bob@example.com',
        displayName: 'bob',
        active: true,
      },
    ]);

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/2.0/preview/scim/v2/Users?');
    const parsedUrl = new URL(url);
    expect(parsedUrl.searchParams.get('count')).toBe('8');
    expect(parsedUrl.searchParams.get('attributes')).toBe('id,userName,displayName,active,emails');
    expect(parsedUrl.searchParams.get('filter')).toBe('active eq true and (userName co "ice" or displayName co "ice")');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-token');
  });

  test('escapes SCIM string characters in query', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ Resources: [] }),
    });

    const directory = new DatabricksWorkspaceUserDirectory({
      host: 'https://example.cloud.databricks.com',
      getToken: async () => 'test-token',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await directory.searchUsers('user"with\\quote');
    const [url] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const parsedUrl = new URL(url);
    expect(parsedUrl.searchParams.get('filter')).toContain('user\\"with\\\\quote');
  });

  test('findActiveUserByEmail returns matching user or null', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        Resources: [
          {
            id: '123',
            userName: 'alice@example.com',
            displayName: 'Alice Smith',
            active: true,
          },
        ],
      }),
    });

    const directory = new DatabricksWorkspaceUserDirectory({
      host: 'https://example.cloud.databricks.com',
      getToken: async () => 'test-token',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const found = await directory.findActiveUserByEmail('alice@example.com');
    expect(found).toEqual({
      id: '123',
      userName: 'alice@example.com',
      displayName: 'Alice Smith',
      active: true,
    });

    const empty = await directory.findActiveUserByEmail('   ');
    expect(empty).toBeNull();
  });

  test('throws descriptive error on SCIM failure', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      text: async () => 'SCIM API disabled in workspace',
    });

    const directory = new DatabricksWorkspaceUserDirectory({
      host: 'https://example.cloud.databricks.com',
      getToken: async () => 'test-token',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(directory.searchUsers('alice')).rejects.toThrow(
      'Databricks SCIM user lookup failed (403): SCIM API disabled in workspace'
    );
  });
});
