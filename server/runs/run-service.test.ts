import { describe, expect, test } from 'vitest';
import { ActiveRunError } from '../../shared/runs/types.js';
import { LakebaseRunStore } from './lakebase-store.js';
import { MemoryRunStore } from './memory-store.js';
import { abortable, RunService, RunStoppedError } from './run-service.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('MemoryRunStore', () => {
  test('allows one running run per chat and frees the chat when it finishes', async () => {
    const store = new MemoryRunStore();
    const { run } = await store.start({ chatId: 'c1', kind: 'send', routine: false });
    await expect(store.start({ chatId: 'c1', kind: 'send', routine: false })).rejects.toBeInstanceOf(ActiveRunError);
    await store.start({ chatId: 'c2', kind: 'send', routine: false });

    expect(await store.finish(run.id, 'waiting')).toBe(true);
    expect(await store.finish(run.id, 'failed')).toBe(false);
    const resume = await store.start({ chatId: 'c1', kind: 'resume', routine: false });
    expect(resume.run.turnId).toBe(run.turnId);
  });

  test('numbers events per chat without gaps', async () => {
    const store = new MemoryRunStore();
    await store.appendEvent('c1', 'r1', 'run.started', {});
    await store.appendEvent('c2', 'r2', 'run.started', {});
    await store.appendEvent('c1', 'r1', 'run.finished', { status: 'completed' });
    expect((await store.listEvents('c1', 0)).map((event) => event.seq)).toEqual([1, 2]);
    expect((await store.listEvents('c1', 1)).map((event) => event.type)).toEqual(['run.finished']);
  });
});

describe('leases', () => {
  test('are held until they expire, then taken over', async () => {
    const store = new MemoryRunStore();
    expect(await store.acquireLease('run:1', 'a', 20)).toBe(true);
    expect(await store.acquireLease('run:1', 'a', 20)).toBe(true); // renew
    expect(await store.acquireLease('run:1', 'b', 20)).toBe(false);
    await sleep(30);
    expect(await store.acquireLease('run:1', 'b', 20)).toBe(true);
    expect(await store.acquireLease('run:1', 'a', 20)).toBe(false);
  });
});

describe('RunService', () => {
  test('heartbeats keep the lease, so a live run is never swept', async () => {
    const store = new MemoryRunStore();
    const service = new RunService(store, 30);
    const ctx = await service.open({ chatId: 'c1', kind: 'send', routine: false });
    await sleep(120);

    expect(await new RunService(store, 30).sweep(() => Promise.resolve())).toBe(0);
    await service.settle(ctx, 'completed');
  });

  test('a Stop requested on another instance aborts the run at its next heartbeat', async () => {
    const store = new MemoryRunStore();
    const service = new RunService(store, 30);
    const ctx = await service.open({ chatId: 'c1', kind: 'send', routine: false });

    await store.requestStop(ctx.runId);
    await sleep(60);

    expect(ctx.signal.aborted).toBe(true);
    await service.settle(ctx, 'stopped');
  });

  test('a run the sweeper already failed is aborted as lost, not as a user stop', async () => {
    const store = new MemoryRunStore();
    const service = new RunService(store, 30);
    const ctx = await service.open({ chatId: 'c1', kind: 'send', routine: false });

    await store.finish(ctx.runId, 'failed', 'Interrupted');
    await sleep(60);

    expect(ctx.signal.aborted).toBe(true);
    expect(ctx.signal.reason).toBe('lease_lost');
    await expect(abortable(new Promise<string>(() => {}), ctx.signal)).rejects.toMatchObject({
      reason: 'lease_lost',
    });
    await service.settle(ctx, 'failed');
  });

  test('the first settle wins and emits run.finished once', async () => {
    const store = new MemoryRunStore();
    const service = new RunService(store);
    const ctx = await service.open({ chatId: 'c1', kind: 'send', routine: false });
    await service.settle(ctx, 'stopped');
    await service.settle(ctx, 'completed');

    expect((await store.get(ctx.runId))?.status).toBe('stopped');
    const finished = (await store.listEvents('c1', 0)).filter((event) => event.type === 'run.finished');
    expect(finished).toHaveLength(1);
  });

  test('a dead instance run is taken over after its lease lapses', async () => {
    const store = new MemoryRunStore();
    const { run } = await store.start({ chatId: 'c1', kind: 'send', routine: false });
    await store.acquireLease(`run:${run.id}`, 'dead-instance', 20);
    const survivor = new RunService(store, 20);

    await sleep(30);
    const closed: string[] = [];
    expect(await survivor.sweep((swept) => Promise.resolve(void closed.push(swept.id)))).toBe(1);

    expect(closed).toEqual([run.id]);
    expect(await store.get(run.id)).toMatchObject({ status: 'failed' });
  });
});

describe('abortable', () => {
  test('rejects as soon as the signal aborts, even if the work never settles', async () => {
    const controller = new AbortController();
    const pending = abortable(new Promise<string>(() => {}), controller.signal);
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(RunStoppedError);
  });
});

describe('LakebaseRunStore', () => {
  test('maps the one-running-run index violation to ActiveRunError', async () => {
    const query = (sql: string) => {
      if (sql.includes('INSERT INTO bricksbot.chat_runs'))
        return Promise.reject(Object.assign(new Error('duplicate'), { code: '23505' }));
      if (sql.includes("status = 'running'")) return Promise.resolve({ rows: [{ id: 'active-run' }] });
      return Promise.resolve({ rows: [] });
    };
    const error = await new LakebaseRunStore(query)
      .start({ chatId: 'c1', kind: 'send', routine: false })
      .catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ActiveRunError);
    expect((error as ActiveRunError).activeRunId).toBe('active-run');
  });

  test('bumps the chat counter and inserts the event in one statement', async () => {
    const statements: string[] = [];
    const query = (sql: string, params?: unknown[]) => {
      statements.push(sql);
      return Promise.resolve({
        rows: [{ chat_id: 'c1', seq: '7', run_id: 'r1', type: 'run.started', payload: params?.[3], created_at: 'now' }],
      });
    };
    const event = await new LakebaseRunStore(query).appendEvent('c1', 'r1', 'run.started', { kind: 'send' });

    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain('SET event_seq = event_seq + 1');
    expect(event).toMatchObject({ seq: 7, runId: 'r1', payload: { kind: 'send' } });
  });
});
