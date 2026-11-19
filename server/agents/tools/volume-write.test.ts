import { describe, expect, test } from 'vitest';
import { parseArtifactPinNotice } from '../../../shared/chat/artifact-pin-notice.js';
import type { ChatClient } from '../../../shared/agents/types.js';
import { MemoryChatStore } from '../../chat/memory-store.js';
import { ChatService } from '../../chat/service.js';
import { MemoryVolumeUsageStore } from '../../volumes/usage-store.js';
import { createVolumeWriteTool } from './volume-write.js';

const ROOT = '/Volumes/main/default/bricksbot_artifacts/bricksbot';

describe('volume_write', () => {
  test('rejects escapes and other users before any write, and keeps the active bot', async () => {
    const store = new MemoryChatStore();
    const bot = await store.createBot({ name: 'Analyst', ownerId: 'owner' });
    const writes: string[] = [];
    const usage = new MemoryVolumeUsageStore();
    const tool = createVolumeWriteTool({
      root: ROOT,
      chatStore: store,
      usage,
      writeFile: async (volumePath) => {
        writes.push(volumePath);
      },
    });
    const ctx = { chatId: 'chat-1', bot, userId: 'Alice@Co.com' };

    for (const relative_path of [
      '/Volumes/main/default/other/secret.txt',
      '../users/bob@co.com/bots/x/secret.txt',
      'users/bob@co.com/notes.md',
      'notes/%2e%2e/secret.txt',
    ]) {
      const error = await tool.preflight({ relative_path, content: 'no', user_id: 'bob@co.com', bot_id: 'other' }, ctx);
      expect(error).toBeTruthy();
    }
    expect(writes).toEqual([]);

    const preview = await tool.approvalArguments(
      { relative_path: 'notes/a.md', content: 'hi', bot_id: 'other-bot', user_id: 'bob@co.com' },
      ctx
    );
    expect(preview.resolved_path).toBe(`${ROOT}/users/alice@co.com/bots/${bot.id}/notes/a.md`);
    expect(String(preview.resolved_path)).not.toContain('bob@co.com');
    expect(String(preview.resolved_path)).not.toContain('other-bot');
  });

  test('quota rejection does not write and does not spend another user', async () => {
    const store = new MemoryChatStore();
    const bot = await store.createBot({ name: 'Analyst', ownerId: 'owner' });
    const writes: string[] = [];
    const usage = new MemoryVolumeUsageStore();
    await usage.addBytes('alice@co.com', bot.id, 8);
    const tool = createVolumeWriteTool({
      root: ROOT,
      chatStore: store,
      usage,
      limits: { maxWriteBytes: 8, userQuotaBytes: 10 },
      writeFile: async (volumePath) => {
        writes.push(volumePath);
      },
    });

    const denied = await tool.preflight(
      { relative_path: 'notes/a.md', content: '123456' },
      { chatId: 'c', bot, userId: 'alice@co.com' }
    );
    expect(denied).toMatch(/per-user quota/);
    expect(writes).toEqual([]);

    const allowed = await tool.execute(
      { relative_path: 'notes/b.md', content: 'ok', pin: false },
      { chatId: 'c', bot, userId: 'bob@co.com' }
    );
    expect(JSON.parse(allowed)).toMatchObject({
      ok: true,
      path: `${ROOT}/users/bob@co.com/bots/${bot.id}/notes/b.md`,
      bytes: 2,
    });
    expect(writes).toEqual([`${ROOT}/users/bob@co.com/bots/${bot.id}/notes/b.md`]);
    expect(await usage.getUsage('alice@co.com', bot.id)).toEqual({ userBytes: 8, botBytes: 8 });
    expect(await usage.getUsage('bob@co.com', bot.id)).toEqual({ userBytes: 2, botBytes: 2 });
  });

  test('routine turns and handoff stay Ask-first, and shared bots namespace by the caller', async () => {
    const store = new MemoryChatStore();
    const { primary } = await store.ensureBootstrap('user-1');
    const teammate = await store.createBot({
      name: 'Analyst',
      ownerId: primary.ownerId,
      spaceId: primary.spaceId,
    });
    const shared = await store.createBot({
      name: 'Shared',
      ownerId: 'owner',
      isShared: true,
      spaceId: primary.spaceId,
    });
    await store.addSpaceMember(primary.spaceId!, 'Alice@Co.com', 'member');
    await store.addSpaceMember(primary.spaceId!, 'bob@co.com', 'member');
    const primaryChat = await store.getDefaultChat(primary.id, 'user-1');
    const teammateChat = await store.getHandoffChat(teammate.id, 'user-1');
    const aliceChat = await store.getDefaultChat(shared.id, 'Alice@Co.com');
    const bobChat = await store.getDefaultChat(shared.id, 'bob@co.com');

    const writes: string[] = [];
    const usage = new MemoryVolumeUsageStore();
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
                arguments: { bot_id: teammate.id, brief: 'write the note' },
              },
            ],
          };
        }
        if (turn === 2) {
          return {
            content: 'Writing',
            toolCalls: [
              {
                id: 'call_vol',
                name: 'volume_write',
                arguments: {
                  relative_path: 'notes/a.md',
                  content: 'from-handoff',
                  user_id: 'bob@co.com',
                  bot_id: 'other-bot',
                },
              },
            ],
          };
        }
        if (turn === 3) {
          return {
            content: null,
            toolCalls: [
              {
                id: 'call_escape',
                name: 'volume_write',
                arguments: { relative_path: '../secret.txt', content: 'no' },
              },
            ],
          };
        }
        return { content: 'done', toolCalls: [] };
      },
    };

    const service = new ChatService({
      store,
      client,
      volumeWrite: {
        root: ROOT,
        usage,
        writeFile: async (volumePath) => {
          writes.push(volumePath);
        },
      },
    });

    const pendingHandoff = await service.sendUserMessage(primaryChat.id, 'ask analyst');
    expect(pendingHandoff.pendingApprovals[0]?.toolCall.name).toBe('handoff_to_bot');
    await service.decideApproval(pendingHandoff.pendingApprovals[0].id, 'once');

    const teammatePending = await service.getApprovals().listPending(teammateChat.id);
    expect(teammatePending).toHaveLength(1);
    expect(teammatePending[0]?.toolCall.name).toBe('volume_write');
    expect(teammatePending[0]?.toolCall.arguments.resolved_path).toBe(
      `${ROOT}/users/user-1/bots/${teammate.id}/notes/a.md`
    );
    expect(writes).toEqual([]);

    const saved = await service.decideApproval(teammatePending[0].id, 'once');
    expect(saved.assistant?.content).toBe('done');
    expect(writes).toEqual([`${ROOT}/users/user-1/bots/${teammate.id}/notes/a.md`]);
    const pins = (await store.listMessages(teammateChat.id))
      .filter((message) => message.role === 'system')
      .map((message) => parseArtifactPinNotice(message.content))
      .filter(Boolean);
    expect(pins[0]).toMatchObject({
      artifactKind: 'volume_path',
      body: `${ROOT}/users/user-1/bots/${teammate.id}/notes/a.md`,
    });

    turn = 2;
    const escaped = await service.sendUserMessage(aliceChat.id, 'escape');
    expect(escaped.pendingApprovals).toEqual([]);
    expect(writes).toHaveLength(1);
    const escapeRow = (await store.listMessages(aliceChat.id)).find((message) => message.role === 'tool');
    expect(escapeRow?.content).toContain('path traversal');

    let aliceStep = 0;
    client.complete = async () => {
      aliceStep += 1;
      if (aliceStep === 1) {
        return {
          content: 'writing',
          toolCalls: [
            {
              id: 'call_alice',
              name: 'volume_write',
              arguments: { relative_path: 'notes/mine.md', content: 'alice', pin: false },
            },
          ],
        };
      }
      return { content: 'saved alice', toolCalls: [] };
    };
    const alicePending = await service.sendUserMessage(aliceChat.id, 'write mine');
    expect(alicePending.pendingApprovals[0]?.toolCall.arguments.resolved_path).toBe(
      `${ROOT}/users/alice@co.com/bots/${shared.id}/notes/mine.md`
    );
    await service.decideApproval(alicePending.pendingApprovals[0].id, 'once');

    let bobStep = 0;
    client.complete = async () => {
      bobStep += 1;
      if (bobStep === 1) {
        return {
          content: null,
          toolCalls: [
            {
              id: 'call_bob',
              name: 'volume_write',
              arguments: { relative_path: 'notes/mine.md', content: 'bob', pin: false },
            },
          ],
        };
      }
      return { content: 'saved bob', toolCalls: [] };
    };
    const bobPending = await service.sendUserMessage(bobChat.id, 'write mine');
    await service.decideApproval(bobPending.pendingApprovals[0].id, 'once');

    expect(writes).toContain(`${ROOT}/users/alice@co.com/bots/${shared.id}/notes/mine.md`);
    expect(writes).toContain(`${ROOT}/users/bob@co.com/bots/${shared.id}/notes/mine.md`);
    expect(writes.some((path) => path.includes('/users/owner/'))).toBe(false);
    expect((await usage.getUsage('alice@co.com', shared.id)).userBytes).toBe(5);
    expect((await usage.getUsage('bob@co.com', shared.id)).userBytes).toBe(3);

    let routineStep = 0;
    client.complete = async () => {
      routineStep += 1;
      if (routineStep === 1) {
        return {
          content: null,
          toolCalls: [
            {
              id: 'call_routine',
              name: 'volume_write',
              arguments: { relative_path: 'notes/routine.md', content: 'nope' },
            },
          ],
        };
      }
      return { content: 'routine blocked', toolCalls: [] };
    };
    const routine = await service.sendUserMessage(aliceChat.id, 'scheduled', { routine: true });
    expect(routine.pendingApprovals).toEqual([]);
    const routineTool = (await store.listMessages(aliceChat.id))
      .filter((message) => message.role === 'tool')
      .map((message) => message.content)
      .find((content) => content.includes('routine'));
    expect(routineTool).toContain('volume_write is not available on routine runs');
    expect(writes.some((path) => path.endsWith('/notes/routine.md'))).toBe(false);
  });
});
