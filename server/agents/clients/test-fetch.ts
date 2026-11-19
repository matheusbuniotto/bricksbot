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

/** An SSE response whose bytes are split at awkward places (mid-line), like a real network stream. */
export function sseResponse(chunks: unknown[]): Response {
  const text = [...chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`), 'data: [DONE]\n\n'].join('');
  const half = Math.floor(text.length / 2);
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`: OPENROUTER PROCESSING\n\n${text.slice(0, half)}`));
        controller.enqueue(encoder.encode(text.slice(half)));
        controller.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } }
  );
}
