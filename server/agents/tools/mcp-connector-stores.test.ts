import { describe, expect, it } from 'vitest';
import { LakebaseMcpConnectorStore } from './mcp-connector-lakebase-store.js';
import { MemoryMcpConnectorStore } from './mcp-connector-memory-store.js';

describe('MemoryMcpConnectorStore', () => {
  it('keeps each user’s connectors separate', async () => {
    const store = new MemoryMcpConnectorStore();
    await store.upsertConnector({
      userId: 'alice',
      service: 'main.analytics.custom_mcp',
      connected: true,
      custom: true,
      tools: ['query'],
    });

    expect(await store.listConnectors('bob')).toEqual([]);
    expect(await store.getConnector('bob', 'main.analytics.custom_mcp')).toBeNull();
    expect(await store.deleteConnector('bob', 'main.analytics.custom_mcp')).toBe(false);
    expect((await store.listConnectors('alice')).map((record) => record.service)).toEqual([
      'main.analytics.custom_mcp',
    ]);
  });
});

describe('LakebaseMcpConnectorStore', () => {
  it('scopes every query by user_id', async () => {
    const calls: Array<{ sql: string; params?: unknown[] }> = [];
    const row = {
      user_id: 'alice',
      service: 'system.ai.web_search',
      connected: true,
      is_custom: false,
      name: null,
      description: null,
      tools: ['web_search'],
      created_at: '2026-11-17T00:00:00.000Z',
      updated_at: '2026-11-17T00:00:00.000Z',
    };
    const store = new LakebaseMcpConnectorStore((sql, params) => {
      calls.push({ sql, params });
      return Promise.resolve({ rows: [row] });
    });

    await store.listConnectors('alice');
    await store.getConnector('alice', 'system.ai.web_search');
    const saved = await store.upsertConnector({
      userId: 'alice',
      service: 'system.ai.web_search',
      connected: true,
      custom: false,
      tools: ['web_search'],
    });
    await store.deleteConnector('alice', 'system.ai.web_search');

    expect(saved).toMatchObject({ userId: 'alice', connected: true, custom: false, tools: ['web_search'] });
    for (const call of calls) {
      expect(call.sql).toContain('user_id');
      expect(call.params?.[0]).toBe('alice');
    }
    expect(calls[2]?.sql).toContain('ON CONFLICT (user_id, service)');
  });
});
