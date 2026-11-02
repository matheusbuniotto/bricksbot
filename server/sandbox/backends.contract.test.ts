import { describe, expect, test } from 'vitest';
import type { ExecutionBackend } from './backend.js';
import { DatabricksSandboxBackend } from './databricks-backend.js';
import { E2BSandboxBackend } from './e2b-backend.js';
import { SystemAiPythonBackend } from './python-exec-backend.js';

/**
 * Simulated in-memory filesystem + shell interpreter used by the mock HTTP transports
 * for both Databricks Sandbox and E2B Cloud so the contract suite exercises real
 * base64 upload/download, cwd handling, and command execution on each backend.
 */
function createVirtualSandboxRunner() {
  const files = new Map<string, string>();
  const stopped = new Set<string>();
  const deleted = new Set<string>();

  function evalBash(script: string): { stdout: string; stderr: string; exitCode: number } {
    // Handle upload pattern: mkdir -p ... && printf '%s' '<b64>' | base64 -d > '<dest>'
    const uploadMatch = /printf '%s' '([^']*)' \| base64 -d > '([^']+)'/.exec(script);
    if (uploadMatch) {
      const b64 = uploadMatch[1] ?? '';
      const dest = uploadMatch[2] ?? '';
      files.set(dest, Buffer.from(b64, 'base64').toString('utf8'));
      return { stdout: '', stderr: '', exitCode: 0 };
    }

    // Handle download pattern: base64 < '<src>' | tr -d '\n\r'
    const downloadMatch = /base64 < '([^']+)'/.exec(script);
    if (downloadMatch) {
      const src = downloadMatch[1] ?? '';
      const content = files.get(src);
      if (content === undefined) {
        return { stdout: '', stderr: `No such file: ${src}`, exitCode: 1 };
      }
      return {
        stdout: Buffer.from(content, 'utf8').toString('base64'),
        stderr: '',
        exitCode: 0,
      };
    }

    if (script.includes('exit 42')) {
      return { stdout: '', stderr: 'boom', exitCode: 42 };
    }

    return { stdout: `executed:${script}\n`, stderr: '', exitCode: 0 };
  }

  return { files, stopped, deleted, evalBash };
}

function createDatabricksMockBackend() {
  const vm = createVirtualSandboxRunner();
  const requests: Array<{ url: string; method: string; body?: unknown }> = [];

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    requests.push({ url, method, body });

    if (method === 'POST' && url.includes('/api/2.0/sandboxes?sandbox_id=')) {
      const id = decodeURIComponent(url.split('sandbox_id=')[1] ?? 'test');
      return new Response(JSON.stringify({ name: `sandboxes/${id}` }), { status: 200 });
    }

    if (method === 'POST' && url.endsWith('/exec-sync')) {
      const args = (body?.args as string[] | undefined) ?? [];
      const script = args[1] ?? '';
      const res = vm.evalBash(script);
      return new Response(
        JSON.stringify({
          stdout: res.stdout,
          stderr: res.stderr,
          exit_code: res.exitCode,
          duration_ms: 15,
        }),
        { status: 200 }
      );
    }

    if (method === 'POST' && url.endsWith('/stop')) {
      vm.stopped.add(url);
      return new Response(JSON.stringify({}), { status: 200 });
    }

    if (method === 'DELETE' && url.includes('/api/2.0/sandboxes/')) {
      vm.deleted.add(url);
      return new Response(JSON.stringify({}), { status: 200 });
    }

    return new Response('Not found', { status: 404 });
  };

  const backend = new DatabricksSandboxBackend({
    host: 'https://adb-mock.azuredatabricks.net',
    getToken: async () => 'dapi-mock-token',
    inactivityTimeoutSec: 900,
    fetchImpl,
  });

  return { backend, requests, vm };
}

function createE2BMockBackend() {
  const vm = createVirtualSandboxRunner();
  const requests: Array<{ url: string; method: string; body?: unknown }> = [];

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    requests.push({ url, method, body });

    if (method === 'POST' && url === 'https://api.e2b.dev/sandboxes') {
      return new Response(JSON.stringify({ sandboxID: 'sbx-e2b-123' }), { status: 201 });
    }

    if (method === 'POST' && url.endsWith('/commands')) {
      const args = (body?.args as string[] | undefined) ?? [];
      const script = args[1] ?? '';
      const res = vm.evalBash(script);
      return new Response(
        JSON.stringify({
          stdout: res.stdout,
          stderr: res.stderr,
          exitCode: res.exitCode,
          durationMs: 18,
        }),
        { status: 200 }
      );
    }

    if (method === 'POST' && url.endsWith('/pause')) {
      vm.stopped.add(url);
      return new Response(JSON.stringify({}), { status: 200 });
    }

    if (method === 'DELETE' && url.includes('/sandboxes/')) {
      vm.deleted.add(url);
      return new Response(null, { status: 204 });
    }

    return new Response('Not found', { status: 404 });
  };

  const backend = new E2BSandboxBackend({
    apiKey: 'e2b_mock_key_1234567890',
    fetchImpl,
  });

  return { backend, requests, vm };
}

