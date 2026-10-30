import type { BackendId, SandboxBackendSetting } from '../../shared/sandbox/types.js';
import type { ExecutionBackend } from './backend.js';
import { DatabricksSandboxBackend } from './databricks-backend.js';
import { E2BSandboxBackend } from './e2b-backend.js';
import { SystemAiPythonBackend } from './python-exec-backend.js';

export interface SandboxConfig {
  backend: SandboxBackendSetting;
  idleMinutes: number;
  execTimeoutSec: number;
  /** Hard cap on session lifetime from create (cost control). Default 120. */
  maxSessionMinutes: number;
  maxActivePerUser: number;
  /**
   * Reserved for backends that support per-sandbox egress allowlists.
   * Not enforced today — use workspace Serverless Egress Control / E2B account policy.
   */
  egressAllowlist: string[];
  artifactVolumeRoot?: string;
  secretsToRedact: string[];
}

function presentEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === '__UNSET__') return undefined;
  return trimmed;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const clean = presentEnv(raw);
  if (!clean) return fallback;
  const parsed = Number.parseInt(clean, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export function parseSandboxBackendSetting(raw: string | undefined): SandboxBackendSetting {
  const clean = presentEnv(raw)?.toLowerCase();
  if (!clean || clean === 'off' || clean === 'false' || clean === '0' || clean === 'none') {
    return 'off';
  }
  if (clean === 'databricks' || clean === 'python_exec' || clean === 'e2b') {
    return clean;
  }
  throw new Error(
    `Invalid SANDBOX_BACKEND="${raw}": expected "off", "databricks", "python_exec", or "e2b"`,
  );
}

export function resolveSandboxConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): SandboxConfig {
  const backend = parseSandboxBackendSetting(env.SANDBOX_BACKEND);
  const idleMinutes = parsePositiveInt(env.SANDBOX_IDLE_MINUTES, 15);
  const execTimeoutSec = parsePositiveInt(env.SANDBOX_EXEC_TIMEOUT_SEC, 120);
  const maxSessionMinutes = parsePositiveInt(env.SANDBOX_MAX_SESSION_MINUTES, 120);
  const maxActivePerUser = parsePositiveInt(env.SANDBOX_MAX_ACTIVE_PER_USER, 3);
  const egressAllowlist = (presentEnv(env.SANDBOX_EGRESS_ALLOWLIST) ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  const artifactVolumeRoot = presentEnv(env.SANDBOX_ARTIFACT_VOLUME_PATH);

  const secretsToRedact = [
    presentEnv(env.DATABRICKS_TOKEN),
    presentEnv(env.DATABRICKS_CLIENT_SECRET),
    presentEnv(env.E2B_API_KEY),
    presentEnv(env.OPENROUTER_API_KEY),
    presentEnv(env.LLM_API_KEY),
  ].filter((val): val is string => Boolean(val));

  return {
    backend,
    idleMinutes,
    execTimeoutSec,
    maxSessionMinutes,
    maxActivePerUser,
    egressAllowlist,
    artifactVolumeRoot,
    secretsToRedact,
  };
}

export class SandboxRegistry {
  private readonly backends = new Map<BackendId, ExecutionBackend>();

  constructor(
    private readonly activeBackend: SandboxBackendSetting = 'off',
    initialBackends?: Partial<Record<BackendId, ExecutionBackend>>,
  ) {
    if (
      activeBackend !== 'off' &&
      activeBackend !== 'databricks' &&
      activeBackend !== 'python_exec' &&
      activeBackend !== 'e2b'
    ) {
      throw new Error(`Unknown sandbox backend setting: ${String(activeBackend)}`);
    }
    if (initialBackends?.databricks) {
      this.backends.set('databricks', initialBackends.databricks);
    }
    if (initialBackends?.python_exec) {
      this.backends.set('python_exec', initialBackends.python_exec);
    }
    if (initialBackends?.e2b) {
      this.backends.set('e2b', initialBackends.e2b);
    }
  }

  getSetting(): SandboxBackendSetting {
    return this.activeBackend;
  }

  isEnabled(): boolean {
    return this.activeBackend !== 'off';
  }

  getDefaultBackendId(): BackendId {
    if (this.activeBackend === 'off') {
      throw new Error('Sandbox execution is disabled (SANDBOX_BACKEND=off)');
    }
    return this.activeBackend;
  }

  register(id: BackendId, backend: ExecutionBackend): void {
    this.backends.set(id, backend);
  }

  getBackend(requested?: BackendId): ExecutionBackend {
    if (this.activeBackend === 'off') {
      throw new Error('Sandbox execution is disabled (SANDBOX_BACKEND=off)');
    }
    const target = requested ?? this.activeBackend;
    if (target !== 'databricks' && target !== 'python_exec' && target !== 'e2b') {
      throw new Error(`Unknown sandbox backend: ${String(target)}`);
    }
    const impl = this.backends.get(target);
    if (!impl) {
      throw new Error(`Sandbox backend "${target}" is not registered or configured`);
    }
    return impl;
  }
}

function normalizeHostUrl(rawHost: string): string {
  const trimmed = rawHost.trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function createM2mTokenProvider(
  host: string,
  clientId: string,
  clientSecret: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): () => Promise<string> {
  let cached: { token: string; expiresAtMs: number } | null = null;
  const baseUrl = normalizeHostUrl(host);

  return async () => {
    if (cached && Date.now() < cached.expiresAtMs - 60_000) {
      return cached.token;
    }
    const basic = Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64');
    const res = await fetchImpl(`${baseUrl}/oidc/v1/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials&scope=all-apis',
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Databricks OAuth token request failed (${res.status}): ${detail || res.statusText}`);
    }
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) {
      throw new Error('Databricks OAuth token response missing access_token');
    }
    const ttlSec = typeof data.expires_in === 'number' ? data.expires_in : 3600;
    cached = {
      token: data.access_token,
      expiresAtMs: Date.now() + ttlSec * 1000,
    };
    return cached.token;
  };
}

