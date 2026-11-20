import express from 'express';
import { describe, expect, test } from 'vitest';
import { diagRoutesEnabled, registerDiagRoutes } from './routes.js';

async function withDiagApp(run: (baseUrl: string) => Promise<void>) {
  const app = express();
  registerDiagRoutes(app);
  const server = await new Promise<import('node:http').Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to bind test server');
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('X1 diag routes', () => {
  test('are off unless BRICKSBOT_DIAG=1', () => {
    expect(diagRoutesEnabled({})).toBe(false);
    expect(diagRoutesEnabled({ BRICKSBOT_DIAG: 'true' })).toBe(false);
    expect(diagRoutesEnabled({ BRICKSBOT_DIAG: '1' })).toBe(true);
  });

  test('stream sends unbuffered SSE headers, ids, heartbeats, and closes server-side', async () => {
    await withDiagApp(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/_diag/stream?seconds=1&closeAfter=0.35&tickEvery=0.1&heartbeat=0.15`);
      expect(res.headers.get('content-type')).toBe('text/event-stream');
      expect(res.headers.get('x-accel-buffering')).toBe('no');
      const body = await res.text();
      expect(body).toMatch(/id: 1\nevent: tick/);
      expect(body).toContain(': ping');
    });
  });

  test('stream resumes the sequence from Last-Event-ID', async () => {
    await withDiagApp(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/_diag/stream?closeAfter=0.25&tickEvery=0.1&heartbeat=0`, {
        headers: { 'Last-Event-ID': '41' },
      });
      const body = await res.text();
      expect(body).toContain('id: 42\n');
      expect(body).not.toContain('id: 1\n');
    });
  });

  test('upload counts raw bytes and can stall the response like a slow sink', async () => {
    await withDiagApp(async (baseUrl) => {
      const started = Date.now();
      const res = await fetch(`${baseUrl}/api/_diag/upload?sinkDelaySec=0.2`, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: Buffer.alloc(300_000, 1),
      });
      const json = (await res.json()) as { bytes: number; sha256: string };
      expect(json.bytes).toBe(300_000);
      expect(json.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(Date.now() - started).toBeGreaterThanOrEqual(190);
    });
  });
});
