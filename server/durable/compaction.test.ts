import { describe, expect, test } from 'vitest';
import type { Message } from '../../shared/chat/types.js';
import type { ChatClient } from '../../shared/agents/types.js';
import { applyCompactionToHistory, pickKeepFromMessage, runCompaction, shouldCompact } from './compaction.js';
import { MemoryCompactionStore } from './compaction-store.js';

function msg(id: string, role: Message['role'], content: string, extra?: Partial<Message>): Message {
  return {
    id,
    chatId: 'c1',
    role,
    content,
    createdAt: new Date().toISOString(),
    ...extra,
  };
}

describe('compaction', () => {
  test('shouldCompact when estimated tokens exceed budget', () => {
    const history = [msg('1', 'user', 'x'.repeat(80_000))];
    expect(
      shouldCompact(history, 'sys', {
        contextWindow: 10_000,
        reserveTokens: 1_000,
        keepRecentMessages: 4,
      })
    ).toBe(true);
    expect(
      shouldCompact([msg('1', 'user', 'hi')], 'sys', {
        contextWindow: 128_000,
        reserveTokens: 16_384,
        keepRecentMessages: 24,
      })
    ).toBe(false);
  });

  test('applyCompactionToHistory windows from keepFrom and avoids orphan tools', () => {
    const history = [
      msg('1', 'user', 'old'),
      msg('2', 'assistant', 'call', {
        toolCalls: [{ id: 't1', name: 'sql_query', arguments: {} }],
      }),
      msg('3', 'tool', 'rows', { toolCallId: 't1' }),
      msg('4', 'user', 'new'),
    ];
    const { messages, summarySystem } = applyCompactionToHistory(history, {
      id: 'cmp',
      chatId: 'c1',
      summary: 'Prior work summarized',
      keepFromMessageId: '3',
      createdAt: new Date().toISOString(),
    });
    expect(summarySystem).toContain('Prior work summarized');
    expect(messages[0]?.id).toBe('2');
    expect(messages.map((m) => m.id)).toEqual(['2', '3', '4']);
  });

  test('runCompaction stores summary and keeps recent user turn', async () => {
    const history = Array.from({ length: 10 }, (_, i) =>
      msg(String(i + 1), i % 2 === 0 ? 'user' : 'assistant', `turn ${i + 1}`)
    );
    const client: ChatClient = {
      provider: 'stub',
      async complete() {
        return { content: '- User asked about revenue\n- Analyst ran SQL', toolCalls: [] };
      },
    };
    const store = new MemoryCompactionStore();
    const record = await runCompaction({
      chatId: 'c1',
      history,
      client,
      store,
      settings: { contextWindow: 128_000, reserveTokens: 16_384, keepRecentMessages: 4 },
    });
    expect(record?.summary).toContain('revenue');
    expect(pickKeepFromMessage(history, 4)?.role).toBe('user');
    expect(await store.getLatest('c1')).toEqual(record);
  });
});
