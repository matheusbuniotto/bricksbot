import type { Request, Response } from 'express';
import { describe, expect, test, vi } from 'vitest';
import { MemoryRunStore } from './memory-store.js';
import { RunService } from './run-service.js';
import { streamRunEvents } from './sse.js';

describe('streamRunEvents', () => {
  test('a dead connection ends the stream instead of throwing into the run', async () => {
    const runs = new RunService(new MemoryRunStore());
    const ctx = await runs.open({ chatId: 'c1', kind: 'send', routine: false });
    const run = (await runs.store.get(ctx.runId))!;

    let broken = false;
    const writes: string[] = [];
    const end = vi.fn();
    const res = {
      writableEnded: false,
      destroyed: false,
      writeHead: vi.fn(),
      write: (chunk: string) => {
        if (broken) throw new Error('write EPIPE');
        writes.push(chunk);
        return true;
      },
      end,
      on: vi.fn(),
    } as unknown as Response;
    const req = { header: () => undefined, on: vi.fn() } as unknown as Request;
    streamRunEvents(req, res, runs, run, 'ana', () => Promise.resolve(true));

    ctx.delta('before');
    broken = true;
    expect(() => ctx.delta('after')).not.toThrow();
    expect(end).toHaveBeenCalledOnce();

    const written = writes.length;
    expect(() => ctx.delta('again')).not.toThrow();
    expect(writes).toHaveLength(written);
    await runs.settle(ctx, 'completed');
  });
});
