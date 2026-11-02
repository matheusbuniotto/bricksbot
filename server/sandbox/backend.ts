import type { ExecutionResult } from '../../shared/sandbox/types.js';

export interface RunCommandOptions {
  cwd?: string;
  timeoutSec: number;
  env?: Record<string, string>;
}

/**
 * Backend-agnostic execution interface (Phase 5 spec §5.2).
 * Implementations talk to Databricks Sandbox REST API or E2B Cloud.
 */
export interface ExecutionBackend {
  createSession(sessionId: string): Promise<string>;
  runCommand(externalId: string, cmd: string[], opts: RunCommandOptions): Promise<ExecutionResult>;
  uploadFile(externalId: string, data: Uint8Array | string, dest: string): Promise<string>;
  downloadFile(externalId: string, src: string): Promise<Uint8Array>;
  stopSession(externalId: string): Promise<void>;
  deleteSession(externalId: string): Promise<void>;
}
