import { describe, expect, test } from 'vitest';
import { DEFAULT_META_TOOL_NAMES } from '../../shared/agents/meta-tools.js';
import type { ChatClient, ChatCompletionRequest, ChatCompletionResult } from '../../shared/agents/types.js';
import { MemoryMemorySkillStore } from '../agents/memory/memory-store.js';
import { MemoryChatStore } from './memory-store.js';
import { ChatService } from './service.js';

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
    expect(result.assistant?.content).toMatch(/waiting for your approval/i);
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
    const approvalId = pending.pendingApprovals[0]!.id;

    // Avoid real network: temporarily stub fetch via global in execute path —
    // ChatService uses createWebFetchTool which calls global fetch.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response('page body', { status: 200 })) as typeof fetch;

    try {
      const continued = await service.decideApproval(approvalId, 'approved');
      expect(continued.assistant?.content).toBe('fetched summary');
      expect(continued.pendingApprovals).toHaveLength(0);
      const messages = await store.listMessages(chat.id);
      expect(messages.some((m) => m.role === 'tool' && m.content.includes('page body'))).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
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
      expect.arrayContaining(['handoff_to_bot', 'activate_skill', 'list_memories']),
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

    const continued = await service.decideApproval(pending.pendingApprovals[0]!.id, 'approved');
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

  test('returns a warehouse error after approval without throwing', async () => {
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
    const continued = await service.decideApproval(pending.pendingApprovals[0]!.id, 'approved');
    expect(continued.assistant?.content).toBe('no warehouse');
    const messages = await store.listMessages(chat.id);
    expect(messages.some((m) => m.role === 'tool' && /warehouse_id is required/i.test(m.content))).toBe(true);
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
      { content: 'denied', toolCalls: [] },
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
    const continued = await service.decideApproval(pending.pendingApprovals[0]!.id, 'denied');
    expect(calls).toEqual([]);
    expect(continued.assistant?.content).toBe('denied');
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

    const continued = await service.decideApproval(pending.pendingApprovals[0]!.id, 'approved');
    expect(continued.assistant?.content).toBe('Analyst says revenue is up 12%.');
    expect(client.requests).toHaveLength(3);
    const targetMessages = await store.listMessages(targetChat.id);
    expect(targetMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'user', content: 'From Primary: look at revenue' }),
        expect.objectContaining({ role: 'assistant', content: 'Revenue is up 12%.' }),
      ]),
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
      }),
    );
    const peerThread = targetMessages.find(
      (message) => message.role === 'system' && message.content.includes('"thread"'),
    );
    expect(JSON.parse(peerThread!.content)).toEqual(
      expect.objectContaining({
        direction: 'thread',
        targetName: 'Primary',
        targetChatId: targetChat.id,
        messageCount: 2,
        replyPreview: 'Revenue is up 12%.',
        threadBotId: analyst.id,
      }),
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
    const continued = await service.decideApproval(pending.pendingApprovals[0]!.id, 'approved');
    expect(continued.assistant?.content).toBe('Analyst could not answer.');

    const targetMessages = await store.listMessages(targetChat.id);
    expect(targetMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'user', content: 'From Primary: look at revenue' }),
        expect.objectContaining({
          role: 'assistant',
          content: '(handoff failed) Bot not found',
        }),
      ]),
    );
    const peerThread = targetMessages.find(
      (message) => message.role === 'system' && message.content.includes('"thread"'),
    );
    expect(peerThread).toBeTruthy();
    expect(JSON.parse(peerThread!.content)).toEqual(
      expect.objectContaining({
        direction: 'thread',
        targetName: 'Primary',
        threadBotId: analyst.id,
        replyPreview: '(handoff failed) Bot not found',
      }),
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
      }),
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
    const continued = await service.decideApproval(pending.pendingApprovals[0]!.id, 'denied');
    expect(continued.assistant?.content).toBe('staying here');
    expect(await store.listMessages(targetChat.id)).toEqual([]);
    const source = await store.listMessages(chat.id);
    expect(source.some((message) => message.role === 'system')).toBe(false);
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
    const turn1Continued = await service.decideApproval(turn1.pendingApprovals[0]!.id, 'all_the_time');
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

    await service.decideApproval(pending.pendingApprovals[0]!.id, 'once');
    const followUp = client.requests[1]!;
    const assistantWithTools = followUp.messages.find(
      (m) => m.role === 'assistant' && (m.toolCalls?.length ?? 0) > 0,
    );
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

    const sent = client.requests[0]!;
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

    const continued = await service.decideApproval(pending.pendingApprovals[0]!.id, 'once');
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
    const continued = await service.decideApproval(pending.pendingApprovals[0]!.id, 'all_the_time');
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
    const notice = source.find(
      (message) => message.role === 'system' && message.content.includes('bot_created'),
    );
    expect(JSON.parse(notice!.content)).toEqual(
      expect.objectContaining({ kind: 'bot_created', name: 'Probe', botId: probe!.id }),
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
});
