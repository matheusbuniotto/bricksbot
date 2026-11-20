import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  archiveChat,
  createChat,
  fetchChats,
  followRun,
  newRequestId,
  renameChat,
  searchChats,
  sendChatMessage,
} from './chat-api';

/** Records EventSource instances so a test can play the server's side. */
class FakeEventSource {
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  url: string;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  close() {
    this.readyState = FakeEventSource.CLOSED;
  }
  emit(type: string, payload: Record<string, unknown> = {}) {
    this.onmessage?.({ data: JSON.stringify({ type, payload }) });
  }
}

const json = (body: unknown, status = 200) => Promise.resolve(Response.json(body, { status }));

describe('sendChatMessage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeEventSource.instances = [];
  });

  test('starts a detached run with a fresh requestId so a replayed POST joins the same run', async () => {
    const bodies: Array<{ content: string; requestId: string; async: boolean }> = [];
    vi.stubGlobal('EventSource', undefined);
    vi.stubGlobal('fetch', (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        bodies.push(JSON.parse(init.body as string) as (typeof bodies)[number]);
        return json({ runId: 'run-1' }, 202);
      }
      return json({ run: { status: 'completed' } });
    });

    await sendChatMessage('chat-1', 'hello');
    await sendChatMessage('chat-1', 'hello');

    expect(bodies[0]).toMatchObject({ content: 'hello', async: true });
    expect(bodies[0].requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(bodies[1].requestId).not.toBe(bodies[0].requestId);
  });

  test('follows the run over SSE, hands each update on, and resolves with the outcome', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.stubGlobal('fetch', () => json({ runId: 'run-1' }, 202));
    const updates: string[] = [];

    const done = sendChatMessage('chat-1', 'hi', (update) => updates.push(update.type));
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const source = FakeEventSource.instances[0];
    expect(source.url).toBe('/api/chats/chat-1/runs/run-1/events');
    source.emit('run.started');
    source.emit('llm.delta', { text: 'hi' });
    source.emit('run.finished', { status: 'failed', error: 'model down' });

    expect(await done).toEqual({ status: 'failed', error: 'model down' });
    expect(updates).toEqual(['run.started', 'llm.delta', 'run.finished']);
    expect(source.readyState).toBe(FakeEventSource.CLOSED);
  });
});

describe('followRun', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    FakeEventSource.instances = [];
  });

  test('a server-side close that reconnects (open between errors) keeps streaming', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const done = followRun('c', 'r');
    const source = FakeEventSource.instances[0];
    for (let i = 0; i < 5; i += 1) {
      source.onerror?.();
      source.onopen?.();
    }
    source.emit('run.finished', { status: 'completed' });
    expect(await done).toEqual({ status: 'completed', error: undefined });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('falls back to polling after 3 failed connections in a row', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const statuses = ['running', 'completed'];
    const fetchMock = vi.fn(() => json({ run: { status: statuses.shift() } }));
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();

    const done = followRun('c', 'r');
    const source = FakeEventSource.instances[0];
    source.onerror?.();
    source.onerror?.();
    expect(fetchMock).not.toHaveBeenCalled();
    source.onerror?.();
    await vi.advanceTimersByTimeAsync(2000);

    expect(await done).toEqual({ status: 'completed', error: undefined });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(source.readyState).toBe(FakeEventSource.CLOSED);
  });

  test('a stream that goes quiet is caught by the status check', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const statuses = ['running', 'completed'];
    vi.stubGlobal('fetch', () => json({ run: { status: statuses.shift() } }));
    vi.useFakeTimers();

    const done = followRun('c', 'r');
    await vi.advanceTimersByTimeAsync(11_000);

    expect(await done).toEqual({ status: 'completed', error: undefined });
    expect(FakeEventSource.instances[0].readyState).toBe(FakeEventSource.CLOSED);
  });

  test('a refused stream (cap or 404) polls at once', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.stubGlobal('fetch', () => json({ run: { status: 'stopped' } }));
    const done = followRun('c', 'r');
    const source = FakeEventSource.instances[0];
    source.readyState = FakeEventSource.CLOSED;
    source.onerror?.();
    expect(await done).toEqual({ status: 'stopped', error: undefined });
  });
});

describe('newRequestId', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('falls back to getRandomValues outside a secure context', () => {
    const realCrypto = globalThis.crypto;
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => realCrypto.getRandomValues(bytes) });
    const id = newRequestId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(newRequestId()).not.toBe(id);
  });
});

describe('chat history calls', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("read and change a bot's chats through the chat endpoints", async () => {
    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method, body: init?.body as string | undefined });
      return json({ chats: [{ id: 'c1' }], chat: { id: 'c1' } });
    });

    expect(await fetchChats('b1')).toEqual([{ id: 'c1' }]);
    expect(await createChat('b1')).toEqual({ id: 'c1' });
    await renameChat('c1', 'New name');
    await archiveChat('c1');

    expect(calls.map((call) => `${call.method ?? 'GET'} ${call.url}`)).toEqual([
      'GET /api/bots/b1/chats',
      'POST /api/bots/b1/chats',
      'POST /api/chats/c1/update',
      'POST /api/chats/c1/archive',
    ]);
    expect(JSON.parse(calls[2].body!)).toEqual({ title: 'New name' });
  });

  test('searchChats sends the query encoded and returns the hits', async () => {
    let requested = '';
    vi.stubGlobal('fetch', (url: string) => {
      requested = url;
      return json({ hits: [{ chatId: 'c1' }] });
    });
    expect(await searchChats('q3 & more')).toEqual([{ chatId: 'c1' }]);
    expect(requested).toBe('/api/search?q=q3+%26+more');
  });

  test('a failed call throws the server message', async () => {
    vi.stubGlobal('fetch', () => json({ error: 'Forbidden' }, 403));
    await expect(archiveChat('c1')).rejects.toThrow('Forbidden');
  });
});
