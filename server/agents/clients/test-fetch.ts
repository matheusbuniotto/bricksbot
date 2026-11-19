import { vi } from 'vitest';

/** Replace global fetch with a canned JSON response. */
export function stubFetchJson(body: unknown) {
  const fetchMock = vi.fn((_url: string, _init: RequestInit) => Promise.resolve(Response.json(body)));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Replace global fetch with a request that only ends when its signal aborts, like the real one. */
export function stubFetchUntilAborted() {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          const abort = () => reject(new Error('aborted'));
          if (init.signal?.aborted) abort();
          init.signal?.addEventListener('abort', abort);
        })
    )
  );
}
