import type {
  BackendId,
  ExecutionResult,
  SandboxEvent,
  SandboxSession,
  SandboxStore,
  SandboxUiEvent,
  SandboxUiStatus,
} from '../../shared/sandbox/types.js';
import {
  redactSecrets,
  safeArtifactName,
  sanitizeEventPayload,
  stripSandboxPaths,
  truncatePreview,
} from './redact.js';
import type { SandboxConfig, SandboxRegistry } from './registry.js';

export interface SandboxActorContext {
  chatId: string;
  botId: string;
  userId: string;
}

const FORBIDDEN_ENV_KEY_PATTERN =
  /(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY|CREDENTIAL|AUTHORIZATION)/i;

/**
 * Infer the actual backend when create falls back (e.g. Databricks → python_exec).
 */
export function inferBackendIdFromExternalId(externalId: string): BackendId | null {
  return externalId.trim().startsWith('python-exec/') ? 'python_exec' : null;
}

/**
 * Strip any credential-shaped env vars or known secret values before passing env into a sandbox (SB-9).
 */
export function sanitizeSandboxEnv(
  env: Record<string, string> | undefined,
  secrets: Iterable<string> = [],
): Record<string, string> {
  if (!env) return {};
  const secretList = [...secrets].map((s) => s.trim()).filter(Boolean);
  const out: Record<string, string> = {};

  for (const [rawKey, rawVal] of Object.entries(env)) {
    const key = rawKey.trim();
    if (!key || typeof rawVal !== 'string') continue;
    if (FORBIDDEN_ENV_KEY_PATTERN.test(key)) {
      continue;
    }
    if (secretList.some((secret) => secret.length >= 4 && rawVal.includes(secret))) {
      continue;
    }
    out[key] = rawVal;
  }

  return out;
}

function toUiEvent(event: SandboxEvent): SandboxUiEvent {
  const payload = event.payload ?? {};
  const artifactName =
    safeArtifactName(typeof payload.artifactName === 'string' ? payload.artifactName : undefined) ??
    safeArtifactName(typeof payload.dest === 'string' ? payload.dest : undefined) ??
    safeArtifactName(typeof payload.src === 'string' ? payload.src : undefined);

  let summary = '';
  switch (event.type) {
    case 'create': {
      const backend = typeof payload.backend === 'string' ? payload.backend : 'sandbox';
      summary = `Sandbox started (${backend})`;
      break;
    }
    case 'command': {
      const cmdRaw = typeof payload.cmd === 'string' ? payload.cmd : 'command';
      const cmd = stripSandboxPaths(cmdRaw).slice(0, 80);
      summary = `Ran: ${cmd}`;
      break;
    }
    case 'upload':
      summary = artifactName ? `Uploaded ${artifactName}` : 'Uploaded file';
      break;
    case 'download':
      summary = artifactName ? `Downloaded ${artifactName}` : 'Downloaded file';
      break;
    case 'stop':
      summary = 'Sandbox stopped';
      break;
    case 'delete':
      summary = 'Sandbox deleted';
      break;
    case 'error': {
      const errRaw = typeof payload.error === 'string' ? payload.error : 'Sandbox error';
      summary = stripSandboxPaths(errRaw).slice(0, 100);
      break;
    }
    default: {
      const _exhaustive: never = event.type;
      summary = `Unknown event (${String(_exhaustive)})`;
      break;
    }
  }

  return {
    id: event.id,
    type: event.type,
    summary,
    exitCode: typeof payload.exitCode === 'number' ? payload.exitCode : undefined,
    durationMs: typeof payload.durationMs === 'number' ? payload.durationMs : undefined,
    artifactName,
    createdAt: event.createdAt,
  };
}

export interface SandboxSessionServiceOptions {
  store: SandboxStore;
  registry: SandboxRegistry;
  config?: Partial<SandboxConfig>;
  now?: () => Date;
}

export class SandboxSessionService {
  private readonly store: SandboxStore;
  private readonly registry: SandboxRegistry;
  private readonly idleMinutes: number;
  private readonly execTimeoutSec: number;
  private readonly maxSessionMinutes: number;
  private readonly maxActivePerUser: number;
  private readonly secrets: string[];
  private readonly artifactVolumeRoot?: string;
  private readonly now: () => Date;