function createPythonExecMockBackend() {
  const vm = createVirtualSandboxRunner();

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;

    if (method === 'POST' && url.includes('/api/2.0/sandboxes?sandbox_id=')) {
      return new Response(
        JSON.stringify({
          error_code: 'NOT_FOUND',
          message: 'The requested API is not available',
        }),
        { status: 404 }
      );
    }

    if (method === 'POST' && url.endsWith('/api/2.0/mcp/functions/system/ai/python_exec')) {
      const params = (body?.params as { arguments?: { code?: string } } | undefined) ?? {};
      const code = params.arguments?.code ?? '';
      // Extract JSON payload inside `json.loads("...")`
      const match = /_cfg = json\.loads\(("(?:\\.|[^"\\])*")\)/.exec(code);
      const cfgJson = match ? (JSON.parse(match[1]) as string) : '{}';
      const cfg = JSON.parse(cfgJson) as {
        script?: string;
        cwd?: string;
        files?: Record<string, string>;
      };
      const script = cfg.script ?? '';
      const res = vm.evalBash(script);
      const envelope = JSON.stringify({
        stdout: `${res.stdout}cwd:${cfg.cwd ?? ''}\n`,
        stderr: res.stderr,
        exit_code: res.exitCode,
        files: cfg.files ?? {},
      });
      return new Response(
        JSON.stringify({
          id: 1,
          jsonrpc: '2.0',
          result: {
            isError: false,
            structuredContent: {
              columns: ['output'],
              rows: [[`${envelope}\n`]],
            },
          },
        }),
        { status: 200 }
      );
    }

    return new Response('Not found', { status: 404 });
  };

  const pythonBackend = new SystemAiPythonBackend({
    host: 'https://adb-mock.azuredatabricks.net',
    getToken: async () => 'dapi-mock-token',
    fetchImpl,
  });

  const fallbackDatabricksBackend = new DatabricksSandboxBackend({
    host: 'https://adb-mock.azuredatabricks.net',
    getToken: async () => 'dapi-mock-token',
    fetchImpl,
  });

  return { pythonBackend, fallbackDatabricksBackend };
}

describe.each([
  ['DatabricksSandboxBackend', () => createDatabricksMockBackend().backend as ExecutionBackend],
  ['SystemAiPythonBackend', () => createPythonExecMockBackend().pythonBackend as ExecutionBackend],
  [
    'DatabricksSandboxBackend (404 fallback → system.ai.python_exec)',
    () => createPythonExecMockBackend().fallbackDatabricksBackend as ExecutionBackend,
  ],
  ['E2BSandboxBackend', () => createE2BMockBackend().backend as ExecutionBackend],
])('ExecutionBackend contract suite: %s', (_name, makeBackend) => {
  test('createSession → runCommand → uploadFile → downloadFile → stopSession → deleteSession', async () => {
    const backend = makeBackend();
    const externalId = await backend.createSession('chat-abc-123');
    expect(externalId).toBeTruthy();

    const cmdRes = await backend.runCommand(externalId, ['echo hello'], {
      cwd: '/home/sandbox-agent',
      timeoutSec: 30,
      env: { SAFE_ENV: '1' },
    });
    expect(cmdRes.exitCode).toBe(0);
    expect(cmdRes.stdout).toContain('echo hello');

    const failRes = await backend.runCommand(externalId, ['exit 42'], { timeoutSec: 10 });
    expect(failRes.exitCode).toBe(42);
    expect(failRes.stderr).toBe('boom');

    const uploadedPath = await backend.uploadFile(
      externalId,
      'id,name\n1,alice\n2,bob\n',
      '/home/sandbox-agent/users.csv'
    );
    expect(uploadedPath).toBe('/home/sandbox-agent/users.csv');

    const downloadedBytes = await backend.downloadFile(externalId, '/home/sandbox-agent/users.csv');
    expect(Buffer.from(downloadedBytes).toString('utf8')).toBe('id,name\n1,alice\n2,bob\n');

    await expect(backend.downloadFile(externalId, '/home/sandbox-agent/missing.csv')).rejects.toThrow(
      /download failed/i
    );

    await backend.stopSession(externalId);
    await backend.deleteSession(externalId);
  });
});

const runLiveDatabricks = Boolean(
  process.env.DATABRICKS_SANDBOX_INTEGRATION_TEST && process.env.DATABRICKS_HOST && process.env.DATABRICKS_TOKEN
);

describe.skipIf(!runLiveDatabricks)('DatabricksSandboxBackend live workspace integration', () => {
  test('echo hello, write/read file, and delete sandbox', async () => {
    const backend = new DatabricksSandboxBackend({
      host: process.env.DATABRICKS_HOST!,
      getToken: async () => process.env.DATABRICKS_TOKEN!,
    });
    const ext = await backend.createSession(`it-${Date.now()}`);
    try {
      const exec = await backend.runCommand(ext, ['echo hello'], { timeoutSec: 60 });
      expect(exec.exitCode).toBe(0);
      expect(exec.stdout.trim()).toBe('hello');

      await backend.uploadFile(ext, 'hello-sandbox', '/home/sandbox-agent/it.txt');
      const readBack = await backend.downloadFile(ext, '/home/sandbox-agent/it.txt');
      expect(Buffer.from(readBack).toString('utf8')).toBe('hello-sandbox');
    } finally {
      await backend.deleteSession(ext);
    }
  });
});
