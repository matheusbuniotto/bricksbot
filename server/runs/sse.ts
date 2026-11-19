import type { Request, Response } from 'express';
import type { Run } from '../../shared/runs/types.js';
import type { RunService } from './run-service.js';

/** Streams one user may hold open at once (a tab or two, plus reconnects racing the old connection). */
export const MAX_STREAMS_PER_USER = 6;

export interface SseTiming {
  /** The gateway cuts requests near 2 minutes; closing first lets EventSource resume with Last-Event-ID. */
  maxAgeMs: number;
  heartbeatMs: number;
  /** How often the store is read for events written by this or another instance. */
  pollMs: number;
}

export const SSE_TIMING: SseTiming = { maxAgeMs: 90_000, heartbeatMs: 10_000, pollMs: 500 };

const openStreams = new Map<string, number>();

/**
 * Server-sent events for one run: persisted events replay from `Last-Event-ID` (the per-chat seq),
 * then follow live. `llm.delta` chunks come from this process and carry no id, so a reconnect never
 * replays them; the committed message is what survives. Ends after `run.finished` or `maxAgeMs`, or at
 * the first heartbeat where `stillAllowed` says the caller lost access to the chat's bot.
 */
export function streamRunEvents(
  req: Request,
  res: Response,
  runs: RunService,
  run: Run,
  userId: string,
  stillAllowed: () => Promise<boolean>,
  timing: SseTiming = SSE_TIMING
): void {
  const open = openStreams.get(userId) ?? 0;
  if (open >= MAX_STREAMS_PER_USER) {
    res.status(429).json({ error: `Too many open event streams (limit ${MAX_STREAMS_PER_USER})` });
    return;
  }
  openStreams.set(userId, open + 1);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 1000\n\n');

  let after = Number.parseInt(req.header('last-event-id') ?? '', 10) || 0;
  let closed = false;
  let pumping = false;

  const send = (data: unknown, id?: number) =>
    res.write(`${id === undefined ? '' : `id: ${id}\n`}data: ${JSON.stringify(data)}\n\n`);

  const timers: NodeJS.Timeout[] = [];
  const stopDeltas = runs.onDelta(run.id, (text) => send({ type: 'llm.delta', payload: { text } }));
  const close = () => {
    if (closed) return;
    closed = true;
    timers.forEach(clearInterval);
    stopDeltas();
    const left = (openStreams.get(userId) ?? 1) - 1;
    if (left > 0) openStreams.set(userId, left);
    else openStreams.delete(userId);
    res.end();
  };

  async function pump() {
    if (pumping || closed) return;
    pumping = true;
    try {
      // Read the status first: a run that finished before this read has all its events in the list below.
      const current = await runs.store.get(run.id);
      for (const event of await runs.store.listEvents(run.chatId, after, run.id)) {
        after = event.seq;
        send(event, event.seq);
        if (event.type === 'run.finished') return close();
      }
      if (current && current.status !== 'running') {
        // The finish event was dropped (events are best effort); tell the watcher anyway.
        send({
          type: 'run.finished',
          payload: { status: current.status, ...(current.error ? { error: current.error } : {}) },
        });
        close();
      }
    } catch {
      // The next tick retries.
    } finally {
      pumping = false;
    }
  }

  timers.push(setInterval(() => void pump(), timing.pollMs));
  timers.push(
    setInterval(() => {
      res.write(': ping\n\n');
      void stillAllowed().then((allowed) => allowed || close(), close);
    }, timing.heartbeatMs)
  );
  timers.push(setTimeout(close, timing.maxAgeMs));
  req.on('close', close);
  void pump();
}