  constructor(options: SandboxSessionServiceOptions) {
    this.store = options.store;
    this.registry = options.registry;
    this.idleMinutes = options.config?.idleMinutes ?? 15;
    this.execTimeoutSec = options.config?.execTimeoutSec ?? 120;
    this.maxSessionMinutes = options.config?.maxSessionMinutes ?? 120;
    this.maxActivePerUser = options.config?.maxActivePerUser ?? 3;
    this.secrets = options.config?.secretsToRedact ?? [];
    this.artifactVolumeRoot = options.config?.artifactVolumeRoot;
    this.now = options.now ?? (() => new Date());
  }

  private nowIso(): string {
    return this.now().toISOString();
  }

  isEnabled(): boolean {
    return this.registry.isEnabled();
  }

  getStore(): SandboxStore {
    return this.store;
  }

  getRegistry(): SandboxRegistry {
    return this.registry;
  }

  getIdleMinutes(): number {
    return this.idleMinutes;
  }

  getMaxSessionMinutes(): number {
    return this.maxSessionMinutes;
  }

  getArtifactVolumeRoot(): string | undefined {
    return this.artifactVolumeRoot;
  }

  getSecretsToRedact(): string[] {
    return [...this.secrets];
  }

  isPastMaxAge(session: SandboxSession, at: Date = this.now()): boolean {
    const createdMs = Date.parse(session.createdAt);
    if (Number.isNaN(createdMs)) return true;
    return at.getTime() - createdMs > this.maxSessionMinutes * 60_000;
  }

  private resolveActualBackend(
    configured: BackendId,
    externalId: string,
  ): BackendId {
    return inferBackendIdFromExternalId(externalId) ?? configured;
  }

  /**
   * Resolve the execution backend for a session. DatabricksSandboxBackend also
   * serves `python-exec/…` external ids when the preview API falls back.
   */
  private backendForSession(session: Pick<SandboxSession, 'backend' | 'externalId'>) {
    try {
      return this.registry.getBackend(session.backend);
    } catch (err) {
      if (
        session.backend === 'python_exec' &&
        inferBackendIdFromExternalId(session.externalId) === 'python_exec'
      ) {
        return this.registry.getBackend('databricks');
      }
      throw err;
    }
  }

  /**
   * Lazily create a sandbox session for `ctx.chatId`, reuse the active one, or resume a stopped one (SB-2).
   */
  async ensureSession(ctx: SandboxActorContext): Promise<SandboxSession> {
    if (!this.registry.isEnabled()) {
      throw new Error('Sandbox execution is disabled (SANDBOX_BACKEND=off)');
    }

    const existing = await this.store.getActiveSessionForChat(ctx.chatId);
    if (existing) {
      if (this.isPastMaxAge(existing)) {
        await this.deleteSession(ctx.chatId, 'max_session_age');
      } else {
        return this.store.touchSession(existing.id, this.nowIso());
      }
    }

    const latest = await this.store.getLatestSessionForChat(ctx.chatId);
    if (
      latest &&
      latest.status === 'stopped' &&
      !this.isPastMaxAge(latest)
    ) {
      return this.resumeStoppedSession(ctx, latest);
    }

    return this.createFreshSession(ctx);
  }

  private async resumeStoppedSession(
    ctx: SandboxActorContext,
    session: SandboxSession,
  ): Promise<SandboxSession> {
    const backend = this.backendForSession(session);
    try {
      // Same chatId → same remote id; Databricks home / python_exec file map persist across stop.
      const externalId = await backend.createSession(ctx.chatId);
      const actualBackend = this.resolveActualBackend(session.backend, externalId);
      const ready = await this.store.updateSessionStatus(session.id, 'ready', {
        backend: actualBackend,
        externalId,
        lastUsedAt: this.nowIso(),
        stoppedAt: null,
        metadata: { ...session.metadata, resumed: true },
      });
      await this.store.addEvent(
        ready.id,
        'create',
        sanitizeEventPayload(
          { backend: actualBackend, externalId, resumed: true },
          this.secrets,
        ),
      );
      return ready;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sandbox resume failed';
      await this.store.addEvent(
        session.id,
        'error',
        sanitizeEventPayload({ stage: 'resume', error: message }, this.secrets),
      );
      // Fall through to a fresh session if resume fails.
      await this.deleteSession(ctx.chatId, 'resume_failed');
      return this.createFreshSession(ctx);
    }
  }

