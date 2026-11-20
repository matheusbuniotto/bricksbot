import { describe, expect, test } from 'vitest';
import { LakebaseBudgetStore } from './budget-service.js';
import { CHAT_SCHEMA_STATEMENTS } from '../chat/schema.js';
import { LakebaseUsageStore, MemoryUsageStore, type LlmUsageRecord } from './usage-store.js';

const entry: LlmUsageRecord = {
  kind: 'turn',
  payerUserId: 'bob',
  botId: 'bot-1',
  chatId: 'chat-1',
  runId: 'run-1',
  model: 'a/one',
  provider: 'openai-compatible',
  promptTokens: 10,
  completionTokens: 5,
  cachedTokens: 0,
  reasoningTokens: 0,
  costUsd: null,
  costSource: 'unknown',
};

describe('LakebaseUsageStore', () => {
  test('logs the call and rolls it up in one statement, with no content', async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const store = new LakebaseUsageStore((sql, params = []) => {
      calls.push({ sql, params });
      return Promise.resolve({ rows: [] });
    });
    await store.record(entry);
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain('INSERT INTO bricksbot_audit.llm_usage');
    expect(calls[0].sql).toContain('INSERT INTO bricksbot.usage_daily');
    expect(calls[0].sql).toContain("('user', $3::text), ('bot', $4::text), ('routine', $7::text)");
    expect(calls[0].params.slice(2, 8)).toEqual(['bob', 'bot-1', 'chat-1', 'run-1', null, 'a/one']);
  });

  test('schema keeps the ledger in the audit schema without foreign keys', () => {
    const ddl = CHAT_SCHEMA_STATEMENTS.find((s) => s.includes('CREATE TABLE IF NOT EXISTS bricksbot_audit.llm_usage'));
    expect(ddl).toBeDefined();
    expect(ddl).not.toMatch(/REFERENCES/);
    expect(ddl).toContain('routine_run_id');
    expect(CHAT_SCHEMA_STATEMENTS.join('\n')).toContain('PRIMARY KEY (day, scope_kind, scope_id)');
  });

  test('calls with no price are counted so the cost can be called incomplete', () => {
    const ddl = CHAT_SCHEMA_STATEMENTS.join('\n');
    expect(ddl).toContain('unpriced_calls');
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS bricksbot.budgets');
  });

  test('reads are scoped to one user, bot or routine and never touch the ledger table', async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const store = new LakebaseUsageStore((sql, params = []) => {
      calls.push({ sql, params });
      return Promise.resolve({ rows: [{ spent: 1.5 }] });
    });
    expect(await store.spent({ kind: 'bot', id: 'bot-1' }, '2026-11-01')).toBe(1.5);
    await store.daily({ kind: 'user', id: 'bob' }, 7);
    expect(calls.map((c) => c.params.slice(0, 2))).toEqual([
      ['bot', 'bot-1'],
      ['user', 'bob'],
    ]);
    expect(calls.every((c) => !c.sql.includes('llm_usage'))).toBe(true);
  });

  test('a Genie claim is one atomic upsert that stops at the cap', async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    let granted = true;
    const store = new LakebaseUsageStore((sql, params = []) => {
      calls.push({ sql, params });
      return Promise.resolve({ rows: granted ? [{ genie_calls: 1 }] : [] });
    });
    expect(await store.claimGenieCall('bob', 3)).toBe(true);
    granted = false;
    expect(await store.claimGenieCall('bob', 3)).toBe(false);
    expect(calls[0].sql).toContain('WHERE bricksbot.usage_daily.genie_calls < $2::int');
    expect(calls[0].params).toEqual(['bob', 3]);
  });

  test('the in-memory store stops at the cap too', async () => {
    const store = new MemoryUsageStore();
    expect([
      await store.claimGenieCall('bob', 2),
      await store.claimGenieCall('bob', 2),
      await store.claimGenieCall('bob', 2),
    ]).toEqual([true, true, false]);
    expect(await store.claimGenieCall('carol', 2)).toBe(true);
  });
});

describe('LakebaseBudgetStore', () => {
  test('keeps one row per person and period', async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const store = new LakebaseBudgetStore((sql, params = []) => {
      calls.push({ sql, params });
      return Promise.resolve({ rows: [] });
    });
    await store.set('bob', { period: 'day', limitUsd: 2, action: 'block' });
    await store.clear('bob', 'day');
    expect(calls[0].sql).toContain('ON CONFLICT (scope_kind, scope_id, period) DO UPDATE');
    expect(calls[0].params).toEqual(['bob', 'day', 2, 'block']);
    expect(calls[1].params).toEqual(['bob', 'day']);
  });
});
