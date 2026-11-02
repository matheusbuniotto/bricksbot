import type { ExecutionResult } from '../../shared/sandbox/types.js';
import type { ExecutionBackend, RunCommandOptions } from './backend.js';
import { SystemAiPythonBackend } from './python-exec-backend.js';

export interface DatabricksSandboxConfig {
  host: string;
  getToken: () => Promise<string>;
  inactivityTimeoutSec?: number;
  imageUri?: string;
  /**
   * When true (default), automatically falls back to Unity Catalog `system.ai.python_exec`
   * if `/api/2.0/sandboxes` returns 404/403 because the Sandboxes preview is not enabled.
   */
  fallbackToPythonExec?: boolean;
  fetchImpl?: typeof fetch;
}

/** POSIX single-quote shell escaping so arbitrary strings are safe inside `/bin/bash -c`. */
export function shellQuote(value: string): string {
  if (value.length === 0) return "''";
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function toSandboxResourceName(idOrName: string): string {
  const trimmed = idOrName.trim().replace(/^\/+/, '');
  if (!trimmed) {
    throw new Error('Sandbox identifier is required');
  }
  return trimmed.startsWith('sandboxes/') ? trimmed : `sandboxes/${trimmed}`;
}

export function formatDatabricksSandboxId(sessionId: string): string {
  const cleaned = sessionId
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `bricksbot-${cleaned || 'session'}`;
}

export function buildShellScript(cmd: string[], cwd?: string): string {
  if (cmd.length === 0 || !cmd[0]?.trim()) {
    throw new Error('Command cannot be empty');
  }

  let commandBody: string;
  if (cmd.length === 1) {
    commandBody = cmd[0];
  } else if (
    cmd.length >= 3 &&
    (cmd[0] === '/bin/bash' || cmd[0] === 'bash' || cmd[0] === '/bin/sh' || cmd[0] === 'sh') &&
    cmd[1] === '-c'
  ) {
    commandBody = cmd.slice(2).join(' ');
  } else {
    commandBody = cmd.map(shellQuote).join(' ');
  }

  const trimmedCwd = cwd?.trim();
  if (trimmedCwd) {
    return `cd ${shellQuote(trimmedCwd)} && ${commandBody}`;
  }
  return commandBody;
}

export function validateSandboxFilePath(filePath: string, label: string): string {
  const trimmed = filePath.trim();
  if (!trimmed) {
    throw new Error(`${label} path is required`);
  }
  if (trimmed.includes('\0')) {
    throw new Error(`${label} path cannot contain null bytes`);
  }
  return trimmed;
}

/**
 * Databricks Sandbox REST API backend (`/api/2.0/sandboxes` + `/api/2.0/sandbox-exec`).
 */
export class DatabricksSandboxBackend implements ExecutionBackend {
  private readonly fetchImpl: typeof fetch;
  private readonly inactivityTimeoutSec: number;
  private readonly fallbackToPythonExec: boolean;
  private readonly pythonExecFallback: SystemAiPythonBackend;

  constructor(private readonly config: DatabricksSandboxConfig) {
    if (!config.host?.trim()) {
      throw new Error('DatabricksSandboxBackend requires host');
    }
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
    this.inactivityTimeoutSec = config.inactivityTimeoutSec ?? 900;
    this.fallbackToPythonExec = config.fallbackToPythonExec ?? true;
    this.pythonExecFallback = new SystemAiPythonBackend({
      host: config.host,
      getToken: config.getToken,
      fetchImpl: this.fetchImpl,
    });
  }

  private isPythonExecSession(externalId: string): boolean {
    return externalId.trim().startsWith('python-exec/');
  }

  private baseHost(): string {
    const trimmed = this.config.host.trim().replace(/\/+$/, '');
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const token = await this.config.getToken();
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }

  async createSession(sessionId: string): Promise<string> {
    const sandboxId = formatDatabricksSandboxId(sessionId);
    const url = `${this.baseHost()}/api/2.0/sandboxes?sandbox_id=${encodeURIComponent(sandboxId)}`;
    const spec: Record<string, unknown> = {
      compute: {
        inactivity_timeout: `${Math.max(60, Math.round(this.inactivityTimeoutSec))}s`,
      },
    };
    if (this.config.imageUri?.trim()) {
      spec.environment = { image_uri: this.config.imageUri.trim() };
    }

    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: await this.authHeaders(),
      body: JSON.stringify({ spec }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      const isPreviewUnavailable =
        (response.status === 404 && detail.includes('The requested API is not available')) ||
        (response.status === 403 && detail.includes('Databricks Sandboxes is not enabled'));

      if (isPreviewUnavailable && this.fallbackToPythonExec) {
        return this.pythonExecFallback.createSession(sessionId);
      }

      const notEnabledHint = isPreviewUnavailable
        ? ' — Enable the "Databricks Sandboxes" preview in Workspace Settings → Previews (or use SANDBOX_BACKEND=python_exec / e2b).'
        : '';
      throw new Error(
        `Databricks Sandbox create failed (${response.status}): ${detail || response.statusText}${notEnabledHint}`
      );
    }

    const payload = (await response.json().catch(() => ({}))) as { name?: string };
    return payload.name?.trim() || `sandboxes/${sandboxId}`;
  }

  async runCommand(externalId: string, cmd: string[], opts: RunCommandOptions): Promise<ExecutionResult> {
    if (this.isPythonExecSession(externalId)) {
      return this.pythonExecFallback.runCommand(externalId, cmd, opts);
    }
    const resourceName = toSandboxResourceName(externalId);
    const script = buildShellScript(cmd, opts.cwd);
    const timeoutSec = Math.max(1, Math.round(opts.timeoutSec || 120));
    const url = `${this.baseHost()}/api/2.0/sandbox-exec/${resourceName}/exec-sync`;

    const body: Record<string, unknown> = {
      cmd: '/bin/bash',
      args: ['-c', script],
      execution_timeout: `${timeoutSec}s`,
    };
    if (opts.env && Object.keys(opts.env).length > 0) {
      body.envs = opts.env;
    }

    const startedAt = Date.now();
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: await this.authHeaders(),
      body: JSON.stringify(body),
    });
    const elapsedMs = Math.max(0, Date.now() - startedAt);

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Databricks Sandbox exec failed (${response.status}): ${detail || response.statusText}`);
    }

    const payload = (await response.json()) as {
      stdout?: string;
      stderr?: string;
      exit_code?: number;
      duration_ms?: number;
      artifact_paths?: string[];
    };

    return {
      stdout: typeof payload.stdout === 'string' ? payload.stdout : '',
      stderr: typeof payload.stderr === 'string' ? payload.stderr : '',
      exitCode: typeof payload.exit_code === 'number' ? payload.exit_code : 0,
      durationMs: typeof payload.duration_ms === 'number' ? payload.duration_ms : elapsedMs,
      artifactPaths: Array.isArray(payload.artifact_paths)
        ? payload.artifact_paths.filter((p): p is string => typeof p === 'string')
        : [],
    };
  }

  async uploadFile(externalId: string, data: Uint8Array | string, dest: string): Promise<string> {
    if (this.isPythonExecSession(externalId)) {
      return this.pythonExecFallback.uploadFile(externalId, data, dest);
    }
    const targetPath = validateSandboxFilePath(dest, 'Destination');
    const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
    const encoded = bytes.toString('base64');
    const script = `mkdir -p "$(dirname -- ${shellQuote(targetPath)})" && printf '%s' ${shellQuote(encoded)} | base64 -d > ${shellQuote(targetPath)}`;

    const result = await this.runCommand(externalId, ['/bin/bash', '-c', script], {
      timeoutSec: 60,
    });
    if (result.exitCode !== 0) {
      throw new Error(
        `Databricks Sandbox upload failed (exit ${result.exitCode}): ${result.stderr || 'unable to write file'}`
      );
    }
    return targetPath;
  }

  async downloadFile(externalId: string, src: string): Promise<Uint8Array> {
    if (this.isPythonExecSession(externalId)) {
      return this.pythonExecFallback.downloadFile(externalId, src);
    }
    const sourcePath = validateSandboxFilePath(src, 'Source');
    const script = `base64 < ${shellQuote(sourcePath)} | tr -d '\\n\\r'`;
    const result = await this.runCommand(externalId, ['/bin/bash', '-c', script], {
      timeoutSec: 60,
    });
    if (result.exitCode !== 0) {
      throw new Error(
        `Databricks Sandbox download failed (exit ${result.exitCode}): ${result.stderr || 'unable to read file'}`
      );
    }
    return new Uint8Array(Buffer.from(result.stdout.trim(), 'base64'));
  }

  async stopSession(externalId: string): Promise<void> {
    if (this.isPythonExecSession(externalId)) {
      return this.pythonExecFallback.stopSession(externalId);
    }
    const resourceName = toSandboxResourceName(externalId);
    const url = `${this.baseHost()}/api/2.0/${resourceName}/stop`;
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: await this.authHeaders(),
      body: JSON.stringify({}),
    });
    if (!response.ok && response.status !== 404) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Databricks Sandbox stop failed (${response.status}): ${detail || response.statusText}`);
    }
  }

  async deleteSession(externalId: string): Promise<void> {
    if (this.isPythonExecSession(externalId)) {
      return this.pythonExecFallback.deleteSession(externalId);
    }
    const resourceName = toSandboxResourceName(externalId);
    const url = `${this.baseHost()}/api/2.0/${resourceName}`;
    const response = await this.fetchImpl(url, {
      method: 'DELETE',
      headers: await this.authHeaders(),
    });
    if (!response.ok && response.status !== 404) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Databricks Sandbox delete failed (${response.status}): ${detail || response.statusText}`);
    }
  }
}