  private async createFreshSession(ctx: SandboxActorContext): Promise<SandboxSession> {
    const activeForUser = await this.store.listActiveSessionsForUser(ctx.userId);
    if (activeForUser.length >= this.maxActivePerUser) {
      throw new Error(
        `Sandbox limit reached: user already has ${activeForUser.length} active sandboxes (max ${this.maxActivePerUser}). Stop or delete an existing sandbox first.`,
      );
    }

    const backendId = this.registry.getDefaultBackendId();
    const backend = this.registry.getBackend(backendId);

    const placeholder = await this.store.createSession({
      chatId: ctx.chatId,
      botId: ctx.botId,
      userId: ctx.userId,
      backend: backendId,
      externalId: `bricksbot-${ctx.chatId}`,
      status: 'creating',
    });

    try {
      const externalId = await backend.createSession(ctx.chatId);
      const actualBackend = this.resolveActualBackend(backendId, externalId);
      const ready = await this.store.updateSessionStatus(placeholder.id, 'ready', {
        backend: actualBackend,
        externalId,
        lastUsedAt: this.nowIso(),
      });
      await this.store.addEvent(
        ready.id,
        'create',
        sanitizeEventPayload({ backend: actualBackend, externalId }, this.secrets),
      );
      return ready;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sandbox creation failed';
      await this.store.updateSessionStatus(placeholder.id, 'failed', {
        stoppedAt: this.nowIso(),
      });
      await this.store.addEvent(
        placeholder.id,
        'error',
        sanitizeEventPayload({ stage: 'create', error: message }, this.secrets),
      );
      throw new Error(redactSecrets(message, this.secrets));
    }
  }

  /**
   * Run a command inside the chat's sandbox (SB-1, SB-7, SB-8, SB-9).
   */
  async exec(
    ctx: SandboxActorContext,
    input: {
      cmd: string[];
      cwd?: string;
      timeoutSec?: number;
      env?: Record<string, string>;
    },
  ): Promise<ExecutionResult> {
    const session = await this.ensureSession(ctx);
    const backend = this.backendForSession(session);
    const safeEnv = sanitizeSandboxEnv(input.env, this.secrets);
    const requestedTimeout = input.timeoutSec ?? this.execTimeoutSec;
    const timeoutSec = Math.max(1, Math.min(requestedTimeout, this.execTimeoutSec * 2));

    await this.store.updateSessionStatus(session.id, 'running', {
      lastUsedAt: this.nowIso(),
    });

    try {
      const raw = await backend.runCommand(session.externalId, input.cmd, {
        cwd: input.cwd,
        timeoutSec,
        env: safeEnv,
      });

      const stdout = redactSecrets(raw.stdout, this.secrets);
      const stderr = redactSecrets(raw.stderr, this.secrets);
      const result: ExecutionResult = {
        stdout,
        stderr,
        exitCode: raw.exitCode,
        durationMs: raw.durationMs,
        artifactPaths: raw.artifactPaths,
      };

      await this.store.updateSessionStatus(session.id, 'ready', {
        lastUsedAt: this.nowIso(),
      });

      await this.store.addEvent(
        session.id,
        'command',
        sanitizeEventPayload(
          {
            cmd: input.cmd.join(' '),
            cwd: input.cwd ?? '',
            exitCode: result.exitCode,
            durationMs: result.durationMs,
            stdoutPreview: truncatePreview(stdout, this.secrets),
            stderrPreview: truncatePreview(stderr, this.secrets),
          },
          this.secrets,
        ),
      );

      return result;
    } catch (err) {
      const message = redactSecrets(
        err instanceof Error ? err.message : 'Command execution failed',
        this.secrets,
      );
      await this.store.updateSessionStatus(session.id, 'failed', {
        lastUsedAt: this.nowIso(),
      });
      await this.store.addEvent(
        session.id,
        'error',
        sanitizeEventPayload(
          {
            stage: 'command',
            cmd: input.cmd.join(' '),
            error: message,
          },
          this.secrets,
        ),
      );
      throw new Error(message);
    }
  }

  async uploadFile(
    ctx: SandboxActorContext,
    input: { data: Uint8Array | string; dest: string },
  ): Promise<{ dest: string; artifactName: string; bytes: number }> {
    const session = await this.ensureSession(ctx);
    const backend = this.backendForSession(session);
    const byteLength =
      typeof input.data === 'string'
        ? Buffer.byteLength(input.data, 'utf8')
        : input.data.byteLength;

    try {
      const dest = await backend.uploadFile(session.externalId, input.data, input.dest);
      await this.store.touchSession(session.id, this.nowIso());
      const artifactName = safeArtifactName(dest) ?? 'file';
      await this.store.addEvent(
        session.id,
        'upload',
        sanitizeEventPayload(
          { dest, artifactName, bytes: byteLength },
          this.secrets,
        ),
      );
      return { dest, artifactName, bytes: byteLength };
    } catch (err) {
      const message = redactSecrets(
        err instanceof Error ? err.message : 'Upload failed',
        this.secrets,
      );
      await this.store.addEvent(
        session.id,
        'error',
        sanitizeEventPayload({ stage: 'upload', error: message }, this.secrets),
      );
      throw new Error(message);
    }
  }

