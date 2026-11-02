import { describe, expect, test } from 'vitest';
import { ApprovalStore } from './approvals.js';

describe('ApprovalStore', () => {
  const toolCall = { id: 'call_1', name: 'sql_query', arguments: { statement: 'SELECT 1' } };

  test('creates and retrieves pending approvals', async () => {
    const store = new ApprovalStore();
    const req = await store.create('chat-1', toolCall);

    expect(req.status).toBe('pending');
    expect(req.chatId).toBe('chat-1');
    expect(await store.get(req.id)).toEqual(req);
    expect(await store.listPending('chat-1')).toEqual([req]);
    expect(await store.listPending('chat-2')).toEqual([]);
  });

  test('decides once approval without auto-approving', async () => {
    const store = new ApprovalStore();
    const req = await store.create('chat-1', toolCall);

    const decided = await store.decide(req.id, 'once');
    expect(decided.applied).toBe(true);
    expect(decided.request.status).toBe('approved');
    expect(decided.request.decision).toBe('once');
    expect(await store.isAutoApproved('chat-1', 'sql_query')).toBe(false);
    expect(await store.listPending('chat-1')).toEqual([]);
  });

  test('decides legacy approved decision as once', async () => {
    const store = new ApprovalStore();
    const req = await store.create('chat-1', toolCall);

    const decided = await store.decide(req.id, 'approved');
    expect(decided.applied).toBe(true);
    expect(decided.request.status).toBe('approved');
    expect(decided.request.decision).toBe('once');
    expect(await store.isAutoApproved('chat-1', 'sql_query')).toBe(false);
  });

  test('decides all_the_time approval and remembers auto-approval for that chat', async () => {
    const store = new ApprovalStore();
    const req = await store.create('chat-1', toolCall);

    const decided = await store.decide(req.id, 'all_the_time');
    expect(decided.applied).toBe(true);
    expect(decided.request.status).toBe('approved');
    expect(decided.request.decision).toBe('all_the_time');
    expect(await store.isAutoApproved('chat-1', 'sql_query')).toBe(true);
    expect(await store.isAutoApproved('chat-2', 'sql_query')).toBe(false);
    expect(await store.listAutoApproved('chat-1')).toEqual(['sql_query']);
  });

  test('decides always as all_the_time', async () => {
    const store = new ApprovalStore();
    const req = await store.create('chat-1', toolCall);

    const decided = await store.decide(req.id, 'always');
    expect(decided.applied).toBe(true);
    expect(decided.request.decision).toBe('all_the_time');
    expect(await store.isAutoApproved('chat-1', 'sql_query')).toBe(true);
  });

  test('decides denied and not_approved', async () => {
    const store = new ApprovalStore();
    const req1 = await store.create('chat-1', toolCall);
    const req2 = await store.create('chat-1', toolCall);

    const denied1 = await store.decide(req1.id, 'denied');
    expect(denied1.applied).toBe(true);
    expect(denied1.request.status).toBe('denied');
    expect(denied1.request.decision).toBe('denied');
    expect(await store.isAutoApproved('chat-1', 'sql_query')).toBe(false);

    const denied2 = await store.decide(req2.id, 'not_approved');
    expect(denied2.applied).toBe(true);
    expect(denied2.request.status).toBe('denied');
    expect(denied2.request.decision).toBe('denied');
  });

  test('allows revoking and clearing auto-approvals', async () => {
    const store = new ApprovalStore();
    await store.setAutoApproved('chat-1', 'sql_query');
    await store.setAutoApproved('chat-1', 'web_fetch');

    expect(await store.listAutoApproved('chat-1')).toEqual(['sql_query', 'web_fetch']);
    await store.revokeAutoApproved('chat-1', 'sql_query');
    expect(await store.isAutoApproved('chat-1', 'sql_query')).toBe(false);
    expect(await store.isAutoApproved('chat-1', 'web_fetch')).toBe(true);

    await store.clearAutoApproved('chat-1');
    expect(await store.listAutoApproved('chat-1')).toEqual([]);
  });

  test('throws when deciding non-existent approval and is idempotent when already decided', async () => {
    const store = new ApprovalStore();
    await expect(store.decide('missing', 'once')).rejects.toThrow('Approval not found');

    const req = await store.create('chat-1', toolCall);
    const first = await store.decide(req.id, 'once');
    expect(first.applied).toBe(true);

    const second = await store.decide(req.id, 'once');
    expect(second.applied).toBe(false);
    expect(second.request.status).toBe('approved');
    expect(second.request.decision).toBe('once');
  });

  test('appends requested and decided trail events in memory', async () => {
    const store = new ApprovalStore();
    const req = await store.create('chat-1', toolCall, {
      botId: 'bot-1',
      userId: 'user-1',
    });
    await store.decide(req.id, 'denied', {
      botId: 'bot-1',
      userId: 'user-1',
      decidedBy: 'user-1',
    });

    const events = await store.listEvents('chat-1');
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.type)).toEqual(['decided', 'requested']);
    expect(events[0]?.payload).toEqual(
      expect.objectContaining({
        decision: 'denied',
        status: 'denied',
        decidedBy: 'user-1',
        toolCallId: 'call_1',
      })
    );
    expect(events[1]).toEqual(
      expect.objectContaining({
        type: 'requested',
        toolName: 'sql_query',
        botId: 'bot-1',
        userId: 'user-1',
        approvalId: req.id,
      })
    );
  });

  test('persists trail events when a Lakebase query is provided', async () => {
    const inserts: Array<{ sql: string; params: unknown[] }> = [];
    const store = new ApprovalStore(async (sql, params = []) => {
      if (sql.includes('FROM bricksbot.approvals') && sql.includes("status = 'pending'")) {
        return { rows: [] };
      }
      if (sql.includes('FROM bricksbot.auto_approvals')) {
        return { rows: [] };
      }
      if (sql.startsWith('INSERT INTO bricksbot.approvals')) {
        return { rows: [] };
      }
      if (sql.startsWith('UPDATE bricksbot.approvals')) {
        return { rows: [] };
      }
      if (sql.startsWith('INSERT INTO bricksbot.approval_events')) {
        inserts.push({ sql, params: [...params] });
        return { rows: [] };
      }
      if (sql.includes('FROM bricksbot.approval_events')) {
        return {
          rows: inserts
            .map((row) => ({
              id: row.params[0],
              chat_id: row.params[1],
              approval_id: row.params[2],
              bot_id: row.params[3],
              user_id: row.params[4],
              type: row.params[5],
              tool_name: row.params[6],
              payload: row.params[7],
              created_at: new Date().toISOString(),
            }))
            .reverse(),
        };
      }
      return { rows: [] };
    });

    const req = await store.create('chat-1', toolCall, { botId: 'bot-1', userId: 'u1' });
    await store.decide(req.id, 'once', { botId: 'bot-1', userId: 'u1', decidedBy: 'u1' });
    expect(inserts).toHaveLength(2);
    expect(inserts[0]?.params[5]).toBe('requested');
    expect(inserts[1]?.params[5]).toBe('decided');

    const events = await store.listEvents('chat-1');
    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe('decided');
    expect(events[1]?.type).toBe('requested');
  });
});
