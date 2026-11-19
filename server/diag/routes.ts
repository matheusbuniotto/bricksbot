import { createHash } from 'node:crypto';
import type { Application, Request, Response } from 'express';
import { resolveOwnerId } from '../chat/identity.js';

/**
 * Temporary X1 probes for the Databricks Apps gateway (timeouts, SSE buffering, upload ceiling).
 * Off unless BRICKSBOT_DIAG=1; remove with the harness once the results are in docs/architecture.md.
 * Driven by `scripts/smoke-sse.sh`.
 */
export function diagRoutesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.BRICKSBOT_DIAG === '1';
}

const MAX_SECONDS = 600;

/** Clamped numeric query param, so a probe can never hold a connection open indefinitely. */
function seconds(value: unknown, fallback: number): number {
  const n = Number(value ?? fallback);
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), MAX_SECONDS) : fallback;
}

export function registerDiagRoutes(app: Application): void {
  // SSE probe: one `tick` event per second with an id, an optional `: ping` comment heartbeat,
  // and a server-side close after `closeAfter` seconds. Last-Event-ID resumes the sequence.
  app.get('/api/_diag/stream', (req: Request, res: Response) => {
    resolveOwnerId(req);
    const total = seconds(req.query.seconds, 300);
    const closeAfter = seconds(req.query.closeAfter, 90);
    const heartbeat = seconds(req.query.heartbeat, 10);
    const tickEvery = seconds(req.query.tickEvery, 1);
    let seq = Number.parseInt(req.header('last-event-id') ?? '0', 10) || 0;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`retry: 1000\n\n`);

    const startedAt = Date.now();
    const timers: NodeJS.Timeout[] = [];
    const stop = () => {
      timers.forEach(clearInterval);
      timers.forEach(clearTimeout);
      res.end();
    };
    if (tickEvery > 0) {
      timers.push(
        setInterval(() => {
          seq += 1;
          res.write(`id: ${seq}\nevent: tick\ndata: ${JSON.stringify({ seq, t: Date.now() })}\n\n`);
        }, tickEvery * 1000)
      );
    }
    if (heartbeat > 0) {
      timers.push(setInterval(() => res.write(`: ping ${Date.now() - startedAt}\n\n`), heartbeat * 1000));
    }
    timers.push(setTimeout(stop, Math.min(total, closeAfter || total) * 1000));
    res.on('close', stop);
  });

  // Upload probe: counts raw bytes (no body parser), then optionally stalls `sinkDelaySec`
  // before answering, to mimic a slow sink such as the Files API.
  app.post('/api/_diag/upload', async (req: Request, res: Response) => {
    try {
      resolveOwnerId(req);
      const sinkDelay = seconds(req.query.sinkDelaySec, 0);
      const startedAt = Date.now();
      const hash = createHash('sha256');
      let bytes = 0;
      for await (const chunk of req) {
        bytes += (chunk as Buffer).length;
        hash.update(chunk as Buffer);
      }
      const receivedMs = Date.now() - startedAt;
      if (sinkDelay > 0) await new Promise((resolve) => setTimeout(resolve, sinkDelay * 1000));
      res.json({ bytes, sha256: hash.digest('hex'), receivedMs, totalMs: Date.now() - startedAt });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