  async downloadFile(
    ctx: SandboxActorContext,
    input: { src: string },
  ): Promise<{ data: Uint8Array; artifactName: string; bytes: number }> {
    const session = await this.ensureSession(ctx);
    const backend = this.backendForSession(session);
    try {
      const data = await backend.downloadFile(session.externalId, input.src);
      await this.store.touchSession(session.id, this.nowIso());
      const artifactName = safeArtifactName(input.src) ?? 'file';
      await this.store.addEvent(
        session.id,
        'download',
        sanitizeEventPayload(
          { src: input.src, artifactName, bytes: data.byteLength },
          this.secrets,
        ),
      );
      return { data, artifactName, bytes: data.byteLength };
    } catch (err) {
      const message = redactSecrets(
        err instanceof Error ? err.message : 'Download failed',
        this.secrets,
      );
      await this.store.addEvent(
        session.id,
        'error',
        sanitizeEventPayload({ stage: 'download', error: message }, this.secrets),
      );
      throw new Error(message);
    }
  }

  async stopSession(
    chatId: string,
    reason: string = 'manual',
  ): Promise<{ stopped: boolean; session: SandboxSession | null }> {
    const active = await this.store.getActiveSessionForChat(chatId);
    if (!active) {
      return { stopped: false, session: null };
    }
    const backend = this.backendForSession(active);
    try {
      await backend.stopSession(active.externalId);
    } catch (err) {
      const message = redactSecrets(
        err instanceof Error ? err.message : 'Stop failed',
        this.secrets,
      );
      await this.store.addEvent(
        active.id,
        'error',
        sanitizeEventPayload({ stage: 'stop', error: message }, this.secrets),
      );
    }
    const stopped = await this.store.updateSessionStatus(active.id, 'stopped', {
      stoppedAt: this.nowIso(),
    });
    await this.store.addEvent(
      active.id,
      'stop',
      sanitizeEventPayload({ reason }, this.secrets),
    );
    return { stopped: true, session: stopped };
  }

  async deleteSession(
    chatId: string,
    reason: string = 'manual',
  ): Promise<{ deleted: boolean; session: SandboxSession | null }> {
    const session =
      (await this.store.getActiveSessionForChat(chatId)) ??
      (await this.store.getLatestSessionForChat(chatId));
    if (!session || session.status === 'deleted') {
      return { deleted: false, session: null };
    }

    const backend = this.backendForSession(session);
    try {
      await backend.deleteSession(session.externalId);
    } catch (err) {
      const message = redactSecrets(
        err instanceof Error ? err.message : 'Delete failed',
        this.secrets,
      );
      await this.store.addEvent(
        session.id,
        'error',
        sanitizeEventPayload({ stage: 'delete', error: message }, this.secrets),
      );
    }

    const deleted = await this.store.updateSessionStatus(session.id, 'deleted', {
      stoppedAt: this.nowIso(),
    });
    await this.store.addEvent(
      session.id,
      'delete',
      sanitizeEventPayload({ reason }, this.secrets),
    );
    return { deleted: true, session: deleted };
  }

  async getUiStatusForChat(chatId: string): Promise<SandboxUiStatus> {
    const enabled = this.registry.isEnabled();
    const backend = this.registry.getSetting();
    if (!enabled) {
      return {
        enabled: false,
        backend: 'off',
        session: null,
        recentEvents: [],
      };
    }

    const session =
      (await this.store.getActiveSessionForChat(chatId)) ??
      (await this.store.getLatestSessionForChat(chatId));
    if (!session) {
      return {
        enabled: true,
        backend,
        session: null,
        recentEvents: [],
      };
    }

    const events = await this.store.listEvents(session.id, 15);
    return {
      enabled: true,
      // Prefer the session's actual backend (may differ after python_exec fallback).
      backend: session.backend,
      session: {
        id: session.id,
        backend: session.backend,
        status: session.status,
        createdAt: session.createdAt,
        lastUsedAt: session.lastUsedAt,
        stoppedAt: session.stoppedAt,
      },
      recentEvents: events.map(toUiEvent),
    };
  }
}
