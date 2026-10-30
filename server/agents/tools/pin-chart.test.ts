import { describe, expect, test } from 'vitest';
import { parseArtifactPinNotice } from '../../../shared/chat/artifact-pin-notice.js';
import { SQL_TRUNCATION_MARKER } from '../../../shared/chat/sql-result.js';
import { MemoryChatStore } from '../../chat/memory-store.js';
import { executePinChart, planPinChart } from './pin-chart.js';

describe('pin_chart', () => {
  test('injects rows from a prior sql_query tool result into a chart pin', async () => {
    const store = new MemoryChatStore();
    const bot = await store.ensurePrimaryBot();
    const chat = await store.getOrCreateChatForBot(bot.id);

    await store.addMessage(chat.id, 'assistant', 'Running query', {
      toolCalls: [
        { id: 'call-sql-1', name: 'sql_query', arguments: { statement: 'SELECT month, orders FROM t' } },
      ],
    });
    await store.addMessage(chat.id, 'tool', 'month\torders\nJul\t120\nAug\t180', {
      toolCallId: 'call-sql-1',
    });

    const spec = {
      mark: { type: 'bar', tooltip: true },
      encoding: {
        x: { field: 'month', type: 'ordinal' },
        y: { field: 'orders', type: 'quantitative' },
      },
    };

    expect(
      planPinChart({ title: 'Orders', source_tool_call_id: 'call-sql-1', spec }, bot).ok,
    ).toBe(true);

    const raw = await executePinChart(
      store,
      { chatId: chat.id, bot },
      { title: 'Orders', source_tool_call_id: 'call-sql-1', spec },
    );
    const out = JSON.parse(raw) as { ok: boolean; rows: number; messageId: string };
    expect(out.ok).toBe(true);
    expect(out.rows).toBe(2);

    const messages = await store.listMessages(chat.id);
    const sys = messages.find((m) => m.role === 'system');
    const pin = parseArtifactPinNotice(sys!.content);
    expect(pin?.artifactKind).toBe('chart');
    const body = JSON.parse(pin!.body) as { data: { values: unknown[] } };
    expect(body.data.values).toEqual([
      { month: 'Jul', orders: 120 },
      { month: 'Aug', orders: 180 },
    ]);
  });

  test('rejects unknown or non-sql toolCallId and truncated results', async () => {
    const store = new MemoryChatStore();
    const bot = await store.ensurePrimaryBot();
    const chat = await store.getOrCreateChatForBot(bot.id);

    const missing = await executePinChart(
      store,
      { chatId: chat.id, bot },
      { title: 'Orders', source_tool_call_id: 'nope', spec: { mark: 'bar' } },
    );
    expect(missing).toContain('source_tool_call_id');

    await store.addMessage(chat.id, 'assistant', '', {
      toolCalls: [{ id: 'call-trunc', name: 'sql_query', arguments: { statement: 'SELECT 1' } }],
    });
    await store.addMessage(chat.id, 'tool', `a\n1\n${SQL_TRUNCATION_MARKER}`, {
      toolCallId: 'call-trunc',
    });

    const trunc = await executePinChart(
      store,
      { chatId: chat.id, bot },
      { title: 'Orders', source_tool_call_id: 'call-trunc', spec: { mark: 'bar' } },
    );
    expect(trunc).toContain('truncated');
  });
});
