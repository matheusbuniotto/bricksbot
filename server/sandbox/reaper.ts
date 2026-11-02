import type { SandboxSessionService } from './session-service.js';

export interface SandboxReaperOptions {
  sessionService: SandboxSessionService;
  idleMinutes?: number;
  maxSessionMinutes?: number;
  now?: () => Date;
}

/**
 * Stops and deletes idle / over-age sandboxes (SB-5) and reconciles orphaned sessions at startup (§9).
 */
export class SandboxReaper {
  private readonly sessionService: SandboxSessionService;
  private readonly idleMinutes: number;
  private readonly maxSessionMinutes: number;
  private readonly now: () => Date;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: SandboxReaperOptions) {
    this.sessionService = options.sessionService;
    this.idleMinutes = options.idleMinutes ?? options.sessionService.getIdleMinutes();
    this.maxSessionMinutes = options.maxSessionMinutes ?? options.sessionService.getMaxSessionMinutes();
    this.now = options.now ?? (() => new Date());
  }

  private shouldReap(session: { status: string; createdAt: string; lastUsedAt: string }): {
    reap: boolean;
    reason: string;
  } {
    const nowMs = this.now().getTime();
    const lastUsedMs = new Date(session.lastUsedAt).getTime();
    const createdMs = new Date(session.createdAt).getTime();
    const idleCutoffMs = nowMs - this.idleMinutes * 60_000;
    const ageCutoffMs = nowMs - this.maxSessionMinutes * 60_000;

    if (session.status === 'creating') {
      return { reap: true, reason: 'stuck_creating' };
    }
    if (Number.isNaN(createdMs) || createdMs <= ageCutoffMs) {
      return { reap: true, reason: 'max_session_age' };
    }
    if (Number.isNaN(lastUsedMs) || lastUsedMs <= idleCutoffMs) {
      return { reap: true, reason: 'idle_timeout' };
    }
    return { reap: false, reason: '' };
  }

  /**
   * Stop and delete any active sandbox that is idle or past max session age.
   */
  async reapIdleSessions(): Promise<{ checked: number; reaped: string[] }> {
    if (!this.sessionService.isEnabled()) {
      return { checked: 0, reaped: [] };
    }

    const active = await this.sessionService.getStore().listActiveSessions();
    const reaped: string[] = [];

    for (const session of active) {
      const decision = this.shouldReap(session);
      if (!decision.reap) continue;
      await this.sessionService.stopSession(session.chatId, decision.reason);
      await this.sessionService.deleteSession(session.chatId, decision.reason);
      reaped.push(session.id);
    }

    return { checked: active.length, reaped };
  }

  /**
   * Reconcile orphaned sessions when the app boots (stuck creating / idle / over max age).
   * Calls backend stop+delete for each reaped row. Remote sandboxes with no DB row still
   * require workspace admin cleanup until a list API is available.
   */
  async reconcileAtStartup(): Promise<{ reconciled: string[] }> {
    if (!this.sessionService.isEnabled()) {
      return { reconciled: [] };
    }

    const active = await this.sessionService.getStore().listActiveSessions();
    const reconciled: string[] = [];

    for (const session of active) {
      const decision = this.shouldReap(session);
      if (!decision.reap) continue;
      const reason = `startup_reconcile:${decision.reason}`;
      await this.sessionService.stopSession(session.chatId, reason);
      await this.sessionService.deleteSession(session.chatId, reason);
      reconciled.push(session.id);
    }

    return { reconciled };
  }

  start(intervalMs: number = 60_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.reapIdleSessions().catch(() => {
        // Reaper errors are already recorded as sandbox_events per session.
      });
    }, intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
