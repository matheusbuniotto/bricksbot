import { describe, expect, test } from 'vitest';
import { DEFAULT_META_TOOL_NAMES } from '../../shared/agents/meta-tools.js';
import type { ChatClient, ChatCompletionRequest, ChatCompletionResult } from '../../shared/agents/types.js';
import type { Request } from 'express';
import { MemoryMemorySkillStore } from '../agents/memory/memory-store.js';
import { McpDiscoveryService } from '../agents/tools/mcp-discovery.js';
import { buildConnectedMcpTools } from '../agents/tools/mcp-tools.js';
import { MemoryRoutineStore } from '../routines/memory-store.js';
import { createDatabricksTokenProvider, runWithDatabricksRequestAuth, runWithRoutineAuth } from './databricks-auth.js';
import { MemoryChatStore } from './memory-store.js';
import { ChatService, type RegisteredTool } from './service.js';

class ScriptedClient implements ChatClient {
  readonly provider = 'stub' as const;
  readonly requests: ChatCompletionRequest[] = [];
  lastRequest: ChatCompletionRequest | null = null;
  constructor(private readonly script: Array<ChatCompletionResult | Error>) {}
  async complete(request: ChatCompletionRequest): Promise<ChatCompletionResult> {
    this.requests.push(request);
    this.lastRequest = request;
    const next = this.script.shift();
    if (!next) throw new Error('No scripted completions left');
    if (next instanceof Error) throw next;
    return next;
  }
}