export function createSandboxRegistryFromEnv(
  env: Record<string, string | undefined> = process.env,
  options?: {
    fetchImpl?: typeof fetch;
    getDatabricksToken?: () => Promise<string>;
  },
): { config: SandboxConfig; registry: SandboxRegistry } {
  const config = resolveSandboxConfigFromEnv(env);
  const registry = new SandboxRegistry(config.backend);

  if (config.backend === 'off') {
    return { config, registry };
  }

  const host = presentEnv(env.DATABRICKS_HOST) ?? presentEnv(env.DATABRICKS_WORKSPACE_URL);
  const staticToken = presentEnv(env.DATABRICKS_TOKEN);
  const clientId = presentEnv(env.DATABRICKS_CLIENT_ID);
  const clientSecret = presentEnv(env.DATABRICKS_CLIENT_SECRET);
  const getToken =
    options?.getDatabricksToken ??
    (staticToken
      ? () => Promise.resolve(staticToken)
      : host && clientId && clientSecret
        ? createM2mTokenProvider(host, clientId, clientSecret, options?.fetchImpl)
        : undefined);

  if (host && getToken) {
    registry.register(
      'databricks',
      new DatabricksSandboxBackend({
        host,
        getToken,
        inactivityTimeoutSec: config.idleMinutes * 60,
        imageUri: presentEnv(env.SANDBOX_DATABRICKS_IMAGE_URI),
        fetchImpl: options?.fetchImpl,
      }),
    );
    registry.register(
      'python_exec',
      new SystemAiPythonBackend({
        host,
        getToken,
        fetchImpl: options?.fetchImpl,
      }),
    );
  }

  const e2bApiKey = presentEnv(env.E2B_API_KEY);
  if (e2bApiKey) {
    registry.register(
      'e2b',
      new E2BSandboxBackend({
        apiKey: e2bApiKey,
        domain: presentEnv(env.E2B_DOMAIN),
        templateId: presentEnv(env.E2B_TEMPLATE_ID),
        timeoutSec: config.idleMinutes * 60,
        fetchImpl: options?.fetchImpl,
      }),
    );
  }

  return { config, registry };
}
