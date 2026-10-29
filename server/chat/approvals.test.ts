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
    expect(decided.status).toBe('approved');
    expect(decided.decision).toBe('once');
    expect(await store.isAutoApproved('chat-1', 'sql_query')).toBe(false);
    expect(await store.listPending('chat-1')).toEqual([]);
  });

  test('decides legacy approved decision as once', async () => {
    const store = new ApprovalStore();
    const req = await store.create('chat-1', toolCall);

    const decided = await store.decide(req.id, 'approved');
    expect(decided.status).toBe('approved');
    expect(decided.decision).toBe('once');
    expect(await store.isAutoApproved('chat-1', 'sql_query')).toBe(false);
  });

  test('decides all_the_time approval and remembers auto-approval for that chat', async () => {
    const store = new ApprovalStore();
    const req = await store.create('chat-1', toolCall);

    const decided = await store.decide(req.id, 'all_the_time');
    expect(decided.status).toBe('approved');
    expect(decided.decision).toBe('all_the_time');
    expect(await store.isAutoApproved('chat-1', 'sql_query')).toBe(true);
    expect(await store.isAutoApproved('chat-2', 'sql_query')).toBe(false);
    expect(await store.listAutoApproved('chat-1')).toEqual(['sql_query']);
  });

  test('decides always as all_the_time', async () => {
    const store = new ApprovalStore();
    const req = await store.create('chat-1', toolCall);

    const decided = await store.decide(req.id, 'always');
    expect(decided.status).toBe('approved');
    expect(decided.decision).toBe('all_the_time');
    expect(await store.isAutoApproved('chat-1', 'sql_query')).toBe(true);
  });

  test('decides denied and not_approved', async () => {
    const store = new ApprovalStore();
    const req1 = await store.create('chat-1', toolCall);
    const req2 = await store.create('chat-1', toolCall);

    const denied1 = await store.decide(req1.id, 'denied');
    expect(denied1.status).toBe('denied');
    expect(denied1.decision).toBe('denied');
    expect(await store.isAutoApproved('chat-1', 'sql_query')).toBe(false);

    const denied2 = await store.decide(req2.id, 'not_approved');
    expect(denied2.status).toBe('denied');
    expect(denied2.decision).toBe('denied');
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

  test('throws when deciding non-existent or already decided approval', async () => {
    const store = new ApprovalStore();
    await expect(store.decide('missing', 'once')).rejects.toThrow('Approval not found');

    const req = await store.create('chat-1', toolCall);
    await store.decide(req.id, 'once');
    await expect(store.decide(req.id, 'once')).rejects.toThrow('Approval already decided');
  });
});
