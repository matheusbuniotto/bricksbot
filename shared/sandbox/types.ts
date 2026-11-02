export type BackendId = 'databricks' | 'python_exec' | 'e2b';

export type SandboxBackendSetting = 'off' | BackendId;

export type SandboxSessionStatus = 'creating' | 'ready' | 'running' | 'stopped' | 'failed' | 'deleted';

export type SandboxEventType = 'create' | 'command' | 'upload' | 'download' | 'stop' | 'delete' | 'error';

export interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  artifactPaths: string[];
}

export interface SandboxSession {
  id: string;
  chatId: string;
  botId: string;
  userId: string;
  backend: BackendId;
  externalId: string;
  status: SandboxSessionStatus;
  createdAt: string;
  lastUsedAt: string;
  stoppedAt: string | null;
  metadata: Record<string, unknown>;
}

export interface SandboxEvent {
  id: string;
  sessionId: string;
  type: SandboxEventType;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface CreateSandboxSessionInput {
  chatId: string;
  botId: string;
  userId: string;
  backend: BackendId;
  externalId: string;
  status?: SandboxSessionStatus;
  metadata?: Record<string, unknown>;
}

export interface SandboxStore {
  getSession(id: string): Promise<SandboxSession | null>;
  getActiveSessionForChat(chatId: string): Promise<SandboxSession | null>;
  getLatestSessionForChat(chatId: string): Promise<SandboxSession | null>;
  listActiveSessionsForUser(userId: string): Promise<SandboxSession[]>;
  listActiveSessions(): Promise<SandboxSession[]>;
  createSession(input: CreateSandboxSessionInput): Promise<SandboxSession>;
  updateSessionStatus(
    id: string,
    status: SandboxSessionStatus,
    patch?: {
      backend?: BackendId;
      externalId?: string;
      lastUsedAt?: string;
      stoppedAt?: string | null;
      metadata?: Record<string, unknown>;
    }
  ): Promise<SandboxSession>;
  touchSession(id: string, usedAt?: string): Promise<SandboxSession>;
  addEvent(sessionId: string, type: SandboxEventType, payload: Record<string, unknown>): Promise<SandboxEvent>;
  listEvents(sessionId: string, limit?: number): Promise<SandboxEvent[]>;
}

/** UI-safe summary of a sandbox event (never exposes raw internal sandbox filesystem paths). */
export interface SandboxUiEvent {
  id: string;
  type: SandboxEventType;
  summary: string;
  exitCode?: number;
  durationMs?: number;
  artifactName?: string;
  createdAt: string;
}

/** UI-safe snapshot returned for the Bot Details Computer tab. */
export interface SandboxUiStatus {
  enabled: boolean;
  backend: SandboxBackendSetting;
  session: {
    id: string;
    backend: BackendId;
    status: SandboxSessionStatus;
    createdAt: string;
    lastUsedAt: string;
    stoppedAt: string | null;
  } | null;
  recentEvents: SandboxUiEvent[];
}
