import { describe, expect, test } from 'vitest';
import { ApprovalStore } from './approvals.js';

describe('ApprovalStore', () => {
  const toolCall = { id: 'call_1', name: 'sql_query', arguments: { statement: 'SELECT 1' } };

  test('creates and retrieves pending approvals', () => {
    const store = new ApprovalStore();
    const req = store.create('chat-1', toolCall);

    expect(req.status).toBe('pending');
    expect(req.chatId).toBe('chat-1');
    expect(store.get(req.id)).toEqual(req);
    expect(store.listPending('chat-1')).toEqual([req]);
    expect(store.listPending('chat-2')).toEqual([]);
  });

  test('decides once approval without auto-approving', () => {
    const store = new ApprovalStore();
    const req = store.create('chat-1', toolCall);

    const decided = store.decide(req.id, 'once');
    expect(decided.status).toBe('approved');
    expect(decided.decision).toBe('once');
    expect(store.isAutoApproved('chat-1', 'sql_query')).toBe(false);
    expect(store.listPending('chat-1')).toEqual([]);
  });

  test('decides legacy approved decision as once', () => {
    const store = new ApprovalStore();
    const req = store.create('chat-1', toolCall);

    const decided = store.decide(req.id, 'approved');
    expect(decided.status).toBe('approved');
    expect(decided.decision).toBe('once');
    expect(store.isAutoApproved('chat-1', 'sql_query')).toBe(false);
  });

  test('decides all_the_time approval and remembers auto-approval for that chat', () => {
    const store = new ApprovalStore();
    const req = store.create('chat-1', toolCall);

    const decided = store.decide(req.id, 'all_the_time');
    expect(decided.status).toBe('approved');
    expect(decided.decision).toBe('all_the_time');
    expect(store.isAutoApproved('chat-1', 'sql_query')).toBe(true);
    expect(store.isAutoApproved('chat-2', 'sql_query')).toBe(false);
    expect(store.listAutoApproved('chat-1')).toEqual(['sql_query']);
  });

  test('decides always as all_the_time', () => {
    const store = new ApprovalStore();
    const req = store.create('chat-1', toolCall);

    const decided = store.decide(req.id, 'always');
    expect(decided.status).toBe('approved');
    expect(decided.decision).toBe('all_the_time');
    expect(store.isAutoApproved('chat-1', 'sql_query')).toBe(true);
  });

  test('decides denied and not_approved', () => {
    const store = new ApprovalStore();
    const req1 = store.create('chat-1', toolCall);
    const req2 = store.create('chat-1', toolCall);

    const denied1 = store.decide(req1.id, 'denied');
    expect(denied1.status).toBe('denied');
    expect(denied1.decision).toBe('denied');
    expect(store.isAutoApproved('chat-1', 'sql_query')).toBe(false);

    const denied2 = store.decide(req2.id, 'not_approved');
    expect(denied2.status).toBe('denied');
    expect(denied2.decision).toBe('denied');
  });

  test('allows revoking and clearing auto-approvals', () => {
    const store = new ApprovalStore();
    store.setAutoApproved('chat-1', 'sql_query');
    store.setAutoApproved('chat-1', 'web_fetch');

    expect(store.listAutoApproved('chat-1')).toEqual(['sql_query', 'web_fetch']);
    store.revokeAutoApproved('chat-1', 'sql_query');
    expect(store.isAutoApproved('chat-1', 'sql_query')).toBe(false);
    expect(store.isAutoApproved('chat-1', 'web_fetch')).toBe(true);

    store.clearAutoApproved('chat-1');
    expect(store.listAutoApproved('chat-1')).toEqual([]);
  });

  test('throws when deciding non-existent or already decided approval', () => {
    const store = new ApprovalStore();
    expect(() => store.decide('missing', 'once')).toThrow('Approval not found');

    const req = store.create('chat-1', toolCall);
    store.decide(req.id, 'once');
    expect(() => store.decide(req.id, 'once')).toThrow('Approval already decided');
  });
});
