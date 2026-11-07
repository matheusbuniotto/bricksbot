import { describe, expect, test } from 'vitest';
import type { ChatClient, ChatCompletionResult } from '../../shared/agents/types.js';
import { MemoryChatStore } from '../chat/memory-store.js';
import { ChatService } from '../chat/service.js';
import { PluginHost } from './host/plugin-host.js';

class StubClient implements ChatClient {
  readonly provider = 'stub' as const;
  private queued: ChatCompletionResult[] = [];
  readonly recordedCompletions: Array<{ messages: unknown[]; tools: unknown[] }> = [];

  enqueue(result: ChatCompletionResult): void {
    this.queued.push(result);
  }

  complete(req: { messages: unknown[]; tools: unknown[] }): Promise<ChatCompletionResult> {
    this.recordedCompletions.push(req);
    const next: ChatCompletionResult | undefined = this.queued.shift();
    if (!next) {
      return Promise.resolve({
        content: 'default stub reply',
        toolCalls: [],
      });
    }
    return Promise.resolve(next);
  }
}

describe('ChatService + PluginHost integration', () => {
  test('plugin tools are offered in completion tool list', async () => {
    const store = new MemoryChatStore();
    const client = new StubClient();
    const pluginHost = new PluginHost();

    await pluginHost.registerPlugin({
      metadata: { name: 'salesforce-plugin', version: '1.0.0', description: 'CRM integration' },
      tools: [
        {
          name: 'get_contact',
          description: 'Fetch CRM contact',
          parameters: { type: 'object' },
          execute: () => Promise.resolve(JSON.stringify({ name: 'Alice' })),
        },
      ],
    });

    const service = new ChatService({ store, client, pluginHost });
    const space = await store.createSpace({ name: 'CRM Space' });
    const bot = await store.createBot({ name: 'CRM Bot', spaceId: space.id });
    const chat = await store.getOrCreateChatForBot(bot.id);

    client.enqueue({ content: 'Hello there', toolCalls: [] });
    await service.sendUserMessage(chat.id, 'Hi');

    expect(client.recordedCompletions).toHaveLength(1);
    const offeredTools = client.recordedCompletions[0].tools as Array<{ name: string }>;
    expect(offeredTools.some((t) => t.name === 'get_contact')).toBe(true);
  });

  test('external plugin tools require Ask-first approval by default', async () => {
    const store = new MemoryChatStore();
    const client = new StubClient();
    const pluginHost = new PluginHost();

    let executed = false;
    await pluginHost.registerPlugin({
      metadata: { name: 'sap-plugin', version: '1.0.0', description: 'ERP' },
      tools: [
        {
          name: 'post_order',
          description: 'Post SAP order',
          parameters: { type: 'object' },
          execute: () => {
            executed = true;
            return Promise.resolve(JSON.stringify({ status: 'posted' }));
          },
        },
      ],
    });

    const service = new ChatService({ store, client, pluginHost });
    const space = await store.createSpace({ name: 'ERP Space' });
    const bot = await store.createBot({ name: 'ERP Bot', spaceId: space.id });
    const chat = await store.getOrCreateChatForBot(bot.id);

    client.enqueue({
      content: '',
      toolCalls: [{ id: 'call_1', name: 'post_order', arguments: { orderId: 'PO-99' } }],
    });

    const result = await service.sendUserMessage(chat.id, 'Place order PO-99');
    expect(result.pendingApprovals).toHaveLength(1);
    expect(result.pendingApprovals[0].toolCall.name).toBe('post_order');
    expect(executed).toBe(false);

    client.enqueue({ content: 'Order PO-99 has been placed.', toolCalls: [] });
    const afterApproval = await service.decideApproval(result.pendingApprovals[0].id, 'once');
    expect(executed).toBe(true);
    expect(afterApproval.assistant?.content).toBe('Order PO-99 has been placed.');
  });

  test('read-only plugin tools auto-execute without approval', async () => {
    const store = new MemoryChatStore();
    const client = new StubClient();
    const pluginHost = new PluginHost();

    let executed = false;
    await pluginHost.registerPlugin({
      metadata: { name: 'lookup-plugin', version: '1.0.0', description: 'Read only lookups' },
      tools: [
        {
          name: 'lookup_sku',
          description: 'Lookup item details',
          parameters: { type: 'object' },
          annotations: { readOnly: true },
          execute: (args) => {
            executed = true;
            return Promise.resolve(JSON.stringify({ sku: args.sku, inStock: true }));
          },
        },
      ],
    });

    const service = new ChatService({ store, client, pluginHost });
    const space = await store.createSpace({ name: 'Stock Space' });
    const bot = await store.createBot({ name: 'Stock Bot', spaceId: space.id });
    const chat = await store.getOrCreateChatForBot(bot.id);

    client.enqueue({
      content: '',
      toolCalls: [{ id: 'call_lookup', name: 'lookup_sku', arguments: { sku: 'SKU-100' } }],
    });
    client.enqueue({ content: 'SKU-100 is in stock.', toolCalls: [] });

    const result = await service.sendUserMessage(chat.id, 'Check SKU-100');
    expect(executed).toBe(true);
    expect(result.pendingApprovals).toHaveLength(0);
    expect(result.assistant?.content).toBe('SKU-100 is in stock.');
  });

  test('plugin tool with neverAlwaysAllow coerces all_the_time to once', async () => {
    const store = new MemoryChatStore();
    const client = new StubClient();
    const pluginHost = new PluginHost();

    await pluginHost.registerPlugin({
      metadata: { name: 'strict-plugin', version: '1.0.0', description: 'Strict operations' },
      tools: [
        {
          name: 'drop_external_table',
          description: 'Drop table in external DB',
          parameters: { type: 'object' },
          neverAlwaysAllow: true,
          execute: () => Promise.resolve('dropped'),
        },
      ],
    });

    const service = new ChatService({ store, client, pluginHost });
    const space = await store.createSpace({ name: 'DB Space' });
    const bot = await store.createBot({ name: 'DB Bot', spaceId: space.id });
    const chat = await store.getOrCreateChatForBot(bot.id);

    client.enqueue({
      content: '',
      toolCalls: [{ id: 'call_drop', name: 'drop_external_table', arguments: { table: 'customers' } }],
    });

    const initial = await service.sendUserMessage(chat.id, 'Drop customers table');
    expect(initial.pendingApprovals).toHaveLength(1);

    client.enqueue({ content: 'Table dropped.', toolCalls: [] });
    await service.decideApproval(initial.pendingApprovals[0].id, 'all_the_time');

    client.enqueue({
      content: '',
      toolCalls: [{ id: 'call_drop_2', name: 'drop_external_table', arguments: { table: 'orders' } }],
    });
    const secondTurn = await service.sendUserMessage(chat.id, 'Drop orders table');
    expect(secondTurn.pendingApprovals).toHaveLength(1);
    expect(secondTurn.pendingApprovals[0].toolCall.name).toBe('drop_external_table');
  });

  test('beforeTool hook blocks unauthorized tool call', async () => {
    const store = new MemoryChatStore();
    const client = new StubClient();
    const pluginHost = new PluginHost();

    await pluginHost.registerPlugin({
      metadata: { name: 'firewall-plugin', version: '1.0.0', description: 'Tool call firewall' },
      hooks: {
        beforeTool: (_toolName, args) => {
          if (args.action === 'forbidden') {
            return Promise.resolve({ block: 'Security policy: forbidden action blocked.' });
          }
          return Promise.resolve();
        },
      },
      tools: [
        {
          name: 'sensitive_tool',
          description: 'Sensitive operation',
          parameters: { type: 'object' },
          execute: () => Promise.resolve('executed'),
        },
      ],
    });

    const service = new ChatService({ store, client, pluginHost });
    const space = await store.createSpace({ name: 'Sec Space' });
    const bot = await store.createBot({ name: 'Sec Bot', spaceId: space.id });
    const chat = await store.getOrCreateChatForBot(bot.id);

    client.enqueue({
      content: '',
      toolCalls: [{ id: 'call_sec', name: 'sensitive_tool', arguments: { action: 'forbidden' } }],
    });
    client.enqueue({ content: 'Action was blocked by policy.', toolCalls: [] });

    await service.sendUserMessage(chat.id, 'Run forbidden action');

    const messages = await store.listMessages(chat.id);
    const toolMsg = messages.find((m) => m.role === 'tool' && m.toolCallId === 'call_sec');
    expect(toolMsg).toBeDefined();
    expect(JSON.parse(toolMsg!.content)).toEqual({
      error: 'Security policy: forbidden action blocked.',
      tool: 'sensitive_tool',
    });
  });

  test('afterTool hook redacts sensitive output and prompt sections are injected', async () => {
    const store = new MemoryChatStore();
    const client = new StubClient();
    const pluginHost = new PluginHost();

    await pluginHost.registerPlugin({
      metadata: { name: 'redactor-plugin', version: '1.0.0', description: 'Redaction and guidelines' },
      promptSections: [
        {
          name: 'compliance-header',
          render: () => 'Compliance policy: Never disclose internal account numbers.',
        },
      ],
      hooks: {
        afterTool: (_tool, result) => {
          return Promise.resolve(result.replace(/ACC-\d+/g, '[REDACTED_ACC]'));
        },
      },
      tools: [
        {
          name: 'get_account',
          description: 'Get account info',
          parameters: { type: 'object' },
          annotations: { readOnly: true },
          execute: () => Promise.resolve('Account details: ACC-998877 active'),
        },
      ],
    });

    const service = new ChatService({ store, client, pluginHost });
    const space = await store.createSpace({ name: 'Audit Space' });
    const bot = await store.createBot({ name: 'Audit Bot', spaceId: space.id });
    const chat = await store.getOrCreateChatForBot(bot.id);

    client.enqueue({
      content: '',
      toolCalls: [{ id: 'call_acc', name: 'get_account', arguments: {} }],
    });
    client.enqueue({ content: 'Account is active.', toolCalls: [] });

    await service.sendUserMessage(chat.id, 'Fetch account');

    const firstCompletion = client.recordedCompletions[0];
    const systemPrompt = (firstCompletion.messages as Array<{ role: string; content: string }>).find(
      (m) => m.role === 'system'
    )?.content;
    expect(systemPrompt).toContain('Compliance policy: Never disclose internal account numbers.');

    const messages = await store.listMessages(chat.id);
    const toolMsg = messages.find((m) => m.role === 'tool' && m.toolCallId === 'call_acc');
    expect(toolMsg?.content).toBe('Account details: [REDACTED_ACC] active');
  });

  test('beforeTurn injects system prompt and afterTurn fires on finish', async () => {
    const store = new MemoryChatStore();
    const client = new StubClient();
    const pluginHost = new PluginHost();
    let afterTurnCount = 0;

    await pluginHost.registerPlugin({
      metadata: { name: 'turn-tracker', version: '1.0.0', description: 'Turn tracker' },
      hooks: {
        beforeTurn: () =>
          Promise.resolve({
            injectSystemPrompt: 'Dynamic context: High-priority customer turn.',
          }),
        afterTurn: () => {
          afterTurnCount += 1;
          return Promise.resolve();
        },
      },
    });

    const service = new ChatService({ store, client, pluginHost });
    const space = await store.createSpace({ name: 'Track Space' });
    const bot = await store.createBot({ name: 'Track Bot', spaceId: space.id });
    const chat = await store.getOrCreateChatForBot(bot.id);

    client.enqueue({ content: 'Turn reply', toolCalls: [] });
    await service.sendUserMessage(chat.id, 'Customer question');

    expect(client.recordedCompletions).toHaveLength(1);
    const msgs = client.recordedCompletions[0].messages as Array<{ role: string; content: string }>;
    const injected = msgs.find((m) => m.role === 'system' && m.content === 'Dynamic context: High-priority customer turn.');
    expect(injected).toBeDefined();
    expect(afterTurnCount).toBe(1);
  });
});
