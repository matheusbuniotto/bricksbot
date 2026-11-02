import { describe, expect, test } from 'vitest';
import type { SandboxStore } from '../../shared/sandbox/types.js';
import type { LakebaseQuery } from '../chat/lakebase-store.js';
import type { ExecutionBackend } from './backend.js';
import { LakebaseSandboxStore } from './lakebase-store.js';
import { MemorySandboxStore } from './memory-store.js';
import { SandboxReaper } from './reaper.js';
import { redactSecrets, safeArtifactName, sanitizeEventPayload, stripSandboxPaths, truncatePreview } from './redact.js';
import {
  createSandboxRegistryFromEnv,
  parseSandboxBackendSetting,
  resolveSandboxConfigFromEnv,
  SandboxRegistry,
} from './registry.js';
import { SandboxSessionService, sanitizeSandboxEnv } from './session-service.js';

function createFakeBackend(): ExecutionBackend & {
  created: string[];
  stopped: string[];
  deleted: string[];
} {
  const created: string[] = [];
  const stopped: string[] = [];
  const deleted: string[] = [];
  return {
    created,
    stopped,
    deleted,
    async createSession(sessionId) {
      const ext = `sandboxes/bricksbot-${sessionId}`;
      created.push(ext);
      return ext;
    },
    async runCommand(_ext, cmd) {
      return {
        stdout: `ran:${cmd.join(' ')}`,
        stderr: '',
        exitCode: 0,
        durationMs: 12,
        artifactPaths: [],
      };
    },
    async uploadFile(_ext, _data, dest) {
      return dest;
    },
    async downloadFile() {
      return new Uint8Array(Buffer.from('col1,col2\n1,2\n', 'utf8'));
    },
    async stopSession(ext) {
      stopped.push(ext);
    },
    async deleteSession(ext) {
      deleted.push(ext);
    },
  };
}

function createFakeLakebaseSandboxQuery(): LakebaseQuery {
  type Row = Record<string, unknown>;
  const sessions = new Map<string, Row>();
  const events: Row[] = [];
  let seq = 0;

  return async (sql, params = []) => {
    const normalized = sql.replace(/\s+/g, ' ').trim();

    if (normalized.startsWith('INSERT INTO bricksbot.sandbox_sessions')) {
      const [id, chat_id, bot_id, user_id, backend, external_id, status, metadata] = params;
      const now = new Date(Date.now() + seq++).toISOString();
      const row: Row = {
        id: String(id),
        chat_id: String(chat_id),
        bot_id: String(bot_id),
        user_id: String(user_id),
        backend: String(backend),
        external_id: String(external_id),
        status: String(status),
        created_at: now,
        last_used_at: now,
        stopped_at: null,
        metadata: JSON.parse(String(metadata ?? '{}')) as Record<string, unknown>,
      };
      sessions.set(row.id as string, row);
      return { rows: [row] };
    }

    if (normalized.includes('FROM bricksbot.sandbox_sessions WHERE id = $1')) {
      const found = sessions.get(String(params[0]));
      return { rows: found ? [found] : [] };
    }

    if (normalized.includes('FROM bricksbot.sandbox_sessions WHERE chat_id = $1 AND status IN')) {
      const chatId = String(params[0]);
      const active = [...sessions.values()]
        .filter((s) => s.chat_id === chatId && ['creating', 'ready', 'running'].includes(String(s.status)))
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      return { rows: active[0] ? [active[0]] : [] };
    }

    if (normalized.includes('FROM bricksbot.sandbox_sessions WHERE chat_id = $1 ORDER BY')) {
      const chatId = String(params[0]);
      const matching = [...sessions.values()]
        .filter((s) => s.chat_id === chatId)
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      return { rows: matching[0] ? [matching[0]] : [] };
    }

    if (normalized.includes('FROM bricksbot.sandbox_sessions WHERE user_id = $1')) {
      const userId = String(params[0]);
      const active = [...sessions.values()]
        .filter((s) => s.user_id === userId && ['creating', 'ready', 'running'].includes(String(s.status)))
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      return { rows: active };
    }

    if (normalized.includes('FROM bricksbot.sandbox_sessions WHERE status IN')) {
      const active = [...sessions.values()]
        .filter((s) => ['creating', 'ready', 'running'].includes(String(s.status)))
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      return { rows: active };
    }

    if (normalized.startsWith('UPDATE bricksbot.sandbox_sessions SET status = $2')) {
      const [id, status, backend, external_id, last_used_at, stopped_at, metadata] = params;
      const existing = sessions.get(String(id));
      if (!existing) return { rows: [] };
      existing.status = String(status);
      existing.backend = String(backend);
      existing.external_id = String(external_id);
      existing.last_used_at = String(last_used_at);
      existing.stopped_at = stopped_at === null ? null : String(stopped_at);
      existing.metadata = JSON.parse(String(metadata ?? '{}')) as Record<string, unknown>;
      return { rows: [existing] };
    }

    if (normalized.startsWith('UPDATE bricksbot.sandbox_sessions SET last_used_at =')) {
      const [id, last_used_at] = params;
      const existing = sessions.get(String(id));
      if (!existing) return { rows: [] };
      existing.last_used_at = String(last_used_at);
      return { rows: [existing] };
    }

    if (normalized.startsWith('INSERT INTO bricksbot.sandbox_events')) {
      const [id, session_id, type, payload] = params;
      const row: Row = {
        id: String(id),
        session_id: String(session_id),
        type: String(type),
        payload: JSON.parse(String(payload ?? '{}')) as Record<string, unknown>,
        created_at: new Date(Date.now() + seq++).toISOString(),
      };
      events.unshift(row);
      return { rows: [row] };
    }

    if (normalized.includes('FROM bricksbot.sandbox_events WHERE session_id = $1')) {
      const sessionId = String(params[0]);
      const limit = Number(params[1] ?? 50);
      const matching = events.filter((e) => e.session_id === sessionId).slice(0, limit);
      return { rows: matching };
    }

    throw new Error(`Unhandled SQL in fake sandbox query: ${normalized}`);
  };
}

