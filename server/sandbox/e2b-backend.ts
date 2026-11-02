import type { ExecutionResult } from '../../shared/sandbox/types.js';
import type { ExecutionBackend, RunCommandOptions } from './backend.js';
import { buildShellScript, shellQuote, validateSandboxFilePath } from './databricks-backend.js';

export interface E2BSandboxConfig {
  apiKey: string;
  domain?: string;
  templateId?: string;
  timeoutSec?: number;
  fetchImpl?: typeof fetch;
}

/**
 * E2B Cloud execution backend (`api.e2b.dev` or custom `E2B_DOMAIN`).
 */
export class E2BSandboxBackend implements ExecutionBackend {
  private readonly fetchImpl: typeof fetch;
  private readonly domain: string;
  private readonly templateId: string;
  private readonly timeoutSec: number;

  constructor(private readonly config: E2BSandboxConfig) {
    if (!config.apiKey?.trim()) {
      throw new Error('E2BSandboxBackend requires E2B_API_KEY');
    }
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
    this.domain = (config.domain?.trim() || 'e2b.dev').replace(/^https?:\/\//, '').replace(/\/+$/, '');
    this.templateId = config.templateId?.trim() || 'base';
    this.timeoutSec = config.timeoutSec ?? 900;
  }

  private apiBaseUrl(): string {
    return this.domain.startsWith('api.') ? `https://${this.domain}` : `https://api.${this.domain}`;
  }

  private headers(): Record<string, string> {
    return {
      'X-API-Key': this.config.apiKey.trim(),
      'Content-Type': 'application/json',
    };
  }

  async createSession(sessionId: string): Promise<string> {
    const response = await this.fetchImpl(`${this.apiBaseUrl()}/sandboxes`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        templateID: this.templateId,
        timeout: Math.max(60, Math.round(this.timeoutSec)),
        metadata: {
          sessionId: `bricksbot-${sessionId}`,
        },
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`E2B sandbox create failed (${response.status}): ${detail || response.statusText}`);
    }

    const payload = (await response.json()) as {
      sandboxID?: string;
      sandboxId?: string;
      clientID?: string;
    };
    const id = payload.sandboxID ?? payload.sandboxId;
    if (!id?.trim()) {
      throw new Error('E2B sandbox create response missing sandboxID');
    }
    return payload.clientID ? `${id}-${payload.clientID}` : id;
  }

  async runCommand(externalId: string, cmd: string[], opts: RunCommandOptions): Promise<ExecutionResult> {
    if (!externalId?.trim()) {
      throw new Error('Sandbox identifier is required');
    }
    const script = buildShellScript(cmd, opts.cwd);
    const timeoutSec = Math.max(1, Math.round(opts.timeoutSec || 120));
    const url = `${this.apiBaseUrl()}/sandboxes/${encodeURIComponent(externalId.trim())}/commands`;

    const startedAt = Date.now();
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        cmd: '/bin/bash',
        args: ['-c', script],
        envs: opts.env ?? {},
        timeout: timeoutSec,
      }),
    });
    const elapsedMs = Math.max(0, Date.now() - startedAt);

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`E2B sandbox command failed (${response.status}): ${detail || response.statusText}`);
    }

    const payload = (await response.json()) as {
      stdout?: string;
      stderr?: string;
      exitCode?: number;
      exit_code?: number;
      durationMs?: number;
      duration_ms?: number;
      artifactPaths?: string[];
      artifact_paths?: string[];
    };

    const exitCode =
      typeof payload.exitCode === 'number'
        ? payload.exitCode
        : typeof payload.exit_code === 'number'
          ? payload.exit_code
          : 0;
    const durationMs =
      typeof payload.durationMs === 'number'
        ? payload.durationMs
        : typeof payload.duration_ms === 'number'
          ? payload.duration_ms
          : elapsedMs;
    const artifacts = payload.artifactPaths ?? payload.artifact_paths ?? [];

    return {
      stdout: typeof payload.stdout === 'string' ? payload.stdout : '',
      stderr: typeof payload.stderr === 'string' ? payload.stderr : '',
      exitCode,
      durationMs,
      artifactPaths: Array.isArray(artifacts) ? artifacts.filter((p): p is string => typeof p === 'string') : [],
    };
  }

  async uploadFile(externalId: string, data: Uint8Array | string, dest: string): Promise<string> {
    const targetPath = validateSandboxFilePath(dest, 'Destination');
    const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
    const encoded = bytes.toString('base64');
    const script = `mkdir -p "$(dirname -- ${shellQuote(targetPath)})" && printf '%s' ${shellQuote(encoded)} | base64 -d > ${shellQuote(targetPath)}`;

    const result = await this.runCommand(externalId, ['/bin/bash', '-c', script], {
      timeoutSec: 60,
    });
    if (result.exitCode !== 0) {
      throw new Error(
        `E2B sandbox upload failed (exit ${result.exitCode}): ${result.stderr || 'unable to write file'}`
      );
    }
    return targetPath;
  }

  async downloadFile(externalId: string, src: string): Promise<Uint8Array> {
    const sourcePath = validateSandboxFilePath(src, 'Source');
    const script = `base64 < ${shellQuote(sourcePath)} | tr -d '\\n\\r'`;
    const result = await this.runCommand(externalId, ['/bin/bash', '-c', script], {
      timeoutSec: 60,
    });
    if (result.exitCode !== 0) {
      throw new Error(
        `E2B sandbox download failed (exit ${result.exitCode}): ${result.stderr || 'unable to read file'}`
      );
    }
    return new Uint8Array(Buffer.from(result.stdout.trim(), 'base64'));
  }

  async stopSession(externalId: string): Promise<void> {
    if (!externalId?.trim()) {
      throw new Error('Sandbox identifier is required');
    }
    const url = `${this.apiBaseUrl()}/sandboxes/${encodeURIComponent(externalId.trim())}/pause`;
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: this.headers(),
    });
    if (!response.ok && response.status !== 404) {
      const detail = await response.text().catch(() => '');
      throw new Error(`E2B sandbox stop failed (${response.status}): ${detail || response.statusText}`);
    }
  }

  async deleteSession(externalId: string): Promise<void> {
    if (!externalId?.trim()) {
      throw new Error('Sandbox identifier is required');
    }
    const url = `${this.apiBaseUrl()}/sandboxes/${encodeURIComponent(externalId.trim())}`;
    const response = await this.fetchImpl(url, {
      method: 'DELETE',
      headers: this.headers(),
    });
    if (!response.ok && response.status !== 404) {
      const detail = await response.text().catch(() => '');
      throw new Error(`E2B sandbox delete failed (${response.status}): ${detail || response.statusText}`);
    }
  }
}
