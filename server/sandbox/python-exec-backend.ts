import * as path from 'node:path';
import type { ExecutionResult } from '../../shared/sandbox/types.js';
import type { ExecutionBackend, RunCommandOptions } from './backend.js';
import {
  buildShellScript,
  formatDatabricksSandboxId,
  validateSandboxFilePath,
} from './databricks-backend.js';

export interface SystemAiPythonConfig {
  host: string;
  getToken: () => Promise<string>;
  fetchImpl?: typeof fetch;
}

const VIRTUAL_HOME = '/tmp/bricksbot-home';
const SANDBOX_AGENT_HOME = '/home/sandbox-agent';
const MAX_SYNCED_FILE_BYTES = 2 * 1024 * 1024; // 2 MB cap per file for stateless sync

export function normalizeVirtualRelPath(rawPath: string): string {
  const cleaned = rawPath.trim().replace(/\\/g, '/');
  let rel = cleaned;
  if (rel.startsWith(`${SANDBOX_AGENT_HOME}/`)) {
    rel = rel.slice(SANDBOX_AGENT_HOME.length + 1);
  } else if (rel === SANDBOX_AGENT_HOME) {
    rel = '';
  } else if (rel.startsWith(`${VIRTUAL_HOME}/`)) {
    rel = rel.slice(VIRTUAL_HOME.length + 1);
  } else if (rel === VIRTUAL_HOME) {
    rel = '';
  } else if (rel.startsWith('/tmp/')) {
    rel = rel.slice('/tmp/'.length);
  } else if (rel.startsWith('./')) {
    rel = rel.slice(2);
  } else if (rel.startsWith('/')) {
    rel = rel.slice(1);
  }

  const normalized = path.posix.normalize(rel);
  if (!normalized || normalized === '.' || normalized.startsWith('..')) {
    throw new Error(`Invalid sandbox file path: ${rawPath}`);
  }
  return normalized;
}

export function rewriteHomePaths(input: string): string {
  return input.replace(/\/home\/sandbox-agent\b/g, VIRTUAL_HOME);
}

/**
 * Build a self-contained Python snippet executed by `system.ai.python_exec`
 * that materializes session files in `/tmp/bricksbot-home`, runs `/bin/bash -c`,
 * and prints a JSON envelope with stdout, stderr, exit_code, and updated files.
 */
export function buildPythonExecHarness(
  script: string,
  filesB64: Record<string, string>,
  opts: { cwd?: string; timeoutSec: number; env?: Record<string, string> },
): string {
  const payload = JSON.stringify({
    script: rewriteHomePaths(script),
    cwd: opts.cwd ? rewriteHomePaths(opts.cwd) : VIRTUAL_HOME,
    timeoutSec: Math.max(1, Math.min(Math.round(opts.timeoutSec || 60), 120)),
    env: opts.env ?? {},
    files: filesB64,
    maxFileBytes: MAX_SYNCED_FILE_BYTES,
  });

  // Note: `system.ai.python_exec` executes `exec(code, {})` where comprehensions/functions
  // have no enclosing globals unless imported inside or kept at top-level.
  return [
    'import base64, json, os, shutil, subprocess',
    `_cfg = json.loads(${JSON.stringify(payload)})`,
    `_home = ${JSON.stringify(VIRTUAL_HOME)}`,
    'shutil.rmtree(_home, ignore_errors=True)',
    'os.makedirs(_home, exist_ok=True)',
    'for _rel, _b64 in _cfg["files"].items():',
    '    _full = os.path.join(_home, _rel)',
    '    os.makedirs(os.path.dirname(_full), exist_ok=True)',
    '    with open(_full, "wb") as _f:',
    '        _f.write(base64.b64decode(_b64))',
    '_cwd = _cfg["cwd"] or _home',
    'os.makedirs(_cwd, exist_ok=True)',
    '_env = dict(os.environ)',
    '_env["HOME"] = _home',
    'for _k, _v in _cfg["env"].items():',
    '    _env[str(_k)] = str(_v)',
    'try:',
    '    _proc = subprocess.run(["/bin/bash", "-c", _cfg["script"]], cwd=_cwd, env=_env, capture_output=True, text=True, timeout=_cfg["timeoutSec"])',
    '    _stdout = _proc.stdout',
    '    _stderr = _proc.stderr',
    '    _code = _proc.returncode',
    'except subprocess.TimeoutExpired as _te:',
    '    _stdout = (_te.stdout.decode("utf-8", "replace") if isinstance(_te.stdout, bytes) else (_te.stdout or ""))',
    '    _stderr = "Command timed out after " + str(_cfg["timeoutSec"]) + "s"',
    '    _code = 124',
    '_out_files = {}',
    'for _root, _dirs, _names in os.walk(_home):',
    '    for _n in _names:',
    '        _p = os.path.join(_root, _n)',
    '        _r = os.path.relpath(_p, _home).replace("\\\\", "/")',
    '        try:',
    '            if os.path.isfile(_p) and os.path.getsize(_p) <= _cfg["maxFileBytes"]:',
    '                with open(_p, "rb") as _rf:',
    '                    _out_files[_r] = base64.b64encode(_rf.read()).decode("ascii")',
    '        except OSError:',
    '            pass',
    'print(json.dumps({"stdout": _stdout, "stderr": _stderr, "exit_code": _code, "files": _out_files}))',
  ].join('\n');
}

interface McpToolCallResponse {
  error?: { message?: string };
  result?: {
    isError?: boolean;
    content?: Array<{ type?: string; text?: string }>;
    structuredContent?: {
      columns?: string[];
      rows?: unknown[][];
    };
  };
}

