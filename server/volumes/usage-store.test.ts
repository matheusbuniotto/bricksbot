import { describe, expect, test } from 'vitest';
import { assessVolumeQuota, sanitizeVolumeUserId } from '../agents/tools/volume-namespace.js';
import type { LakebaseQuery } from '../chat/lakebase-store.js';
import { CHAT_SCHEMA_STATEMENTS } from '../chat/schema.js';
import { LakebaseVolumeUsageStore, MemoryVolumeUsageStore } from './usage-store.js';

describe('volume usage quotas', () => {
  test('memory counters stay inside one user', async () => {
    const store = new MemoryVolumeUsageStore();
    const alice = sanitizeVolumeUserId('Alice@Co.com');
    const bob = sanitizeVolumeUserId('bob/../../alice@co.com');
    expect(alice).toBe('alice@co.com');
    expect(bob).not.toBe(alice);

    await store.addBytes(alice!, 'bot-a', 100);
    await store.addBytes(alice!, 'bot-b', 40);
    await store.addBytes(bob!, 'bot-a', 7);

    expect(await store.getUsage(alice!, 'bot-a')).toEqual({ userBytes: 140, botBytes: 100 });
    expect(await store.getUsage(bob!, 'bot-a')).toEqual({ userBytes: 7, botBytes: 7 });

    const limits = { maxWriteBytes: 50, userQuotaBytes: 150 };
    const rejected = assessVolumeQuota({
      ...(await store.getUsage(alice!, 'bot-a')),
      incomingBytes: 20,
      limits,
    });
    expect(rejected.ok).toBe(false);
    const allowed = assessVolumeQuota({
      ...(await store.getUsage(bob!, 'bot-a')),
      incomingBytes: 20,
      limits,
    });
    expect(allowed.ok).toBe(true);
  });

  test('lakebase increments only the addressed user and bot', async () => {
    const rows = new Map<string, number>();
    const query: LakebaseQuery = async (sql, params = []) => {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (normalized.startsWith('INSERT INTO bricksbot.volume_usage')) {
        const [userId, botId, bytes] = [String(params[0]), String(params[1]), Number(params[2])];
        const key = `${userId}\0${botId}`;
        rows.set(key, (rows.get(key) ?? 0) + bytes);
        return { rows: [] };
      }
      if (normalized.includes('AND bot_id = $2')) {
        const key = `${String(params[0])}\0${String(params[1])}`;
        return { rows: [{ bytes: rows.get(key) ?? 0 }] };
      }
      const prefix = `${String(params[0])}\0`;
      let sum = 0;
      for (const [key, value] of rows) {
        if (key.startsWith(prefix)) sum += value;
      }
      return { rows: [{ bytes: sum }] };
    };

    const store = new LakebaseVolumeUsageStore(query);
    await store.addBytes('alice@co.com', 'bot-1', 30);
    await store.addBytes('alice@co.com', 'bot-1', 5);
    await store.addBytes('bob@co.com', 'bot-1', 9);

    expect(await store.getUsage('alice@co.com', 'bot-1')).toEqual({ userBytes: 35, botBytes: 35 });
    expect(await store.getUsage('bob@co.com', 'bot-1')).toEqual({ userBytes: 9, botBytes: 9 });
    expect(await store.getUsage('alice@co.com', 'bot-2')).toEqual({ userBytes: 35, botBytes: 0 });
  });

  test('schema creates bricksbot.volume_usage', () => {
    expect(CHAT_SCHEMA_STATEMENTS.some((statement) => statement.includes('bricksbot.volume_usage'))).toBe(true);
  });

  test('released bytes come off one row and never go below zero', async () => {
    const store = new MemoryVolumeUsageStore();
    await store.addBytes('alice', 'bot-a', 100);
    await store.addBytes('alice', 'bot-b', 10);
    await store.releaseBytes('alice', 'bot-a', 30);
    expect(await store.getUsage('alice', 'bot-a')).toEqual({ userBytes: 80, botBytes: 70 });
    await store.releaseBytes('alice', 'bot-a', 500);
    expect(await store.getUsage('alice', 'bot-a')).toEqual({ userBytes: 10, botBytes: 0 });
  });
});
