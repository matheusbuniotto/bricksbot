import { describe, expect, test } from 'vitest';
import { parseArtifactPinNotice } from '../../../shared/chat/artifact-pin-notice.js';
import type { ChatClient, ChatCompletionRequest } from '../../../shared/agents/types.js';
import { MemoryChatStore } from '../../chat/memory-store.js';
import { ChatService } from '../../chat/service.js';
import { ArtifactSyncService } from '../../sandbox/artifact-sync.js';
import type { ExecutionBackend } from '../../sandbox/backend.js';
import { MemorySandboxStore } from '../../sandbox/memory-store.js';
import { SandboxRegistry } from '../../sandbox/registry.js';
import { SandboxSessionService } from '../../sandbox/session-service.js';
import { SANDBOX_TOOL_NAMES } from './sandbox-tools.js';

function createFakeSandboxSetup(options?: {
  enabled?: boolean;
  failExec?: boolean;
  onDuringExec?: () => Promise<void> | void;
}) {
  const files = new Map<string, Uint8Array>();
  const volumeFiles = new Map<string, string>();
  const createdSessions: string[] = [];
  const deletedSessions: string[] = [];
  const stoppedSessions: string[] = [];

  const backend: ExecutionBackend = {
    async createSession(sessionId) {
      const id = `sandboxes/bricksbot-${sessionId}`;
      createdSessions.push(id);
      return id;
    },
    async runCommand(_ext, cmd) {
      if (options?.onDuringExec) {
        await options.onDuringExec();
      }
      if (options?.failExec) {
        throw new Error('Sandbox timed out after 120s (token=dapi99999999999999999999)');
      }
      const commandText = cmd.join(' ');
      if (commandText.includes('report.csv')) {
        files.set(
          '/home/sandbox-agent/report.csv',
          new Uint8Array(Buffer.from('region,revenue\nNA,1200\nEU,950\n', 'utf8'))
        );
      }
      return {
        stdout: 'hello from sandbox\n',
        stderr: '',
        exitCode: 0,
        durationMs: 25,
        artifactPaths: [],
      };
    },
    async uploadFile(_ext, data, dest) {
      const bytes = typeof data === 'string' ? new Uint8Array(Buffer.from(data, 'utf8')) : data;
      files.set(dest, bytes);
      return dest;
    },
    async downloadFile(_ext, src) {
      const found = files.get(src);
      if (!found) {
        throw new Error(`File not found in sandbox: ${src}`);
      }
      return found;
    },
    async stopSession(ext) {
      stoppedSessions.push(ext);
    },
    async deleteSession(ext) {
      deletedSessions.push(ext);
    },
  };

  const sandboxStore = new MemorySandboxStore();
  const registry = new SandboxRegistry(options?.enabled === false ? 'off' : 'databricks', { databricks: backend });
  const sessionService = new SandboxSessionService({
    store: sandboxStore,
    registry,
    config: {
      idleMinutes: 15,
      execTimeoutSec: 120,
      maxActivePerUser: 3,
      artifactVolumeRoot: '/Volumes/main/default/bricksbot_artifacts',
      secretsToRedact: ['dapi99999999999999999999'],
    },
  });

  return {
    sandboxStore,
    sessionService,
    files,
    volumeFiles,
    createdSessions,
    stoppedSessions,
    deletedSessions,
  };
}