describe('ChatService', () => {
  test('persists user + assistant from the ChatClient', async () => {
    const store = new MemoryChatStore();
    const bot = await store.ensurePrimaryBot();
    const chat = await store.getOrCreateChatForBot(bot.id);
    const service = new ChatService({
      store,
      client: new ScriptedClient([{ content: 'model says hi', toolCalls: [] }]),
    });

    const result = await service.sendUserMessage(chat.id, 'hello');
    expect(result.assistant?.content).toBe('model says hi');
    expect(result.provider).toBe('stub');
    expect(await store.listMessages(chat.id)).toHaveLength(2);
  });

  test('creates a pending approval for web_fetch tool calls', async () => {
    const store = new MemoryChatStore();
    const bot = await store.ensurePrimaryBot();
    const chat = await store.getOrCreateChatForBot(bot.id);
    const service = new ChatService({
      store,
      client: new ScriptedClient([
        {
          content: null,
          toolCalls: [{ id: 'call_1', name: 'web_fetch', arguments: { url: 'https://example.com' } }],
        },
      ]),
      webFetchAllowlist: ['example.com'],
    });

    const result = await service.sendUserMessage(chat.id, 'fetch example');
    expect(result.pendingApprovals).toHaveLength(1);
    expect(result.pendingApprovals[0]?.toolCall.name).toBe('web_fetch');
    // Wait state lives on the approval card / presence — not a chat bubble.
    expect(result.assistant?.content ?? '').toBe('');
    const updatedBot = await store.getBot(bot.id);
    expect(updatedBot?.presence).toBe('waiting');
  });

  test('runs web_fetch after approval and continues the turn', async () => {
    const store = new MemoryChatStore();
    const bot = await store.ensurePrimaryBot();
    const chat = await store.getOrCreateChatForBot(bot.id);
    const service = new ChatService({
      store,
      client: new ScriptedClient([
        {
          content: null,
          toolCalls: [{ id: 'call_1', name: 'web_fetch', arguments: { url: 'https://example.com/a' } }],
        },
        { content: 'fetched summary', toolCalls: [] },
      ]),
      webFetchAllowlist: ['example.com'],
    });

    const pending = await service.sendUserMessage(chat.id, 'fetch it');
    const approvalId = pending.pendingApprovals[0].id;

    // Avoid real network: temporarily stub fetch via global in execute path —
    // ChatService uses createWebFetchTool which calls global fetch.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response('page body', { status: 200 })) as typeof fetch;

    try {
      const continued = await service.decideApproval(approvalId, 'approved');
      expect(continued.assistant?.content).toBe('fetched summary');
      expect(continued.pendingApprovals).toHaveLength(0);
      const after = await store.getBot(bot.id);
      expect(after?.presence).toBe('online');
      const messages = await store.listMessages(chat.id);
      expect(messages.some((m) => m.role === 'tool' && m.content.includes('page body'))).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('sets waiting when one of multiple tool approvals is still pending', async () => {
    const store = new MemoryChatStore();
    const bot = await store.ensurePrimaryBot();
    const chat = await store.getOrCreateChatForBot(bot.id);
    const service = new ChatService({
      store,
      client: new ScriptedClient([
        {
          content: null,
          toolCalls: [
            { id: 'call_a', name: 'web_fetch', arguments: { url: 'https://example.com/a' } },
            { id: 'call_b', name: 'web_fetch', arguments: { url: 'https://example.com/b' } },
          ],
        },
        { content: 'both done', toolCalls: [] },
      ]),
      webFetchAllowlist: ['example.com'],
    });

    const pending = await service.sendUserMessage(chat.id, 'fetch both');
    expect(pending.pendingApprovals).toHaveLength(2);
    expect((await store.getBot(bot.id))?.presence).toBe('waiting');
    // Approval cards own the wait UX — do not spam the transcript.
    expect(pending.assistant?.content ?? '').toBe('');

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response('ok', { status: 200 })) as typeof fetch;
    try {
      const mid = await service.decideApproval(pending.pendingApprovals[0].id, 'approved');
      expect(mid.pendingApprovals).toHaveLength(1);
      expect((await store.getBot(bot.id))?.presence).toBe('waiting');

      const done = await service.decideApproval(mid.pendingApprovals[0].id, 'approved');
      expect(done.pendingApprovals).toHaveLength(0);
      expect((await store.getBot(bot.id))?.presence).toBe('online');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('all_the_time clears sibling pending approvals for the same tool', async () => {
    const store = new MemoryChatStore();
    const bot = await store.ensurePrimaryBot();
    const chat = await store.getOrCreateChatForBot(bot.id);
    const catalogCalls: string[] = [];
    const service = new ChatService({
      store,
      client: new ScriptedClient([
        {
          content: null,
          toolCalls: [
            { id: 'call_a', name: 'lakehouse_catalog', arguments: { action: 'list_catalogs' } },
            { id: 'call_b', name: 'lakehouse_catalog', arguments: { action: 'list_schemas', catalog: 'main' } },
            {
              id: 'call_c',
              name: 'lakehouse_catalog',
              arguments: { action: 'list_tables', catalog: 'main', schema: 'default' },
            },
          ],
        },
        { content: 'catalogs ready', toolCalls: [] },
      ]),
      sqlQuery: {
        warehouseId: 'wh-1',
        executeImpl: async (req) => {
          catalogCalls.push(req.statement);
          return 'ok';
        },
      },
    });

    const pending = await service.sendUserMessage(chat.id, 'browse catalogs');
    expect(pending.pendingApprovals).toHaveLength(3);

    const done = await service.decideApproval(pending.pendingApprovals[0].id, 'all_the_time');
    expect(done.pendingApprovals).toHaveLength(0);
    expect(done.assistant?.content).toBe('catalogs ready');
    expect(done.autoApprovedTools).toContain('lakehouse_catalog');
    expect(catalogCalls).toHaveLength(3);

    // Double-decide must not throw / re-run tools.
    const again = await service.decideApproval(pending.pendingApprovals[0].id, 'all_the_time');
    expect(again.pendingApprovals).toHaveLength(0);
    expect(catalogCalls).toHaveLength(3);
  });

  test('remember tool auto-runs and writes durable memory', async () => {
    const store = new MemoryChatStore();
    const bot = await store.ensurePrimaryBot();
    const chat = await store.getOrCreateChatForBot(bot.id);
    const memory = new MemoryMemorySkillStore();
    const client = new ScriptedClient([
      {
        content: null,
        toolCalls: [
          {
            id: 'call_remember',
            name: 'remember',
            arguments: { key: 'timezone', content: 'America/Sao_Paulo' },
          },
        ],
      },
      { content: 'Got it — I will remember your timezone.', toolCalls: [] },
    ]);
    const service = new ChatService({ store, client, memory });
    const result = await service.sendUserMessage(chat.id, 'remember my tz');
    expect(result.pendingApprovals).toHaveLength(0);
    expect(result.assistant?.content).toContain('timezone');
    expect(await memory.listMemories(bot.id)).toEqual([
      expect.objectContaining({ key: 'timezone', content: 'America/Sao_Paulo' }),
    ]);
  });

  test('registers default meta tools for Primary and teammates', async () => {
    const store = new MemoryChatStore();
    const primary = await store.ensurePrimaryBot();
    const teammate = await store.createBot({
      name: 'Analyst',
      ownerId: primary.ownerId,
      spaceId: primary.spaceId,
    });
    const client = new ScriptedClient([
      { content: 'ok', toolCalls: [] },
      { content: 'ok', toolCalls: [] },
    ]);
    // No explicit memory store — meta tools must still be default for every bot.
    const service = new ChatService({ store, client });

    const primaryChat = await store.getOrCreateChatForBot(primary.id);
    await service.sendUserMessage(primaryChat.id, 'hi');
    const primaryTools = client.lastRequest?.tools?.map((t) => t.name) ?? [];
    expect(primaryTools).toEqual(expect.arrayContaining([...DEFAULT_META_TOOL_NAMES]));
    expect(primaryTools).toContain('handoff_to_bot');

    const teammateChat = await store.getOrCreateChatForBot(teammate.id);
    await service.sendUserMessage(teammateChat.id, 'hi');
    const teammateTools = client.lastRequest?.tools?.map((t) => t.name) ?? [];
    expect(teammateTools).toEqual(expect.arrayContaining([...DEFAULT_META_TOOL_NAMES]));
    expect(teammateTools).not.toContain('handoff_to_bot');
  });

  test('includes that bot memory and a skills index in the system prompt', async () => {
    const store = new MemoryChatStore();
    const primary = await store.ensurePrimaryBot();
    const other = await store.createBot({
      name: 'Analyst',
      ownerId: primary.ownerId,
      spaceId: primary.spaceId,
    });
    const memory = new MemoryMemorySkillStore();
    await memory.upsertMemory(primary.id, 'warehouse', 'us-west');
    const longBody = `Prefer concise SQL.\n${'x'.repeat(2_500)}`;
    await memory.createSkill(primary.id, 'SQL style', longBody);

    const client = new ScriptedClient([
      { content: 'ok', toolCalls: [] },
      { content: 'ok', toolCalls: [] },
    ]);
    const service = new ChatService({ store, client, memory });

    const primaryChat = await store.getOrCreateChatForBot(primary.id);
    await service.sendUserMessage(primaryChat.id, 'hi');
    const primarySystem = client.lastRequest?.messages[0]?.content ?? '';
    expect(primarySystem).toContain('## Capabilities');
    expect(primarySystem).toContain('## Skills');
    expect(primarySystem).toContain('warehouse: us-west');
    expect(primarySystem).toContain('SQL style');
    expect(primarySystem).toContain('Prefer concise SQL.');
    expect(primarySystem).not.toContain(longBody);
    expect(primarySystem).toContain('activate_skill');
    expect(primarySystem).toContain('sql-explore');
    expect(primarySystem).toContain('Memory is not a source of truth');
    expect(client.lastRequest?.tools?.map((t) => t.name)).toEqual(
      expect.arrayContaining(['handoff_to_bot', 'activate_skill', 'list_memories'])
    );

    const otherChat = await store.getOrCreateChatForBot(other.id);
    await service.sendUserMessage(otherChat.id, 'hi');
    const otherSystem = client.lastRequest?.messages[0]?.content ?? '';
    expect(otherSystem).not.toContain('warehouse');
    expect(otherSystem).not.toContain('SQL style');
    expect(otherSystem).toContain('sql-explore');
    expect(client.lastRequest?.tools?.map((t) => t.name) ?? []).not.toContain('handoff_to_bot');
    expect(client.lastRequest?.tools?.map((t) => t.name) ?? []).toContain('activate_skill');
  });

  test('activate_skill auto-runs without approval', async () => {
    const store = new MemoryChatStore();
    const bot = await store.ensurePrimaryBot();
    const chat = await store.getOrCreateChatForBot(bot.id);
    const memory = new MemoryMemorySkillStore();
    await memory.createSkill(bot.id, 'SQL style', 'Prefer concise SQL.');
    const client = new ScriptedClient([
      {
        content: null,
        toolCalls: [{ id: 'call_activate', name: 'activate_skill', arguments: { name: 'SQL style' } }],
      },
      { content: 'Following Prefer concise SQL.', toolCalls: [] },
    ]);
    const service = new ChatService({ store, client, memory });
    const result = await service.sendUserMessage(chat.id, 'use SQL style');
    expect(result.pendingApprovals).toHaveLength(0);
    expect(result.assistant?.content).toContain('Prefer concise SQL');
  });

  test('offers sql_query and runs it only after approval', async () => {
    const store = new MemoryChatStore();
    const bot = await store.ensurePrimaryBot();
    const chat = await store.getOrCreateChatForBot(bot.id);
    const calls: { statement: string; warehouseId: string }[] = [];
    const client = new ScriptedClient([
      {
        content: null,
        toolCalls: [{ id: 'call_sql', name: 'sql_query', arguments: { statement: 'SELECT 1' } }],
      },
      { content: 'one row', toolCalls: [] },
    ]);
    const service = new ChatService({
      store,
      client,
      sqlQuery: {
        warehouseId: 'wh-1',
        executeImpl: async (input) => {
          calls.push(input);
          return 'n\n1';
        },
      },
    });

    const pending = await service.sendUserMessage(chat.id, 'count');
    const sqlTool = client.requests[0]?.tools?.find((tool) => tool.name === 'sql_query');
    expect(sqlTool?.parameters).toMatchObject({ required: ['statement'] });
    expect(pending.pendingApprovals).toHaveLength(1);
    expect(pending.pendingApprovals[0]?.status).toBe('pending');
    expect(calls).toEqual([]);

    const continued = await service.decideApproval(pending.pendingApprovals[0].id, 'approved');
    expect(calls).toEqual([{ statement: 'SELECT 1', warehouseId: 'wh-1' }]);
    expect(continued.assistant?.content).toBe('one row');
    expect(continued.pendingApprovals).toHaveLength(0);
    const messages = await store.listMessages(chat.id);
    expect(messages.some((m) => m.role === 'tool' && m.content.includes('n\n1'))).toBe(true);
  });

  test('rejects non-select sql before approval or execute', async () => {
    const store = new MemoryChatStore();
    const bot = await store.ensurePrimaryBot();
    const chat = await store.getOrCreateChatForBot(bot.id);
    const calls: string[] = [];
    const client = new ScriptedClient([
      {
        content: null,
        toolCalls: [{ id: 'call_sql', name: 'sql_query', arguments: { statement: 'DROP TABLE t' } }],
      },
      { content: 'cannot drop', toolCalls: [] },
    ]);
    const service = new ChatService({
      store,
      client,
      sqlQuery: {
        warehouseId: 'wh-1',
        executeImpl: async () => {
          calls.push('ran');
          return 'nope';
        },
      },
    });

    const result = await service.sendUserMessage(chat.id, 'drop it');
    expect(result.pendingApprovals).toHaveLength(0);
    expect(result.assistant?.content).toBe('cannot drop');
    expect(calls).toEqual([]);
    expect(await service.getApprovals().listPending(chat.id)).toHaveLength(0);
    const messages = await store.listMessages(chat.id);
    expect(messages.some((m) => m.role === 'tool' && /only allows/i.test(m.content))).toBe(true);
  });

  test('returns a SQL config error after approval without throwing', async () => {
    const store = new MemoryChatStore();
    const bot = await store.ensurePrimaryBot();
    const chat = await store.getOrCreateChatForBot(bot.id);
    const client = new ScriptedClient([
      {
        content: null,
        toolCalls: [{ id: 'call_sql', name: 'sql_query', arguments: { statement: 'SELECT 1' } }],
      },
      { content: 'no warehouse', toolCalls: [] },
    ]);
    const service = new ChatService({ store, client });

    const pending = await service.sendUserMessage(chat.id, 'count rows');
    const continued = await service.decideApproval(pending.pendingApprovals[0].id, 'approved');
    expect(continued.assistant?.content).toBe('no warehouse');
    const messages = await store.listMessages(chat.id);
    expect(messages.some((m) => m.role === 'tool' && /Databricks workspace is not configured/i.test(m.content))).toBe(
      true
    );
  });

  test('does not execute sql_query when the approval is denied', async () => {
    const store = new MemoryChatStore();
    const bot = await store.ensurePrimaryBot();
    const chat = await store.getOrCreateChatForBot(bot.id);
    const calls: string[] = [];
    const client = new ScriptedClient([
      {
        content: null,
        toolCalls: [{ id: 'call_sql', name: 'sql_query', arguments: { statement: 'SELECT 1' } }],
      },
      { content: 'ok after user message', toolCalls: [] },
    ]);
    const service = new ChatService({
      store,
      client,
      sqlQuery: {
        warehouseId: 'wh-1',
        executeImpl: async () => {
          calls.push('ran');
          return 'n\n1';
        },
      },
    });

    const pending = await service.sendUserMessage(chat.id, 'count');
    const afterDeny = await service.decideApproval(pending.pendingApprovals[0].id, 'denied');
    expect(calls).toEqual([]);
    expect(client.requests).toHaveLength(1);
    expect(afterDeny.pendingApprovals).toEqual([]);
    expect(afterDeny.assistant?.toolCalls?.[0]?.name).toBe('sql_query');
    const messages = await store.listMessages(chat.id);
    expect(messages.some((m) => m.role === 'tool' && /User denied tool call/.test(m.content))).toBe(true);
    expect(await store.getBot(bot.id)).toEqual(expect.objectContaining({ presence: 'online' }));

    const resumed = await service.sendUserMessage(chat.id, 'try something else');
    expect(client.requests).toHaveLength(2);
    expect(resumed.assistant?.content).toBe('ok after user message');
  });

  test('primary hands off after approval and the target chat receives the brief', async () => {
    const store = new MemoryChatStore();
    const primary = await store.ensurePrimaryBot();
    const analyst = await store.createBot({
      name: 'Analyst',
      ownerId: primary.ownerId,
      spaceId: primary.spaceId,
    });
    const chat = await store.getOrCreateChatForBot(primary.id);
    const targetChat = await store.getOrCreateChatForBot(analyst.id);
    const client = new ScriptedClient([
      {
        content: null,
        toolCalls: [
          {
            id: 'call_hand',
            name: 'handoff_to_bot',
            arguments: { bot_id: analyst.id, brief: 'look at revenue' },
          },
        ],
      },
      // Teammate turn after handoff
      { content: 'Revenue is up 12%.', toolCalls: [] },
      // Primary continues with the teammate reply in the tool result
      { content: 'Analyst says revenue is up 12%.', toolCalls: [] },
    ]);
    const service = new ChatService({ store, client });

    const pending = await service.sendUserMessage(chat.id, 'ask the analyst');
    expect(client.requests[0]?.tools?.some((tool) => tool.name === 'handoff_to_bot')).toBe(true);
    expect(client.requests[0]?.messages[0]?.content).toContain(`Analyst (${analyst.id})`);
    expect(pending.pendingApprovals).toHaveLength(1);
    expect(pending.pendingApprovals[0]?.status).toBe('pending');
    expect(await store.listMessages(targetChat.id)).toEqual([]);

    const continued = await service.decideApproval(pending.pendingApprovals[0].id, 'approved');
    expect(continued.assistant?.content).toBe('Analyst says revenue is up 12%.');
    expect(client.requests).toHaveLength(3);
    const targetMessages = await store.listMessages(targetChat.id);
    expect(targetMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'user', content: 'From Primary: look at revenue' }),
        expect.objectContaining({ role: 'assistant', content: 'Revenue is up 12%.' }),
      ])
    );
    const source = await store.listMessages(chat.id);
    const threadNotice = [...source]
      .reverse()
      .find((message) => message.role === 'system' && message.content.includes('"thread"'));
    expect(threadNotice).toBeTruthy();
    expect(JSON.parse(threadNotice!.content)).toEqual(
      expect.objectContaining({
        kind: 'handoff',
        direction: 'thread',
        targetBotId: analyst.id,
        targetName: 'Analyst',
        brief: 'look at revenue',
        messageCount: 2,
        replyPreview: 'Revenue is up 12%.',
        threadBotId: analyst.id,
      })
    );
    const peerThread = targetMessages.find(
      (message) => message.role === 'system' && message.content.includes('"thread"')
    );
    expect(JSON.parse(peerThread!.content)).toEqual(
      expect.objectContaining({
        direction: 'thread',
        targetName: 'Primary',
        targetChatId: targetChat.id,
        messageCount: 2,
        replyPreview: 'Revenue is up 12%.',
        threadBotId: analyst.id,
      })
    );
  });

  test('posts thread chips on both chats when the nested teammate turn fails', async () => {
    const store = new MemoryChatStore();
    const primary = await store.ensurePrimaryBot();
    const analyst = await store.createBot({
      name: 'Analyst',
      ownerId: primary.ownerId,
      spaceId: primary.spaceId,
    });
    const chat = await store.getOrCreateChatForBot(primary.id);
    const targetChat = await store.getOrCreateChatForBot(analyst.id);
    const client = new ScriptedClient([
      {
        content: null,
        toolCalls: [
          {
            id: 'call_hand',
            name: 'handoff_to_bot',
            arguments: { bot_id: analyst.id, brief: 'look at revenue' },
          },
        ],
      },
      // Nested teammate turn throws
      new Error('Bot not found'),
      // Primary continues with the failed handoff result
      { content: 'Analyst could not answer.', toolCalls: [] },
    ]);
    const service = new ChatService({ store, client });

    const pending = await service.sendUserMessage(chat.id, 'ask the analyst');
    const continued = await service.decideApproval(pending.pendingApprovals[0].id, 'approved');
    expect(continued.assistant?.content).toBe('Analyst could not answer.');

    const targetMessages = await store.listMessages(targetChat.id);
    expect(targetMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'user', content: 'From Primary: look at revenue' }),
        expect.objectContaining({
          role: 'assistant',
          content: '(handoff failed) Bot not found',
        }),
      ])
    );
    const peerThread = targetMessages.find(
      (message) => message.role === 'system' && message.content.includes('"thread"')
    );
    expect(peerThread).toBeTruthy();
    expect(JSON.parse(peerThread!.content)).toEqual(
      expect.objectContaining({
        direction: 'thread',
        targetName: 'Primary',
        threadBotId: analyst.id,
        replyPreview: '(handoff failed) Bot not found',
      })
    );

    const source = await store.listMessages(chat.id);
    const threadNotice = [...source]
      .reverse()
      .find((message) => message.role === 'system' && message.content.includes('"thread"'));
    expect(threadNotice).toBeTruthy();
    expect(JSON.parse(threadNotice!.content)).toEqual(
      expect.objectContaining({
        direction: 'thread',
        targetName: 'Analyst',
        threadBotId: analyst.id,
        replyPreview: '(handoff failed) Bot not found',
      })
    );
  });

  test('does not deliver a handoff when approval is denied', async () => {
    const store = new MemoryChatStore();
    const primary = await store.ensurePrimaryBot();
    const analyst = await store.createBot({
      name: 'Analyst',
      ownerId: primary.ownerId,
      spaceId: primary.spaceId,
    });
    const chat = await store.getOrCreateChatForBot(primary.id);
    const targetChat = await store.getOrCreateChatForBot(analyst.id);
    const client = new ScriptedClient([
      {
        content: null,
        toolCalls: [{ id: 'call_hand', name: 'handoff_to_bot', arguments: { bot_id: analyst.id, brief: 'look' } }],
      },
      { content: 'staying here', toolCalls: [] },
    ]);
    const service = new ChatService({ store, client });

    const pending = await service.sendUserMessage(chat.id, 'hand it off');
    const afterDeny = await service.decideApproval(pending.pendingApprovals[0].id, 'denied');
    expect(client.requests).toHaveLength(1);
    expect(afterDeny.pendingApprovals).toEqual([]);
    expect(await store.listMessages(targetChat.id)).toEqual([]);
    const source = await store.listMessages(chat.id);
    expect(source.some((message) => message.role === 'system')).toBe(false);
    expect(source.some((message) => message.role === 'tool' && /User denied tool call/.test(message.content))).toBe(
      true
    );

    const resumed = await service.sendUserMessage(chat.id, 'stay with me');
    expect(client.requests).toHaveLength(2);
    expect(resumed.assistant?.content).toBe('staying here');
  });

  test('records an approval trail for request and decide', async () => {
    const store = new MemoryChatStore();
    const bot = await store.ensurePrimaryBot();
    const chat = await store.getOrCreateChatForBot(bot.id);
    const client = new ScriptedClient([
      {
        content: null,
        toolCalls: [{ id: 'call_sql', name: 'sql_query', arguments: { statement: 'SELECT 1' } }],
      },
      { content: 'done', toolCalls: [] },
    ]);
    const service = new ChatService({
      store,
      client,
      sqlQuery: { warehouseId: 'wh-1', executeImpl: async () => 'n\n1' },
    });

    const pending = await service.sendUserMessage(chat.id, 'count');
    const approvalId = pending.pendingApprovals[0].id;
    let events = await service.getApprovals().listEvents(chat.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(
      expect.objectContaining({
        type: 'requested',
        toolName: 'sql_query',
        approvalId,
        botId: bot.id,
        userId: chat.userId,
      })
    );

    await service.decideApproval(approvalId, 'once', { decidedBy: 'alice@example.com' });
    events = await service.getApprovals().listEvents(chat.id);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual(
      expect.objectContaining({
        type: 'decided',
        toolName: 'sql_query',
        approvalId,
        botId: bot.id,
        userId: chat.userId,
      })
    );
    expect(events[0]?.payload).toEqual(
      expect.objectContaining({
        decision: 'once',
        status: 'approved',
        decidedBy: 'alice@example.com',
        toolCallId: 'call_sql',
      })
    );
  });

  test('a non-primary bot cannot hand off', async () => {
    const store = new MemoryChatStore();
    const primary = await store.ensurePrimaryBot();
    const analyst = await store.createBot({
      name: 'Analyst',
      ownerId: primary.ownerId,
      spaceId: primary.spaceId,
    });
    const chat = await store.getOrCreateChatForBot(analyst.id);
    const targetChat = await store.getOrCreateChatForBot(primary.id);
    const client = new ScriptedClient([
      {
        content: null,
        toolCalls: [{ id: 'call_hand', name: 'handoff_to_bot', arguments: { bot_id: primary.id, brief: 'fan out' } }],
      },
      { content: 'cannot hand off', toolCalls: [] },
    ]);
    const service = new ChatService({ store, client });

    const result = await service.sendUserMessage(chat.id, 'delegate');
    expect(client.requests[0]?.tools?.some((tool) => tool.name === 'handoff_to_bot')).toBe(false);
    expect(result.pendingApprovals).toHaveLength(0);
    expect(result.assistant?.content).toBe('cannot hand off');
    expect(await store.listMessages(targetChat.id)).toEqual([]);
    const source = await store.listMessages(chat.id);
    expect(source.some((message) => message.role === 'tool' && /only the primary/i.test(message.content))).toBe(true);
  });

  test('refuses a handoff outside the Space before approval', async () => {
    const store = new MemoryChatStore();
    const primary = await store.ensurePrimaryBot();
    const other = await store.createSpace({ name: 'Other', ownerId: primary.ownerId });
    const analyst = await store.createBot({
      name: 'Analyst',
      ownerId: primary.ownerId,
      spaceId: other.id,
    });
    const chat = await store.getOrCreateChatForBot(primary.id);
    const targetChat = await store.getOrCreateChatForBot(analyst.id);
    const client = new ScriptedClient([
      {
        content: null,
        toolCalls: [{ id: 'call_hand', name: 'handoff_to_bot', arguments: { bot_id: analyst.id, brief: 'cross' } }],
      },
      { content: 'stayed in space', toolCalls: [] },
    ]);
    const service = new ChatService({ store, client });

    const result = await service.sendUserMessage(chat.id, 'send it over');
    expect(result.pendingApprovals).toHaveLength(0);
    expect(result.assistant?.content).toBe('stayed in space');
    expect(await store.listMessages(targetChat.id)).toEqual([]);
    const source = await store.listMessages(chat.id);
    expect(source.some((message) => message.role === 'tool' && /your Space/.test(message.content))).toBe(true);
  });

  test('auto-approves tool calls when user selects all_the_time', async () => {
    const store = new MemoryChatStore();
    const bot = await store.ensurePrimaryBot();
    const chat = await store.getOrCreateChatForBot(bot.id);
    const sqlCalls: string[] = [];

    const client = new ScriptedClient([
      // First turn: requests sql_query
      {
        content: null,
        toolCalls: [{ id: 'call_1', name: 'sql_query', arguments: { statement: 'SELECT 1' } }],
      },
      // First turn completion after approval
      { content: 'first query done', toolCalls: [] },
      // Second turn: requests sql_query again
      {
        content: null,
        toolCalls: [{ id: 'call_2', name: 'sql_query', arguments: { statement: 'SELECT 2' } }],
      },
      // Second turn completion (auto-executed!)
      { content: 'second query done', toolCalls: [] },
    ]);

    const service = new ChatService({
      store,
      client,
      sqlQuery: {
        warehouseId: 'wh-1',
        executeImpl: async (req) => {
          sqlCalls.push(req.statement);
          return 'ok';
        },
      },
    });

    // First turn: needs approval
    const turn1 = await service.sendUserMessage(chat.id, 'run first');
    expect(turn1.pendingApprovals).toHaveLength(1);
    expect(sqlCalls).toEqual([]);

    // Decide "all_the_time"
    const turn1Continued = await service.decideApproval(turn1.pendingApprovals[0].id, 'all_the_time');
    expect(turn1Continued.assistant?.content).toBe('first query done');
    expect(sqlCalls).toEqual(['SELECT 1']);
    expect(turn1Continued.autoApprovedTools).toContain('sql_query');

    // Second turn: should automatically execute sql_query without creating any pending approvals!
    const turn2 = await service.sendUserMessage(chat.id, 'run second');
    expect(turn2.pendingApprovals).toHaveLength(0);
    expect(turn2.assistant?.content).toBe('second query done');
    expect(sqlCalls).toEqual(['SELECT 1', 'SELECT 2']);
  });

  test('persists assistant tool_calls so the next completion is valid', async () => {
    const store = new MemoryChatStore();
    const bot = await store.ensurePrimaryBot();
    const chat = await store.getOrCreateChatForBot(bot.id);
    const client = new ScriptedClient([
      {
        content: null,
        toolCalls: [{ id: 'call_1', name: 'sql_query', arguments: { statement: 'SELECT 1' } }],
      },
      { content: 'done', toolCalls: [] },
    ]);
    const service = new ChatService({
      store,
      client,
      sqlQuery: {
        warehouseId: 'wh-1',
        executeImpl: async () => 'n\n1',
      },
    });

    const pending = await service.sendUserMessage(chat.id, 'run');
    expect(pending.assistant?.toolCalls).toEqual([
      { id: 'call_1', name: 'sql_query', arguments: { statement: 'SELECT 1' } },
    ]);

    await service.decideApproval(pending.pendingApprovals[0].id, 'once');
    const followUp = client.requests[1];
    const assistantWithTools = followUp.messages.find((m) => m.role === 'assistant' && (m.toolCalls?.length ?? 0) > 0);
    expect(assistantWithTools?.toolCalls?.[0]?.id).toBe('call_1');
    const toolMsg = followUp.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.toolCallId).toBe('call_1');
  });

  test('drops orphan tool messages that lack a matching assistant tool_calls', async () => {
    const store = new MemoryChatStore();
    const bot = await store.ensurePrimaryBot();
    const chat = await store.getOrCreateChatForBot(bot.id);
    await store.addMessage(chat.id, 'user', 'old turn');
    await store.addMessage(chat.id, 'tool', 'orphan result', { toolCallId: 'call_orphan' });

    const client = new ScriptedClient([{ content: 'recovered', toolCalls: [] }]);
    const service = new ChatService({ store, client });
    await service.sendUserMessage(chat.id, 'new turn');

    const sent = client.requests[0];
    expect(sent.messages.some((m) => m.role === 'tool')).toBe(false);
    expect(sent.messages.some((m) => m.content === 'orphan result')).toBe(false);
  });

  test('runs native lakehouse_catalog tool when approved', async () => {
    const store = new MemoryChatStore();
    const bot = await store.ensurePrimaryBot();
    const chat = await store.getOrCreateChatForBot(bot.id);
    const client = new ScriptedClient([
      {
        content: null,
        toolCalls: [{ id: 'call_cat', name: 'lakehouse_catalog', arguments: { action: 'list_catalogs' } }],
      },
      { content: 'catalogs listed', toolCalls: [] },
    ]);

    const service = new ChatService({
      store,
      client,
      sqlQuery: {
        warehouseId: 'wh-1',
        executeImpl: async () => 'catalog_name\nsamples\nmain',
      },
    });

    const pending = await service.sendUserMessage(chat.id, 'show catalogs');
    expect(pending.pendingApprovals).toHaveLength(1);
    expect(pending.pendingApprovals[0]?.toolCall.name).toBe('lakehouse_catalog');

    const continued = await service.decideApproval(pending.pendingApprovals[0].id, 'once');
    expect(continued.assistant?.content).toBe('catalogs listed');
    const messages = await store.listMessages(chat.id);
    expect(messages.some((m) => m.role === 'tool' && m.content.includes('samples'))).toBe(true);
  });

  test('Primary create_bot asks every time and lands a bot + greeting + chip', async () => {
    const store = new MemoryChatStore();
    const memory = new MemoryMemorySkillStore();
    const primary = await store.ensurePrimaryBot();
    const chat = await store.getOrCreateChatForBot(primary.id);
    const client = new ScriptedClient([
      {
        content: null,
        toolCalls: [
          {
            id: 'call_create',
            name: 'create_bot',
            arguments: { name: 'Probe', job: 'Validate create_bot flow' },
          },
        ],
      },
      { content: 'Created Probe for you.', toolCalls: [] },
    ]);
    const service = new ChatService({ store, client, memory });

    const pending = await service.sendUserMessage(chat.id, 'create a probe bot');
    expect(client.requests[0]?.tools?.some((tool) => tool.name === 'create_bot')).toBe(true);
    expect(pending.pendingApprovals).toHaveLength(1);
    expect(pending.pendingApprovals[0]?.toolCall.name).toBe('create_bot');

    // “Always allow” is coerced to once — create_bot never auto-approves.
    const continued = await service.decideApproval(pending.pendingApprovals[0].id, 'all_the_time');
    expect(continued.assistant?.content).toBe('Created Probe for you.');
    expect(await service.getApprovals().isAutoApproved(chat.id, 'create_bot')).toBe(false);

    const roster = await store.listBots({ ownerId: primary.ownerId });
    const probe = roster.find((bot) => bot.name === 'Probe');
    expect(probe).toBeTruthy();
    expect(probe?.spaceId).toBe(primary.spaceId);

    const probeChat = await store.getOrCreateChatForBot(probe!.id);
    const probeMessages = await store.listMessages(probeChat.id);
    expect(probeMessages[0]?.content).toContain("I'm Probe");

    const memories = await memory.listMemories(probe!.id);
    expect(memories.some((entry) => entry.key === 'job')).toBe(true);

    const source = await store.listMessages(chat.id);
    const notice = source.find((message) => message.role === 'system' && message.content.includes('bot_created'));
    expect(JSON.parse(notice!.content)).toEqual(
      expect.objectContaining({ kind: 'bot_created', name: 'Probe', botId: probe!.id })
    );
  });

  test('teammate does not receive create_bot in its tool list', async () => {
    const store = new MemoryChatStore();
    const primary = await store.ensurePrimaryBot();
    const analyst = await store.createBot({
      name: 'Analyst',
      ownerId: primary.ownerId,
      spaceId: primary.spaceId,
    });
    const chat = await store.getOrCreateChatForBot(analyst.id);
    const client = new ScriptedClient([{ content: 'no create tool', toolCalls: [] }]);
    const service = new ChatService({ store, client });

    await service.sendUserMessage(chat.id, 'can you create a bot?');
    expect(client.requests[0]?.tools?.some((tool) => tool.name === 'create_bot')).toBe(false);
    expect(client.requests[0]?.messages[0]?.content).toContain('cannot create bots');
  });

  test('schedule_routine asks first then creates a routine for the bot', async () => {
    const store = new MemoryChatStore();
    const routines = new MemoryRoutineStore();
    const bot = await store.ensurePrimaryBot();
    const chat = await store.getOrCreateChatForBot(bot.id);
    const service = new ChatService({
      store,
      routines,
      client: new ScriptedClient([
        {
          content: null,
          toolCalls: [
            {
              id: 'call_sched',
              name: 'schedule_routine',
              arguments: {
                name: 'Nightly',
                cron: '0 9 * * *',
                prompt: 'Check overnight jobs',
              },
            },
          ],
        },
        { content: 'Scheduled Nightly for you.', toolCalls: [] },
      ]),
    });

    const pending = await service.sendUserMessage(chat.id, 'schedule a morning check');
    expect(pending.pendingApprovals).toHaveLength(1);
    expect(pending.pendingApprovals[0]?.toolCall.name).toBe('schedule_routine');

    const continued = await service.decideApproval(pending.pendingApprovals[0].id, 'once');
    expect(continued.assistant?.content).toMatch(/Scheduled Nightly/i);

    const listed = await routines.listRoutines(bot.ownerId);
    expect(listed.some((r) => r.name === 'Nightly' && r.botId === bot.id)).toBe(true);

    const messages = await store.listMessages(chat.id);
    expect(messages.some((m) => m.role === 'system' && m.content.includes('[routine:Nightly] created'))).toBe(true);
    expect(
      messages.some((m) => m.role === 'tool' && m.toolCallId === 'call_sched' && m.content.includes('webhookSecret'))
    ).toBe(true);
  });

  test('ask_choice waits for approval then user pick before continuing', async () => {
    const store = new MemoryChatStore();
    const bot = await store.ensurePrimaryBot();
    const chat = await store.getOrCreateChatForBot(bot.id);
    const service = new ChatService({
      store,
      client: new ScriptedClient([
        {
          content: null,
          toolCalls: [
            {
              id: 'call_choice',
              name: 'ask_choice',
              arguments: { prompt: 'Pick env', options: ['prod', 'dev'] },
            },
          ],
        },
        { content: 'You picked prod', toolCalls: [] },
      ]),
    });

    const pending = await service.sendUserMessage(chat.id, 'which env?');
    expect(pending.pendingApprovals).toHaveLength(1);
    expect(pending.pendingApprovals[0]?.toolCall.name).toBe('ask_choice');
    expect((await store.getBot(bot.id))?.presence).toBe('waiting');

    const afterApproval = await service.decideApproval(pending.pendingApprovals[0].id, 'once');
    expect(afterApproval.pendingChoices).toHaveLength(1);
    expect(afterApproval.pendingApprovals).toHaveLength(0);
    const messagesAfterApproval = await store.listMessages(chat.id);
    expect(messagesAfterApproval.some((m) => m.role === 'system' && m.content.includes('"kind":"choice_prompt"'))).toBe(
      true
    );
    expect(messagesAfterApproval.some((m) => m.role === 'tool' && m.toolCallId === 'call_choice')).toBe(false);

    const choiceId = afterApproval.pendingChoices![0].id;
    const continued = await service.submitChoice(choiceId, 'prod');
    expect(continued.assistant?.content).toBe('You picked prod');
    expect(continued.pendingChoices).toHaveLength(0);
    const finalMessages = await store.listMessages(chat.id);
    expect(
      finalMessages.some(
        (m) => m.role === 'system' && m.content.includes('"kind":"choice_answer"') && m.content.includes('prod')
      )
    ).toBe(true);
    expect(
      finalMessages.some((m) => m.role === 'tool' && m.toolCallId === 'call_choice' && m.content.includes('prod'))
    ).toBe(true);
  });

  test('Primary bot in a shared Space discovers and hands off by name to a teammate created by another member', async () => {
    const store = new MemoryChatStore();
    const { space: spaceA, primary: primaryA } = await store.ensureBootstrap('user-a');
    await store.ensureBootstrap('user-b');
    await store.addSpaceMember(spaceA.id, 'user-b', 'member');

    const sharedTeammate = await store.createBot({
      name: 'DataWizard',
      spaceId: spaceA.id,
      ownerId: 'user-b',
      isShared: true,
    });

    const primaryChat = await store.getOrCreateChatForBot(primaryA.id);
    const client = new ScriptedClient([
      {
        content: null,
        toolCalls: [
          {
            id: 'call_shared_handoff',
            name: 'handoff_to_bot',
            arguments: { bot_name: 'DataWizard', brief: 'check shared metrics' },
          },
        ],
      },
      { content: 'Shared metrics are green.', toolCalls: [] },
      { content: 'DataWizard reports shared metrics are green.', toolCalls: [] },
    ]);
    const service = new ChatService({ store, client });

    const pending = await service.sendUserMessage(primaryChat.id, 'ask DataWizard');
    expect(client.requests[0]?.messages[0]?.content).toContain(`DataWizard (${sharedTeammate.id})`);
    expect(pending.pendingApprovals).toHaveLength(1);

    const continued = await service.decideApproval(pending.pendingApprovals[0].id, 'once');
    expect(continued.assistant?.content).toBe('DataWizard reports shared metrics are green.');
  });

  test('genie_ask is Ask-first and coerces all_the_time to once', async () => {
    const store = new MemoryChatStore();
    const bot = await store.ensurePrimaryBot();
    const chat = await store.getOrCreateChatForBot(bot.id);
    const client = new ScriptedClient([
      {
        content: null,
        toolCalls: [
          {
            id: 'call_genie',
            name: 'genie_ask',
            arguments: { question: 'What is churn rate?' },
          },
        ],
      },
      { content: 'Genie reports churn is 2%.', toolCalls: [] },
    ]);

    const service = new ChatService({
      store,
      client,
      systemAiMcp: {
        host: 'https://test.databricks.com',
        fetchImpl: (async () =>
          new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              result: {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      status: 'completed',
                      conversation_id: 'c1',
                      response_id: 'r1',
                      answer: 'Churn is 2%',
                    }),
                  },
                ],
              },
            })
          )) as typeof fetch,
      },
    });

    const pending = await service.sendUserMessage(chat.id, 'check churn');
    expect(client.requests[0]?.tools?.some((tool) => tool.name === 'genie_ask')).toBe(true);
    expect(pending.pendingApprovals).toHaveLength(1);
    expect(pending.pendingApprovals[0]?.toolCall.name).toBe('genie_ask');

    // Selecting all_the_time is coerced to once; genie_ask never persists auto-approval.
    const continued = await service.decideApproval(pending.pendingApprovals[0].id, 'all_the_time');
    expect(continued.assistant?.content).toBe('Genie reports churn is 2%.');
    expect(await service.getApprovals().isAutoApproved(chat.id, 'genie_ask')).toBe(false);
  });

  describe('ask_genie_space', () => {
    const genieSpace = {
      spaceId: '01abc',
      host: 'https://test.databricks.com',
      getToken: () => Promise.resolve('obo-token'),
    };
    const askGenie = { id: 'call_gs', name: 'ask_genie_space', arguments: { question: 'What is churn?' } };

    test('is not offered to the model or named in the prompt without a configured space', async () => {
      const store = new MemoryChatStore();
      const bot = await store.ensurePrimaryBot();
      const chat = await store.getOrCreateChatForBot(bot.id);
      const client = new ScriptedClient([{ content: 'ok', toolCalls: [] }]);

      await new ChatService({ store, client }).sendUserMessage(chat.id, 'hi');

      expect(client.lastRequest?.tools?.map((t) => t.name)).not.toContain('ask_genie_space');
      expect(client.lastRequest?.messages[0]?.content).not.toContain('ask_genie_space');
    });

    test('is offered with escalation-only prompt language when configured', async () => {
      const store = new MemoryChatStore();
      const bot = await store.ensurePrimaryBot();
      const chat = await store.getOrCreateChatForBot(bot.id);
      const client = new ScriptedClient([{ content: 'ok', toolCalls: [] }]);

      await new ChatService({ store, client, genieSpace }).sendUserMessage(chat.id, 'hi');

      expect(client.lastRequest?.tools?.map((t) => t.name)).toContain('ask_genie_space');
      expect(client.lastRequest?.messages[0]?.content).toContain('Prefer sql_query / lakehouse_catalog');
    });

    test('is Ask-first and never persists Always allow', async () => {
      const store = new MemoryChatStore();
      const bot = await store.ensurePrimaryBot();
      const chat = await store.getOrCreateChatForBot(bot.id);
      let fetched = 0;
      const client = new ScriptedClient([
        { content: null, toolCalls: [askGenie] },
        { content: 'Churn is 2%.', toolCalls: [] },
      ]);
      const service = new ChatService({
        store,
        client,
        genieSpace: {
          ...genieSpace,
          pollIntervalMs: 0,
          fetchImpl: ((input: string | URL) => {
            fetched += 1;
            return Promise.resolve(
              String(input).endsWith('/start-conversation')
                ? new Response(JSON.stringify({ conversation_id: 'c1', message_id: 'm1' }))
                : new Response(JSON.stringify({ status: 'COMPLETED', attachments: [] }))
            );
          }) as typeof fetch,
        },
      });

      const pending = await service.sendUserMessage(chat.id, 'churn?');
      expect(pending.pendingApprovals[0]?.toolCall.name).toBe('ask_genie_space');
      expect(fetched).toBe(0);

      const continued = await service.decideApproval(pending.pendingApprovals[0].id, 'all_the_time');
      expect(continued.assistant?.content).toBe('Churn is 2%.');
      expect(fetched).toBeGreaterThan(0);
      expect(await service.getApprovals().isAutoApproved(chat.id, 'ask_genie_space')).toBe(false);
    });

    test('handoff autoApproveAll does not bypass approval, even with a stale auto-approval', async () => {
      const store = new MemoryChatStore();
      const primary = await store.ensurePrimaryBot();
      const analyst = await store.createBot({ name: 'Analyst', ownerId: primary.ownerId, spaceId: primary.spaceId });
      const chat = await store.getOrCreateChatForBot(primary.id);
      const targetChat = await store.getOrCreateChatForBot(analyst.id);
      let fetched = 0;
      const client = new ScriptedClient([
        {
          content: null,
          toolCalls: [{ id: 'call_hand', name: 'handoff_to_bot', arguments: { bot_id: analyst.id, brief: 'churn' } }],
        },
        { content: null, toolCalls: [askGenie] },
        { content: 'Analyst is waiting for approval.', toolCalls: [] },
      ]);
      const service = new ChatService({
        store,
        client,
        genieSpace: {
          ...genieSpace,
          fetchImpl: (() => {
            fetched += 1;
            return Promise.resolve(new Response('{}'));
          }) as typeof fetch,
        },
      });
      await service.getApprovals().setAutoApproved(targetChat.id, 'ask_genie_space');

      const pending = await service.sendUserMessage(chat.id, 'ask the analyst');
      await service.decideApproval(pending.pendingApprovals[0].id, 'once');

      expect(fetched).toBe(0);
      const waiting = await service.getApprovals().listPending(targetChat.id);
      expect(waiting.map((approval) => approval.toolCall.name)).toEqual(['ask_genie_space']);
    });
  });

  test('offers each turn only the MCP connectors of the turn user (chat, routine, handoff)', async () => {
    const store = new MemoryChatStore();
    const { space, primary } = await store.ensureBootstrap('user-a');
    await store.ensureBootstrap('user-b');
    await store.addSpaceMember(space.id, 'user-b', 'member');
    const teammate = await store.createBot({
      name: 'DataWizard',
      spaceId: space.id,
      ownerId: 'user-a',
      isShared: true,
    });

    const mcpToolFor = (userId: string): RegisteredTool => ({
      definition: {
        name: `mcp_${userId.replace('-', '_')}_lookup`,
        description: `Connector owned by ${userId}`,
        parameters: { type: 'object', properties: {} },
      },
      execute: () => Promise.resolve('ok'),
    });
    const client = new ScriptedClient([
      { content: 'teammate for bob', toolCalls: [] },
      { content: 'routine for alice', toolCalls: [] },
      {
        content: null,
        toolCalls: [
          {
            id: 'call_handoff',
            name: 'handoff_to_bot',
            arguments: { bot_name: 'DataWizard', brief: 'check metrics' },
          },
        ],
      },
      { content: 'Metrics are green.', toolCalls: [] },
      { content: 'DataWizard says metrics are green.', toolCalls: [] },
    ]);
    const service = new ChatService({
      store,
      client,
      resolveMcpTools: (userId) => Promise.resolve([mcpToolFor(userId)]),
    });
    const offered = (index: number) => client.requests[index]?.tools?.map((tool) => tool.name) ?? [];

    // Bob chatting with Alice's shared bot gets Bob's connectors, never Alice's.
    const bobTeammateChat = await store.getOrCreateChatForBot(teammate.id, 'user-b');
    await service.sendUserMessage(bobTeammateChat.id, 'hi');
    expect(offered(0)).toContain('mcp_user_b_lookup');
    expect(offered(0)).not.toContain('mcp_user_a_lookup');

    // Routine turns run in the routine owner's chat, so they use the routine owner's connectors.
    const aliceTeammateChat = await store.getOrCreateChatForBot(teammate.id, 'user-a');
    await service.sendUserMessage(aliceTeammateChat.id, 'scheduled', { routine: true });
    expect(offered(1)).toContain('mcp_user_a_lookup');
    expect(offered(1)).not.toContain('mcp_user_b_lookup');

    // Handoff: the teammate's nested turn keeps the calling user's connectors.
    const bobPrimaryChat = await store.getOrCreateChatForBot(primary.id, 'user-b');
    const pending = await service.sendUserMessage(bobPrimaryChat.id, 'ask DataWizard');
    expect(offered(2)).toContain('mcp_user_b_lookup');
    await service.decideApproval(pending.pendingApprovals[0].id, 'once');
    expect(offered(3)).toContain('mcp_user_b_lookup');
    expect(offered(3)).not.toContain('mcp_user_a_lookup');
    expect(service.listToolNames('user-a')).not.toContain('mcp_user_b_lookup');
  });

  test('routine turns gate credentialed tools on the owner even when Always allow is on', async () => {
    const store = new MemoryChatStore();
    const bot = await store.ensurePrimaryBot();
    const chat = await store.getOrCreateChatForBot(bot.id);
    const executed: string[] = [];
    const client = new ScriptedClient([
      {
        content: null,
        toolCalls: [
          { id: 'call_sql', name: 'sql_query', arguments: { statement: 'SELECT 1' } },
          { id: 'call_mem', name: 'list_memories', arguments: {} },
        ],
      },
    ]);
    const service = new ChatService({
      store,
      client,
      sqlQuery: {
        warehouseId: 'wh-1',
        executeImpl: () => {
          executed.push('sql');
          return Promise.resolve('n\n1');
        },
      },
    });
    await service.getApprovals().setAutoApproved(chat.id, 'sql_query');

    const result = await runWithRoutineAuth('owner_approval', () =>
      service.sendUserMessage(chat.id, 'scheduled', { routine: true })
    );

    expect(result.pendingApprovals.map((a) => a.toolCall.name)).toEqual(['sql_query']);
    expect(executed).toEqual([]);
    const toolRows = (await store.listMessages(chat.id)).filter((m) => m.role === 'tool');
    expect(toolRows.map((m) => m.toolCallId)).toEqual(['call_mem']);
  });

  test('routine turns that run as the App identity keep normal approval rules', async () => {
    const store = new MemoryChatStore();
    const bot = await store.ensurePrimaryBot();
    const chat = await store.getOrCreateChatForBot(bot.id);
    const service = new ChatService({
      store,
      client: new ScriptedClient([
        { content: null, toolCalls: [{ id: 'call_sql', name: 'sql_query', arguments: { statement: 'SELECT 1' } }] },
        { content: 'done', toolCalls: [] },
      ]),
      sqlQuery: { warehouseId: 'wh-1', executeImpl: () => Promise.resolve('n\n1') },
    });
    await service.getApprovals().setAutoApproved(chat.id, 'sql_query');

    const result = await runWithRoutineAuth('app', () =>
      service.sendUserMessage(chat.id, 'scheduled', { routine: true })
    );

    expect(result.pendingApprovals).toEqual([]);
    expect(result.assistant?.content).toBe('done');
  });

  test('a routine turn without a user token does not cache an empty MCP connector list', async () => {
    const store = new MemoryChatStore();
    const bot = await store.ensurePrimaryBot();
    const chat = await store.getOrCreateChatForBot(bot.id);
    const listTools = ((_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const { id } = JSON.parse(init?.body as string) as { id: number };
      const result = { tools: [{ name: 'lookup', description: 'Look things up' }] };
      return Promise.resolve(new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { status: 200 }));
    }) as typeof fetch;
    const discovery = new McpDiscoveryService({
      host: 'https://workspace.cloud.databricks.com',
      getToken: createDatabricksTokenProvider({ env: {}, staticToken: 'pat' }),
      fetchImpl: listTools,
    });
    discovery.markDefaultConnected('main.tools.crm');
    const client = new ScriptedClient([
      { content: 'routine done', toolCalls: [] },
      { content: 'hi', toolCalls: [] },
    ]);
    const service = new ChatService({
      store,
      client,
      resolveMcpTools: (userId) => buildConnectedMcpTools(discovery, userId, discovery.getClientConfig()),
    });
    const offered = (index: number) => client.requests[index]?.tools?.map((tool) => tool.name) ?? [];

    await runWithRoutineAuth('owner_approval', () => service.sendUserMessage(chat.id, 'scheduled', { routine: true }));
    expect(offered(0)).not.toContain('mcp_main_tools_crm_lookup');

    await service.sendUserMessage(chat.id, 'hello');
    expect(offered(1)).toContain('mcp_main_tools_crm_lookup');
  });

  test('a routine-turn handoff still gates credentialed tools in the teammate chat', async () => {
    const store = new MemoryChatStore();
    const primary = await store.ensurePrimaryBot();
    const analyst = await store.createBot({ name: 'Analyst', ownerId: primary.ownerId, spaceId: primary.spaceId });
    const chat = await store.getOrCreateChatForBot(primary.id);
    const targetChat = await store.getOrCreateChatForBot(analyst.id);
    const executed: string[] = [];
    const geniePoll: RegisteredTool = {
      definition: { name: 'genie_poll_response', description: 'Poll Genie', parameters: { type: 'object' } },
      execute: () => {
        executed.push('genie');
        return Promise.resolve('ok');
      },
    };
    const client = new ScriptedClient([
      {
        content: null,
        toolCalls: [{ id: 'call_hand', name: 'handoff_to_bot', arguments: { bot_id: analyst.id, brief: 'count' } }],
      },
      {
        content: null,
        toolCalls: [
          { id: 'call_sql', name: 'sql_query', arguments: { statement: 'SELECT 1' } },
          { id: 'call_genie', name: 'genie_poll_response', arguments: {} },
        ],
      },
      { content: 'Analyst is waiting on approval.', toolCalls: [] },
    ]);
    const service = new ChatService({
      store,
      client,
      systemAiMcp: [geniePoll],
      sqlQuery: {
        warehouseId: 'wh-1',
        executeImpl: () => {
          executed.push('sql');
          return Promise.resolve('n\n1');
        },
      },
    });
    await service.getApprovals().setAutoApproved(chat.id, 'handoff_to_bot');

    await runWithRoutineAuth('owner_approval', () => service.sendUserMessage(chat.id, 'scheduled', { routine: true }));

    const pending = await service.getApprovals().listPending(targetChat.id);
    expect(pending.map((a) => a.toolCall.name).sort()).toEqual(['genie_poll_response', 'sql_query']);
    expect(executed).toEqual([]);
  });

  test("a routine-gated approval runs under the approver's OBO token", async () => {
    const store = new MemoryChatStore();
    const bot = await store.ensurePrimaryBot();
    const chat = await store.getOrCreateChatForBot(bot.id);
    const getToken = createDatabricksTokenProvider({
      env: { DATABRICKS_APP_NAME: 'bricksbot' },
      staticToken: 'app-pat',
    });
    const tokens: string[] = [];
    const service = new ChatService({
      store,
      client: new ScriptedClient([
        { content: null, toolCalls: [{ id: 'call_sql', name: 'sql_query', arguments: { statement: 'SELECT 1' } }] },
        { content: 'one row', toolCalls: [] },
      ]),
      sqlQuery: {
        warehouseId: 'wh-1',
        executeImpl: async () => {
          tokens.push(await getToken());
          return 'n\n1';
        },
      },
    });

    const gated = await runWithRoutineAuth('owner_approval', () =>
      service.sendUserMessage(chat.id, 'scheduled', { routine: true })
    );
    expect(gated.pendingApprovals.map((a) => a.toolCall.name)).toEqual(['sql_query']);

    const approver = { headers: { 'x-forwarded-access-token': 'obo-owner' } } as unknown as Request;
    const continued = await runWithDatabricksRequestAuth(approver, () =>
      service.decideApproval(gated.pendingApprovals[0].id, 'once')
    );

    expect(tokens).toEqual(['obo-owner']);
    expect(continued.assistant?.content).toBe('one row');
    const toolRow = (await store.listMessages(chat.id)).find((m) => m.toolCallId === 'call_sql');
    expect(toolRow?.content).toBe('n\n1');
  });
});