describe('Phase 5.1 — Sandbox registry, redaction, stores, and reaper', () => {
  test('registry defaults to off and rejects unknown or disabled backends', () => {
    expect(parseSandboxBackendSetting(undefined)).toBe('off');
    expect(parseSandboxBackendSetting('')).toBe('off');
    expect(parseSandboxBackendSetting('off')).toBe('off');
    expect(parseSandboxBackendSetting('databricks')).toBe('databricks');
    expect(parseSandboxBackendSetting('e2b')).toBe('e2b');
    expect(() => parseSandboxBackendSetting('daytona')).toThrow(/Invalid SANDBOX_BACKEND/);

    const disabled = new SandboxRegistry('off');
    expect(disabled.isEnabled()).toBe(false);
    expect(() => disabled.getDefaultBackendId()).toThrow(/disabled/);
    expect(() => disabled.getBackend('databricks')).toThrow(/disabled/);

    const unconfigured = new SandboxRegistry('databricks');
    expect(unconfigured.isEnabled()).toBe(true);
    expect(() => unconfigured.getBackend()).toThrow(/not registered/);

    const envRes = createSandboxRegistryFromEnv({
      SANDBOX_BACKEND: 'databricks',
      DATABRICKS_HOST: 'https://adb-test.azuredatabricks.net',
      DATABRICKS_TOKEN: 'dapi1234567890abcdef123456',
      SANDBOX_IDLE_MINUTES: '20',
      SANDBOX_EXEC_TIMEOUT_SEC: '90',
    });
    expect(envRes.config.backend).toBe('databricks');
    expect(envRes.config.idleMinutes).toBe(20);
    expect(envRes.config.execTimeoutSec).toBe(90);
    expect(envRes.registry.isEnabled()).toBe(true);
    expect(envRes.registry.getBackend('databricks')).toBeDefined();
  });

  test('redaction scrubs configured secrets, bearer tokens, and raw sandbox paths', () => {
    const secrets = ['my-custom-secret-999', 'dapi0123456789abcdef01234567'];
    const raw =
      'Token=my-custom-secret-999 dapi0123456789abcdef01234567 Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 e2b_abcdefghijklmnop';
    const redacted = redactSecrets(raw, secrets);
    expect(redacted).not.toContain('my-custom-secret-999');
    expect(redacted).not.toContain('dapi0123456789abcdef01234567');
    expect(redacted).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    expect(redacted).not.toContain('e2b_abcdefghijklmnop');
    expect(redacted).toContain('[REDACTED]');

    const longPreview = truncatePreview(`secret=my-custom-secret-999 ${'x'.repeat(3000)}`, secrets, 100);
    expect(longPreview).not.toContain('my-custom-secret-999');
    expect(longPreview.endsWith('…[truncated]')).toBe(true);

    const payload = sanitizeEventPayload(
      {
        cmd: 'curl -H "Authorization: Bearer supersecrettoken123456789"',
        nested: { key: 'my-custom-secret-999' },
      },
      secrets
    );
    expect(JSON.stringify(payload)).not.toContain('supersecrettoken123456789');
    expect(JSON.stringify(payload)).not.toContain('my-custom-secret-999');

    expect(safeArtifactName('/home/sandbox-agent/out/report.csv')).toBe('report.csv');
    expect(stripSandboxPaths('wrote /home/sandbox-agent/out/report.csv and /tmp/test.txt')).toBe(
      'wrote report.csv and test.txt'
    );
  });

  test('sanitizeSandboxEnv strips credential keys and secret values (SB-9)', () => {
    const clean = sanitizeSandboxEnv(
      {
        DATABRICKS_TOKEN: 'dapi123',
        OPENROUTER_API_KEY: 'sk-123',
        MY_SECRET_KEY: 'abc',
        CUSTOM_VAR: 'contains-actual-secret-val',
        SAFE_MODE: '1',
        PYTHONUNBUFFERED: '1',
      },
      ['actual-secret-val']
    );
    expect(clean).toEqual({
      SAFE_MODE: '1',
      PYTHONUNBUFFERED: '1',
    });
  });

  test.each([
    ['MemorySandboxStore', () => new MemorySandboxStore() as SandboxStore],
    ['LakebaseSandboxStore', () => new LakebaseSandboxStore(createFakeLakebaseSandboxQuery()) as SandboxStore],
  ])('%s implements SandboxStore lifecycle and event parity', async (_label, createStore) => {
    const store = createStore();
    expect(await store.getActiveSessionForChat('chat-1')).toBeNull();

    const created = await store.createSession({
      chatId: 'chat-1',
      botId: 'bot-1',
      userId: 'user-1',
      backend: 'databricks',
      externalId: 'sandboxes/bricksbot-chat-1',
      status: 'ready',
      metadata: { region: 'us-west-2' },
    });
    expect(created.status).toBe('ready');
    expect(created.metadata).toEqual({ region: 'us-west-2' });

    const active = await store.getActiveSessionForChat('chat-1');
    expect(active?.id).toBe(created.id);
    expect(await store.listActiveSessionsForUser('user-1')).toHaveLength(1);

    await store.addEvent(created.id, 'create', { backend: 'databricks' });
    await store.addEvent(created.id, 'command', { cmd: 'echo hi', exitCode: 0 });
    const events = await store.listEvents(created.id);
    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe('command');

    const stopped = await store.updateSessionStatus(created.id, 'stopped', {
      stoppedAt: '2026-10-30T12:00:00.000Z',
    });
    expect(stopped.status).toBe('stopped');
    expect(await store.getActiveSessionForChat('chat-1')).toBeNull();
    expect((await store.getLatestSessionForChat('chat-1'))?.id).toBe(created.id);
  });

  test('idle reaper stops and deletes expired sandboxes and enforces per-user caps (SB-5)', async () => {
    let clockMs = Date.parse('2026-10-30T12:00:00.000Z');
    const now = () => new Date(clockMs);
    const store = new MemorySandboxStore({ now });
    const fakeBackend = createFakeBackend();
    const registry = new SandboxRegistry('databricks', { databricks: fakeBackend });
    const config = resolveSandboxConfigFromEnv({
      SANDBOX_BACKEND: 'databricks',
      SANDBOX_IDLE_MINUTES: '15',
      SANDBOX_MAX_ACTIVE_PER_USER: '2',
    });
    const service = new SandboxSessionService({ store, registry, config, now });

    // Create 2 active sessions for user-1 (up to cap of 2).
    const s1 = await service.ensureSession({ chatId: 'c1', botId: 'b1', userId: 'user-1' });
    clockMs += 5 * 60_000; // +5m
    const s2 = await service.ensureSession({ chatId: 'c2', botId: 'b2', userId: 'user-1' });

    // 3rd session for user-1 should be rejected by per-user cap.
    await expect(service.ensureSession({ chatId: 'c3', botId: 'b3', userId: 'user-1' })).rejects.toThrow(
      /Sandbox limit reached/
    );

    // Advance clock to +16m since s1 was created (s1 is 16m idle; s2 is 11m idle).
    clockMs += 11 * 60_000;
    const reaper = new SandboxReaper({ sessionService: service, idleMinutes: 15, now });
    const result = await reaper.reapIdleSessions();
    expect(result.checked).toBe(2);
    expect(result.reaped).toEqual([s1.id]);

    expect((await store.getSession(s1.id))?.status).toBe('deleted');
    expect((await store.getSession(s2.id))?.status).toBe('ready');
    expect(fakeBackend.stopped).toContain(s1.externalId);
    expect(fakeBackend.deleted).toContain(s1.externalId);
  });

  test('records python_exec as the session backend when create falls back', async () => {
    const store = new MemorySandboxStore();
    const fallbackBackend = createFakeBackend();
    fallbackBackend.createSession = async (sessionId) => `python-exec/bricksbot-${sessionId}`;
    const registry = new SandboxRegistry('databricks', { databricks: fallbackBackend });
    const service = new SandboxSessionService({
      store,
      registry,
      config: resolveSandboxConfigFromEnv({ SANDBOX_BACKEND: 'databricks' }),
    });

    const session = await service.ensureSession({
      chatId: 'chat-fb',
      botId: 'bot-1',
      userId: 'user-1',
    });
    expect(session.backend).toBe('python_exec');
    expect(session.externalId).toBe('python-exec/bricksbot-chat-fb');

    const ui = await service.getUiStatusForChat('chat-fb');
    expect(ui.backend).toBe('python_exec');
    expect(ui.session?.backend).toBe('python_exec');
  });

  test('stop then ensureSession resumes the same session row', async () => {
    const store = new MemorySandboxStore();
    const fakeBackend = createFakeBackend();
    const registry = new SandboxRegistry('databricks', { databricks: fakeBackend });
    const service = new SandboxSessionService({
      store,
      registry,
      config: resolveSandboxConfigFromEnv({ SANDBOX_BACKEND: 'databricks' }),
    });

    const created = await service.ensureSession({
      chatId: 'chat-resume',
      botId: 'bot-1',
      userId: 'user-1',
    });
    await service.stopSession('chat-resume', 'manual');
    expect((await store.getSession(created.id))?.status).toBe('stopped');

    const resumed = await service.ensureSession({
      chatId: 'chat-resume',
      botId: 'bot-1',
      userId: 'user-1',
    });
    expect(resumed.id).toBe(created.id);
    expect(resumed.status).toBe('ready');
    expect(resumed.stoppedAt).toBeNull();
    expect(fakeBackend.created.length).toBe(2);
  });

  test('reaper deletes sessions past max session age and startup reconcile cleans stuck creating', async () => {
    let clockMs = Date.parse('2026-10-30T12:00:00.000Z');
    const now = () => new Date(clockMs);
    const store = new MemorySandboxStore({ now });
    const fakeBackend = createFakeBackend();
    const registry = new SandboxRegistry('databricks', { databricks: fakeBackend });
    const config = resolveSandboxConfigFromEnv({
      SANDBOX_BACKEND: 'databricks',
      SANDBOX_IDLE_MINUTES: '60',
      SANDBOX_MAX_SESSION_MINUTES: '30',
    });
    const service = new SandboxSessionService({ store, registry, config, now });

    const aged = await service.ensureSession({
      chatId: 'chat-aged',
      botId: 'bot-1',
      userId: 'user-1',
    });
    clockMs += 31 * 60_000;
    const reaper = new SandboxReaper({
      sessionService: service,
      idleMinutes: 60,
      maxSessionMinutes: 30,
      now,
    });
    const reap = await reaper.reapIdleSessions();
    expect(reap.reaped).toEqual([aged.id]);
    expect((await store.getSession(aged.id))?.status).toBe('deleted');

    const stuck = await store.createSession({
      chatId: 'chat-stuck',
      botId: 'bot-1',
      userId: 'user-1',
      backend: 'databricks',
      externalId: 'sandboxes/bricksbot-chat-stuck',
      status: 'creating',
    });
    const startup = await reaper.reconcileAtStartup();
    expect(startup.reconciled).toContain(stuck.id);
    expect((await store.getSession(stuck.id))?.status).toBe('deleted');
  });
});