describe('Phase 5.2–5.5 — Sandbox tools, approvals, artifact sync, and UI status', () => {
  test('SB-3: when sandbox flag is off, no sandbox tools are registered or listed in prompt', async () => {
    const store = new MemoryChatStore();
    const { primary } = await store.ensureBootstrap('user-1');
    const chat = await store.getOrCreateChatForBot(primary.id);
    const { sessionService } = createFakeSandboxSetup({ enabled: false });

    let capturedRequest: ChatCompletionRequest | null = null;
    const client: ChatClient = {
      provider: 'stub',
      async complete(req) {
        capturedRequest = req;
        return { content: 'done', toolCalls: [] };
      },
    };

    const service = new ChatService({
      store,
      client,
      sandbox: sessionService,
    });

    await service.sendUserMessage(chat.id, 'hi');
    const toolNames = (capturedRequest!.tools ?? []).map((t) => t.name);
    for (const sandboxTool of SANDBOX_TOOL_NAMES) {
      expect(toolNames).not.toContain(sandboxTool);
    }
    const systemPrompt = capturedRequest!.messages[0]?.content ?? '';
    expect(systemPrompt).toContain('Sandbox tools are disabled (SANDBOX_BACKEND=off).');
  });

  test('handoff autoApproveAll still Ask-first for sandbox_exec', async () => {
    const store = new MemoryChatStore();
    const { primary } = await store.ensureBootstrap('user-1');
    const teammate = await store.createBot({
      name: 'Analyst',
      ownerId: primary.ownerId,
      spaceId: primary.spaceId,
    });
    const primaryChat = await store.getOrCreateChatForBot(primary.id);
    const teammateChat = await store.getOrCreateChatForBot(teammate.id);
    const { sessionService } = createFakeSandboxSetup();

    let turn = 0;
    const client: ChatClient = {
      provider: 'stub',
      async complete() {
        turn += 1;
        if (turn === 1) {
          return {
            content: null,
            toolCalls: [
              {
                id: 'call_hand',
                name: 'handoff_to_bot',
                arguments: { bot_id: teammate.id, brief: 'run echo in sandbox' },
              },
            ],
          };
        }
        if (turn === 2) {
          // Nested teammate turn under autoApproveAll — sandbox_exec must still Ask-first.
          return {
            content: 'Need sandbox',
            toolCalls: [
              {
                id: 'call_handoff_sbx',
                name: 'sandbox_exec',
                arguments: { command: 'echo hi' },
              },
            ],
          };
        }
        return { content: 'Handoff finished with pending sandbox approval.', toolCalls: [] };
      },
    };

    const service = new ChatService({ store, client, sandbox: sessionService });
    const pendingHandoff = await service.sendUserMessage(primaryChat.id, 'ask analyst');
    expect(pendingHandoff.pendingApprovals[0]?.toolCall.name).toBe('handoff_to_bot');
    await service.decideApproval(pendingHandoff.pendingApprovals[0].id, 'once');

    const teammatePending = await service.getApprovals().listPending(teammateChat.id);
    expect(teammatePending).toHaveLength(1);
    expect(teammatePending[0]?.toolCall.name).toBe('sandbox_exec');
  });

  test('SB-1, SB-2, SB-4, SB-10: sandbox_exec requires approval, sets working presence, reuses session, and preserves toolCallId', async () => {
    const store = new MemoryChatStore();
    const { primary } = await store.ensureBootstrap('user-1');
    const chat = await store.getOrCreateChatForBot(primary.id);

    let presenceDuringExec: string | undefined;
    const { sessionService, createdSessions } = createFakeSandboxSetup({
      async onDuringExec() {
        const botNow = await store.getBot(primary.id);
        presenceDuringExec = botNow?.presence;
      },
    });

    let turn = 0;
    const client: ChatClient = {
      provider: 'stub',
      async complete(req) {
        turn += 1;
        if (turn === 1) {
          const toolNames = (req.tools ?? []).map((t) => t.name);
          expect(toolNames).toContain('sandbox_exec');
          return {
            content: 'Running command in sandbox.',
            toolCalls: [
              {
                id: 'call_sbx_1',
                name: 'sandbox_exec',
                arguments: { command: 'echo hello' },
              },
            ],
          };
        }
        return { content: 'Sandbox said hello.', toolCalls: [] };
      },
    };

    const service = new ChatService({ store, client, sandbox: sessionService });

    const first = await service.sendUserMessage(chat.id, 'run echo hello');
    expect(first.pendingApprovals).toHaveLength(1);
    expect(first.pendingApprovals[0]?.toolCall.name).toBe('sandbox_exec');
    expect((await store.getBot(primary.id))?.presence).toBe('waiting');

    // Approve with all_the_time so a second call in this chat auto-runs and reuses the session.
    const decided = await service.decideApproval(first.pendingApprovals[0].id, 'all_the_time');
    expect(presenceDuringExec).toBe('working');
    expect(decided.assistant?.content).toBe('Sandbox said hello.');
    expect(createdSessions).toHaveLength(1);

    const messages = await store.listMessages(chat.id);
    const toolRow = messages.find((m) => m.role === 'tool' && m.toolCallId === 'call_sbx_1');
    expect(toolRow).toBeDefined();
    expect(JSON.parse(toolRow!.content)).toMatchObject({
      ok: true,
      tool: 'sandbox_exec',
      exitCode: 0,
      stdout: 'hello from sandbox\n',
    });

    // Second turn: auto-approved sandbox_exec reuses the same sandbox session (SB-2).
    turn = 0;
    await service.sendUserMessage(chat.id, 'run echo again');
    expect(createdSessions).toHaveLength(1);
  });

  test('SB-6 (Phase 5.3 E2E): analyze and return a CSV -> syncs to UC Volume and pins artifact before delete', async () => {
    const store = new MemoryChatStore();
    const { primary } = await store.ensureBootstrap('user-1');
    const chat = await store.getOrCreateChatForBot(primary.id);
    const { sessionService, volumeFiles, stoppedSessions, deletedSessions } = createFakeSandboxSetup();

    const artifactSync = new ArtifactSyncService({
      chatStore: store,
      sessionService,
      async writeVolumeFile(volumePath, data) {
        volumeFiles.set(volumePath, Buffer.from(data).toString('utf8'));
      },
    });

    let step = 0;
    const client: ChatClient = {
      provider: 'stub',
      async complete() {
        step += 1;
        if (step === 1) {
          return {
            content: 'Generating report.csv',
            toolCalls: [
              {
                id: 'call_gen',
                name: 'sandbox_exec',
                arguments: { command: 'python3 generate_report.py > /home/sandbox-agent/report.csv' },
              },
            ],
          };
        }
        if (step === 2) {
          return {
            content: 'Saving report.csv to UC Volume',
            toolCalls: [
              {
                id: 'call_save',
                name: 'sandbox_save_artifact',
                arguments: {
                  source_path: '/home/sandbox-agent/report.csv',
                  title: 'Regional Revenue CSV',
                  summary: 'NA and EU revenue totals',
                },
              },
            ],
          };
        }
        if (step === 3) {
          return {
            content: 'Stopping and deleting sandbox',
            toolCalls: [
              { id: 'call_stop', name: 'sandbox_stop', arguments: {} },
              { id: 'call_del', name: 'sandbox_delete', arguments: {} },
            ],
          };
        }
        return { content: 'Analysis complete and CSV pinned.', toolCalls: [] };
      },
    };

    const service = new ChatService({
      store,
      client,
      sandbox: sessionService,
      sandboxArtifactSync: artifactSync,
    });

    // Turn step 1: approve sandbox_exec
    const r1 = await service.sendUserMessage(chat.id, 'analyze and return a CSV');
    expect(r1.pendingApprovals[0]?.toolCall.name).toBe('sandbox_exec');
    const r2 = await service.decideApproval(r1.pendingApprovals[0].id, 'once');

    // Turn step 2: approve sandbox_save_artifact
    expect(r2.pendingApprovals[0]?.toolCall.name).toBe('sandbox_save_artifact');
    const r3 = await service.decideApproval(r2.pendingApprovals[0].id, 'once');

    // Verify CSV was written to UC Volume and pinned onto the chat transcript!
    const expectedVolumePath = `/Volumes/main/default/bricksbot_artifacts/${chat.id}/report.csv`;
    expect(volumeFiles.get(expectedVolumePath)).toBe('region,revenue\nNA,1200\nEU,950\n');

    const messagesAfterSave = await store.listMessages(chat.id);
    const pinNotice = messagesAfterSave
      .filter((m) => m.role === 'system')
      .map((m) => parseArtifactPinNotice(m.content))
      .find(Boolean);
    expect(pinNotice).toMatchObject({
      kind: 'artifact_pin',
      title: 'Regional Revenue CSV',
      artifactKind: 'volume_path',
      body: expectedVolumePath,
    });

    // Turn step 3: sandbox_stop auto-ran, while sandbox_delete requires approval and never persists all_the_time!
    expect(stoppedSessions).toHaveLength(1);
    expect(r3.pendingApprovals).toHaveLength(1);
    expect(r3.pendingApprovals[0]?.toolCall.name).toBe('sandbox_delete');

    const r4 = await service.decideApproval(r3.pendingApprovals[0].id, 'all_the_time');
    expect(r4.assistant?.content).toBe('Analysis complete and CSV pinned.');
    expect(r4.autoApprovedTools).not.toContain('sandbox_delete');
    expect(deletedSessions).toHaveLength(1);

    // UI status never exposes raw `/home/sandbox-agent/report.csv` path (§5.6).
    const uiStatus = await sessionService.getUiStatusForChat(chat.id);
    expect(uiStatus.enabled).toBe(true);
    expect(uiStatus.session?.status).toBe('deleted');
    const serializedEvents = JSON.stringify(uiStatus.recentEvents);
    expect(serializedEvents).not.toContain('/home/sandbox-agent');
    expect(serializedEvents).toContain('report.csv');
  });

  test('SB-7 & SB-8: sandbox failure returns redacted error to Bot and turn continues cleanly', async () => {
    const store = new MemoryChatStore();
    const { primary } = await store.ensureBootstrap('user-1');
    const chat = await store.getOrCreateChatForBot(primary.id);
    const { sessionService } = createFakeSandboxSetup({ failExec: true });

    let turn = 0;
    const client: ChatClient = {
      provider: 'stub',
      async complete() {
        turn += 1;
        if (turn === 1) {
          return {
            content: 'Running slow script',
            toolCalls: [{ id: 'call_fail', name: 'sandbox_exec', arguments: { command: 'sleep 999' } }],
          };
        }
        return {
          content: 'The sandbox command timed out; I can retry with a smaller batch.',
          toolCalls: [],
        };
      },
    };

    const service = new ChatService({ store, client, sandbox: sessionService });
    const pending = await service.sendUserMessage(chat.id, 'run slow task');
    const final = await service.decideApproval(pending.pendingApprovals[0].id, 'once');

    expect(final.assistant?.content).toContain('sandbox command timed out');
    const messages = await store.listMessages(chat.id);
    const toolMsg = messages.find((m) => m.role === 'tool' && m.toolCallId === 'call_fail');
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.content).not.toContain('dapi99999999999999999999');
    expect(JSON.parse(toolMsg!.content)).toMatchObject({
      ok: false,
      tool: 'sandbox_exec',
    });
  });
});
