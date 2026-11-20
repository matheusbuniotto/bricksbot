import { randomUUID } from 'node:crypto';
import type { Run, RunContext, RunStatus, RunStore, StartRunInput } from '../../shared/runs/types.js';

/** A run's lease lapses after this long without a heartbeat; the sweeper then declares it dead. */
export const RUN_LEASE_TTL_MS = 30_000;

/** Thrown inside a turn when Stop was pressed (or the run was lost): unwinds to the run's final status. */
export class RunStoppedError extends Error {
  constructor(readonly reason: 'stop' | 'lease_lost' = 'stop') {
    super(reason === 'stop' ? 'Run stopped' : 'Run lease lost');
  }
}

/** The error for an aborted run signal: Stop reads as a user stop, anything else as a lost run. */
export function stoppedBy(signal: AbortSignal): RunStoppedError {
  return new RunStoppedError(signal.reason === 'lease_lost' ? 'lease_lost' : 'stop');
}

/** Rejects with RunStoppedError as soon as `signal` aborts; the work itself is abandoned, not cancelled. */
export function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(stoppedBy(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(stoppedBy(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/** Run lifecycle: open, heartbeat the lease, emit events, stop, settle. */
export class RunService {
  /** Identifies this process as lease holder. */
  readonly owner = randomUUID();
  private readonly live = new Map<string, { controller: AbortController; heartbeat: NodeJS.Timeout }>();

  constructor(
    readonly store: RunStore,
    private readonly leaseTtlMs = RUN_LEASE_TTL_MS
  ) {}

  /** Opens a run unless the chat has one running (ActiveRunError). `ctx` is null for a requestId used before. */
  async start(input: StartRunInput): Promise<{ run: Run; ctx: RunContext | null }> {
    const { run, duplicate } = await this.store.start(input);
    return { run, ctx: duplicate ? null : await this.begin(run) };
  }

  /** `start` for callers that send no requestId, so the run is never a duplicate. */
  async open(input: Omit<StartRunInput, 'requestId'>): Promise<RunContext> {
    return this.begin((await this.store.start(input)).run);
  }

  private async begin(run: Run): Promise<RunContext> {
    const controller = new AbortController();
    const lease = `run:${run.id}`;
    await this.store.acquireLease(lease, this.owner, this.leaseTtlMs);
    const heartbeat = setInterval(() => void this.beat(run.id, lease, controller), this.leaseTtlMs / 3);
    heartbeat.unref();
    this.live.set(run.id, { controller, heartbeat });

    const ctx: RunContext = {
      runId: run.id,
      chatId: run.chatId,
      turnId: run.turnId,
      kind: run.kind,
      routine: run.routine,
      payerUserId: run.payerUserId,
      signal: controller.signal,
      // Events are a feed for watchers; losing one must not fail the turn.
      emit: async (type, payload = {}) => {
        try {
          await this.store.appendEvent(run.chatId, run.id, type, payload);
        } catch (err) {
          console.warn(`[bricksbot] Run event ${type} dropped: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    };
    await ctx.emit('run.started', { kind: run.kind, turnId: run.turnId });
    return ctx;
  }

  /** Renews the lease, and picks up a Stop pressed on another instance or a run the sweeper already failed. */
  private async beat(runId: string, lease: string, controller: AbortController): Promise<void> {
    try {
      if (!(await this.store.acquireLease(lease, this.owner, this.leaseTtlMs))) {
        controller.abort('lease_lost');
      } else {
        const run = await this.store.get(runId);
        if (!run || run.status !== 'running') controller.abort('lease_lost');
        else if (run.stopRequested) controller.abort('stop');
      }
    } catch {
      // A missed beat is fine; the lease only lapses after several.
    }
  }

  /** Marks the run stopped for everyone and cuts it short when it runs on this instance. */
  async stop(runId: string): Promise<boolean> {
    const requested = await this.store.requestStop(runId);
    this.live.get(runId)?.controller.abort('stop');
    return requested;
  }

  /** Closes the run with its final status; only the first settle wins. */
  async settle(ctx: RunContext, status: Exclude<RunStatus, 'running'>, error?: string): Promise<void> {
    const entry = this.live.get(ctx.runId);
    if (entry) clearInterval(entry.heartbeat);
    this.live.delete(ctx.runId);
    if (await this.store.finish(ctx.runId, status, error)) {
      await ctx.emit('run.finished', { status, ...(error ? { error } : {}) });
    }
    await this.store.releaseLease(`run:${ctx.runId}`, this.owner);
  }

  /**
   * Fails runs whose process died: running, not ours, past its first lease period, lease no longer renewed.
   * `close` repairs the transcript (synthetic tool rows) before the run is marked failed.
   */
  async sweep(close: (run: Run) => Promise<void>): Promise<number> {
    let swept = 0;
    for (const run of await this.store.listRunning()) {
      if (this.live.has(run.id) || Date.now() - Date.parse(run.startedAt) < this.leaseTtlMs) continue;
      if (!(await this.store.acquireLease(`run:${run.id}`, this.owner, this.leaseTtlMs))) continue;
      await close(run);
      if (await this.store.finish(run.id, 'failed', 'Interrupted: the server restarted during this run')) {
        await this.store.appendEvent(run.chatId, run.id, 'run.finished', {
          status: 'failed',
          error: 'Interrupted: the server restarted during this run',
        });
        swept += 1;
      }
      await this.store.releaseLease(`run:${run.id}`, this.owner);
    }
    return swept;
  }
}
