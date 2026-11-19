import { randomUUID } from 'node:crypto';
import {
  ActiveRunError,
  type Run,
  type RunEvent,
  type RunEventType,
  type RunStatus,
  type RunStore,
  type StartRunInput,
} from '../../shared/runs/types.js';
import { nowIso } from '../lib/coerce.js';

export class MemoryRunStore implements RunStore {
  private readonly runs = new Map<string, Run>();
  private readonly events = new Map<string, RunEvent[]>();
  private readonly leases = new Map<string, { owner: string; expiresAt: number }>();

  async start(input: StartRunInput): Promise<{ run: Run; duplicate: boolean }> {
    const all = [...this.runs.values()];
    const sameRequest = input.requestId ? all.find((run) => run.requestId === input.requestId) : undefined;
    if (sameRequest) return { run: sameRequest, duplicate: true };

    const forChat = all.filter((run) => run.chatId === input.chatId);
    const active = forChat.find((run) => run.status === 'running');
    if (active) throw new ActiveRunError(active.id);

    const id = randomUUID();
    const latest = forChat[forChat.length - 1];
    const run: Run = {
      id,
      chatId: input.chatId,
      turnId: input.kind === 'resume' && latest ? latest.turnId : id,
      kind: input.kind,
      status: 'running',
      routine: input.routine,
      requestId: input.requestId,
      payerUserId: input.payerUserId,
      stopRequested: false,
      startedAt: nowIso(),
    };
    this.runs.set(id, run);
    return { run: { ...run }, duplicate: false };
  }

  async get(runId: string): Promise<Run | null> {
    const run = this.runs.get(runId);
    return run ? { ...run } : null;
  }

  latest(chatId: string): Promise<Run | null> {
    const forChat = [...this.runs.values()].filter((run) => run.chatId === chatId);
    const run = forChat[forChat.length - 1];
    return Promise.resolve(run ? { ...run } : null);
  }

  async listRunning(): Promise<Run[]> {
    return [...this.runs.values()].filter((run) => run.status === 'running').map((run) => ({ ...run }));
  }

  async finish(runId: string, status: Exclude<RunStatus, 'running'>, error?: string): Promise<boolean> {
    const run = this.runs.get(runId);
    if (!run || run.status !== 'running') return false;
    run.status = status;
    run.error = error;
    run.finishedAt = nowIso();
    return true;
  }

  async requestStop(runId: string): Promise<boolean> {
    const run = this.runs.get(runId);
    if (!run || run.status !== 'running') return false;
    run.stopRequested = true;
    return true;
  }

  async appendEvent(
    chatId: string,
    runId: string,
    type: RunEventType,
    payload: Record<string, unknown>
  ): Promise<RunEvent> {
    const list = this.events.get(chatId) ?? [];
    const event: RunEvent = { seq: list.length + 1, chatId, runId, type, payload, createdAt: nowIso() };
    list.push(event);
    this.events.set(chatId, list);
    return event;
  }

  async listEvents(chatId: string, afterSeq: number, runId?: string): Promise<RunEvent[]> {
    return (this.events.get(chatId) ?? []).filter((event) => event.seq > afterSeq && (!runId || event.runId === runId));
  }

  async acquireLease(name: string, owner: string, ttlMs: number): Promise<boolean> {
    const held = this.leases.get(name);
    if (held && held.owner !== owner && held.expiresAt > Date.now()) return false;
    this.leases.set(name, { owner, expiresAt: Date.now() + ttlMs });
    return true;
  }

  async releaseLease(name: string, owner: string): Promise<void> {
    if (this.leases.get(name)?.owner === owner) this.leases.delete(name);
  }
}
