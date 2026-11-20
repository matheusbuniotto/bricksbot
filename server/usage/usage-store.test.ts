import { describe, expect, test } from 'vitest';
import { CHAT_SCHEMA_STATEMENTS } from '../chat/schema.js';
import { LakebaseUsageStore, type LlmUsageRecord } from './usage-store.js';

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
});
