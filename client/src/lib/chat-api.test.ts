import { afterEach, describe, expect, test, vi } from 'vitest';
import { sendChatMessage } from './chat-api';

describe('sendChatMessage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('sends a fresh requestId so a replayed POST is idempotent', async () => {
    const bodies: Array<{ content: string; requestId: string }> = [];
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string) as { content: string; requestId: string });
      return Promise.resolve(new Response(JSON.stringify({ pendingApprovals: [] }), { status: 201 }));
    });

    await sendChatMessage('chat-1', 'hello');
    await sendChatMessage('chat-1', 'hello');

    expect(bodies[0].content).toBe('hello');
    expect(bodies[0].requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(bodies[1].requestId).not.toBe(bodies[0].requestId);
  });
});
