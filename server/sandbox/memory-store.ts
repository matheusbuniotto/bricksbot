import { randomUUID } from 'node:crypto';
import type {
  CreateSandboxSessionInput,
  SandboxEvent,
  SandboxEventType,
  SandboxSession,
  SandboxSessionStatus,
  SandboxStore,
} from '../../shared/sandbox/types.js';

const ACTIVE_STATUSES = new Set<SandboxSessionStatus>(['creating', 'ready', 'running']);

export function isActiveSandboxStatus(status: SandboxSessionStatus): boolean {
  return ACTIVE_STATUSES.has(status);
}

/** In-memory SandboxStore for local runs and unit tests without Lakebase. */
export class MemorySandboxStore implements SandboxStore {
  private readonly sessions = new Map<string, SandboxSession>();
  private readonly events = new Map<string, SandboxEvent[]>();
  private readonly now: () => Date;

  constructor(options?: { now?: () => Date }) {
    this.now = options?.now ?? (() => new Date());
  }

  private nowIso(): string {
    return this.now().toISOString();
  }

  async getSession(id: string): Promise<SandboxSession | null> {
    const found = this.sessions.get(id);
    return found ? { ...found, metadata: { ...found.metadata } } : null;
  }

  async getActiveSessionForChat(chatId: string): Promise<SandboxSession | null> {
    const matching = [...this.sessions.values()]
      .filter((s) => s.chatId === chatId && isActiveSandboxStatus(s.status))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const head = matching[0];
    return head ? { ...head, metadata: { ...head.metadata } } : null;
  }

  async getLatestSessionForChat(chatId: string): Promise<SandboxSession | null> {
    const matching = [...this.sessions.values()]
      .filter((s) => s.chatId === chatId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const head = matching[0];
    return head ? { ...head, metadata: { ...head.metadata } } : null;
  }

  async listActiveSessionsForUser(userId: string): Promise<SandboxSession[]> {
    return [...this.sessions.values()]
      .filter((s) => s.userId === userId && isActiveSandboxStatus(s.status))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((s) => ({ ...s, metadata: { ...s.metadata } }));
  }

  async listActiveSessions(): Promise<SandboxSession[]> {
    return [...this.sessions.values()]
      .filter((s) => isActiveSandboxStatus(s.status))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((s) => ({ ...s, metadata: { ...s.metadata } }));
  }

  async createSession(input: CreateSandboxSessionInput): Promise<SandboxSession> {
    const now = this.nowIso();
    const session: SandboxSession = {
      id: randomUUID(),
      chatId: input.chatId,
      botId: input.botId,
      userId: input.userId,
      backend: input.backend,
      externalId: input.externalId,
      status: input.status ?? 'creating',
      createdAt: now,
      lastUsedAt: now,
      stoppedAt: null,
      metadata: { ...(input.metadata ?? {}) },
    };
    this.sessions.set(session.id, session);
    return { ...session, metadata: { ...session.metadata } };
  }

  async updateSessionStatus(
    id: string,
    status: SandboxSessionStatus,
    patch?: {
      backend?: SandboxSession['backend'];
      externalId?: string;
      lastUsedAt?: string;
      stoppedAt?: string | null;
      metadata?: Record<string, unknown>;
    },
  ): Promise<SandboxSession> {
    const existing = this.sessions.get(id);
    if (!existing) {
      throw new Error(`Sandbox session not found: ${id}`);
    }
    const updated: SandboxSession = {
      ...existing,
      status,
      backend: patch?.backend ?? existing.backend,
      externalId: patch?.externalId ?? existing.externalId,
      lastUsedAt: patch?.lastUsedAt ?? existing.lastUsedAt,
      stoppedAt: patch?.stoppedAt !== undefined ? patch.stoppedAt : existing.stoppedAt,
      metadata: patch?.metadata ? { ...patch.metadata } : { ...existing.metadata },
    };
    this.sessions.set(id, updated);
    return { ...updated, metadata: { ...updated.metadata } };
  }

  async touchSession(id: string, usedAt?: string): Promise<SandboxSession> {
    const existing = this.sessions.get(id);
    if (!existing) {
      throw new Error(`Sandbox session not found: ${id}`);
    }
    const updated: SandboxSession = {
      ...existing,
      lastUsedAt: usedAt ?? this.nowIso(),
    };
    this.sessions.set(id, updated);
    return { ...updated, metadata: { ...updated.metadata } };
  }

  async addEvent(
    sessionId: string,
    type: SandboxEventType,
    payload: Record<string, unknown>,
  ): Promise<SandboxEvent> {
    if (!this.sessions.has(sessionId)) {
      throw new Error(`Sandbox session not found: ${sessionId}`);
    }
    const event: SandboxEvent = {
      id: randomUUID(),
      sessionId,
      type,
      payload: { ...payload },
      createdAt: this.nowIso(),
    };
    const list = this.events.get(sessionId) ?? [];
    list.unshift(event);
    this.events.set(sessionId, list);
    return { ...event, payload: { ...event.payload } };
  }

  async listEvents(sessionId: string, limit: number = 50): Promise<SandboxEvent[]> {
    const list = this.events.get(sessionId) ?? [];
    return list.slice(0, limit).map((e) => ({ ...e, payload: { ...e.payload } }));
  }
}