export function extractMcpPythonExecOutput(payload: McpToolCallResponse): string {
  if (payload.error?.message) {
    throw new Error(`system.ai.python_exec RPC error: ${payload.error.message}`);
  }
  const result = payload.result;
  if (!result) {
    throw new Error('system.ai.python_exec returned empty result');
  }

  const structuredRow = result.structuredContent?.rows?.[0]?.[0];
  if (typeof structuredRow === 'string') {
    if (result.isError) {
      throw new Error(`system.ai.python_exec error: ${structuredRow}`);
    }
    return structuredRow;
  }

  const firstText = result.content?.[0]?.text ?? '';
  if (result.isError) {
    throw new Error(`system.ai.python_exec error: ${firstText || 'execution failed'}`);
  }
  if (!firstText) return '';

  try {
    const parsed = JSON.parse(firstText) as { rows?: unknown[][] };
    const cell = parsed.rows?.[0]?.[0];
    if (typeof cell === 'string') return cell;
  } catch {
    // Plain text fallback
  }
  return firstText;
}

/**
 * ExecutionBackend backed by Unity Catalog `system.ai.python_exec`
 * (`/api/2.0/mcp/functions/system/ai/python_exec`).
 * Works on any Unity Catalog workspace without requiring the MicroVM Sandboxes preview.
 */
export class SystemAiPythonBackend implements ExecutionBackend {
  private readonly fetchImpl: typeof fetch;
  private readonly sessionFiles = new Map<string, Map<string, string>>();

  constructor(private readonly config: SystemAiPythonConfig) {
    if (!config.host?.trim()) {
      throw new Error('SystemAiPythonBackend requires host');
    }
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
  }

  private baseHost(): string {
    const trimmed = this.config.host.trim().replace(/\/+$/, '');
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  }

  private ensureFileMap(externalId: string): Map<string, string> {
    let map = this.sessionFiles.get(externalId);
    if (!map) {
      map = new Map<string, string>();
      this.sessionFiles.set(externalId, map);
    }
    return map;
  }

  async createSession(sessionId: string): Promise<string> {
    const sandboxId = formatDatabricksSandboxId(sessionId);
    const externalId = `python-exec/${sandboxId}`;
    this.ensureFileMap(externalId);
    return externalId;
  }

  async runCommand(
    externalId: string,
    cmd: string[],
    opts: RunCommandOptions,
  ): Promise<ExecutionResult> {
    if (!externalId?.trim()) {
      throw new Error('Sandbox identifier is required');
    }
    const script = buildShellScript(cmd, undefined);
    const fileMap = this.ensureFileMap(externalId);
    const filesObj = Object.fromEntries(fileMap.entries());
    const harnessCode = buildPythonExecHarness(script, filesObj, opts);

    const token = await this.config.getToken();
    const url = `${this.baseHost()}/api/2.0/mcp/functions/system/ai/python_exec`;

    const startedAt = Date.now();
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'system__ai__python_exec',
          arguments: {
            code: harnessCode,
          },
        },
      }),
    });
    const elapsedMs = Math.max(0, Date.now() - startedAt);

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(
        `system.ai.python_exec failed (${response.status}): ${detail || response.statusText}`,
      );
    }

    const rpcPayload = (await response.json()) as McpToolCallResponse;
    const rawOutput = extractMcpPythonExecOutput(rpcPayload).trim();

    // Parse the last line as our JSON envelope from buildPythonExecHarness
    const lines = rawOutput.split(/\r?\n/).filter(Boolean);
    const lastLine = lines[lines.length - 1] ?? rawOutput;
    try {
      const envelope = JSON.parse(lastLine) as {
        stdout?: string;
        stderr?: string;
        exit_code?: number;
        files?: Record<string, string>;
      };

      const nextFiles = new Map<string, string>();
      const artifactPaths: string[] = [];
      for (const [rel, b64] of Object.entries(envelope.files ?? {})) {
        if (typeof b64 === 'string') {
          nextFiles.set(rel, b64);
          artifactPaths.push(`${SANDBOX_AGENT_HOME}/${rel}`);
        }
      }
      this.sessionFiles.set(externalId, nextFiles);

      return {
        stdout: typeof envelope.stdout === 'string' ? envelope.stdout : '',
        stderr: typeof envelope.stderr === 'string' ? envelope.stderr : '',
        exitCode: typeof envelope.exit_code === 'number' ? envelope.exit_code : 0,
        durationMs: elapsedMs,
        artifactPaths,
      };
    } catch {
      return {
        stdout: rawOutput ? `${rawOutput}\n` : '',
        stderr: '',
        exitCode: 0,
        durationMs: elapsedMs,
        artifactPaths: [],
      };
    }
  }

  async uploadFile(
    externalId: string,
    data: Uint8Array | string,
    dest: string,
  ): Promise<string> {
    const validated = validateSandboxFilePath(dest, 'Destination');
    const rel = normalizeVirtualRelPath(validated);
    const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
    const fileMap = this.ensureFileMap(externalId);
    fileMap.set(rel, bytes.toString('base64'));
    return `${SANDBOX_AGENT_HOME}/${rel}`;
  }

  async downloadFile(externalId: string, src: string): Promise<Uint8Array> {
    const validated = validateSandboxFilePath(src, 'Source');
    const rel = normalizeVirtualRelPath(validated);
    const fileMap = this.ensureFileMap(externalId);
    const b64 = fileMap.get(rel);
    if (b64 === undefined) {
      throw new Error(`system.ai.python_exec download failed: file not found (${src})`);
    }
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }

  async stopSession(_externalId: string): Promise<void> {
    // Stateless compute; keep virtual files in memory until deleted.
  }

  async deleteSession(externalId: string): Promise<void> {
    this.sessionFiles.delete(externalId);
  }
}
