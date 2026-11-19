/** Run model: one run is one stretch of agent work in a chat, from a send/decision until it finishes or pauses. */

/** `waiting` means the run paused on approvals or a choice; the user's answer starts a `resume` run. */
export type RunStatus = 'running' | 'waiting' | 'completed' | 'failed' | 'stopped';

/** `resume` runs continue a turn after an approval or choice and share its `turnId`. */
export type RunKind = 'send' | 'resume';

export interface Run {
  id: string;
  chatId: string;
  turnId: string;
  kind: RunKind;
  status: RunStatus;
  /** Started by a routine: no user token, volume_write refused. */
  routine: boolean;
  requestId?: string;
  /** Who the run's spend is charged to: the signed-in caller, not the bot owner. */
  payerUserId?: string;
  stopRequested: boolean;
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

export type RunEventType =
  | 'run.started'
  | 'tool.started'
  | 'tool.finished'
  | 'approval.pending'
  | 'assistant.committed'
  | 'run.finished';

export interface RunEvent {
  /** Per-chat sequence, gap-free, so a reader can resume with `seq > lastSeen`. */
  seq: number;
  chatId: string;
  runId: string;
  type: RunEventType;
  payload: Record<string, unknown>;
  createdAt: string;
}

/** What a turn knows about the run it executes in. */
export interface RunContext {
  runId: string;
  chatId: string;
  turnId: string;
  kind: RunKind;
  routine: boolean;
  payerUserId?: string;
  /** Aborts when the user presses Stop (or the run's lease is lost). */
  signal: AbortSignal;
  emit(type: RunEventType, payload?: Record<string, unknown>): Promise<void>;
  /** Live model text for watchers on this instance. Never stored: the committed message is the record. */
  delta(text: string): void;
}

export interface StartRunInput {
  chatId: string;
  kind: RunKind;
  routine: boolean;
  requestId?: string;
  payerUserId?: string;
}

export interface RunStore {
  /**
   * Opens a run unless the chat already has one running (throws ActiveRunError).
   * A `requestId` seen before returns that run with `duplicate: true` instead.
   */
  start(input: StartRunInput): Promise<{ run: Run; duplicate: boolean }>;
  get(runId: string): Promise<Run | null>;
  /** The chat's most recently started run. */
  latest(chatId: string): Promise<Run | null>;
  listRunning(): Promise<Run[]>;
  /** Moves a running run to its final status. False when it was no longer running. */
  finish(runId: string, status: Exclude<RunStatus, 'running'>, error?: string): Promise<boolean>;
  requestStop(runId: string): Promise<boolean>;
  appendEvent(chatId: string, runId: string, type: RunEventType, payload: Record<string, unknown>): Promise<RunEvent>;
  listEvents(chatId: string, afterSeq: number, runId?: string): Promise<RunEvent[]>;
  /** Takes the lease when free, expired, or already ours; false when another owner holds it. */
  acquireLease(name: string, owner: string, ttlMs: number): Promise<boolean>;
  releaseLease(name: string, owner: string): Promise<void>;
}

export class ActiveRunError extends Error {
  constructor(
    readonly activeRunId: string,
    message = 'A run is already active in this chat'
  ) {
    super(message);
  }
}

/** Raised when a user already has the most runs in flight we allow. */
export class TooManyRunsError extends Error {
  constructor(readonly limit: number) {
    super(`Too many runs in flight (limit ${limit}); wait for one to finish or stop it`);
  }
}
