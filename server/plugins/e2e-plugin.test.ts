import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { ChatClient, ChatCompletionResult } from '../../shared/agents/types.js';
import { MemoryChatStore } from '../chat/memory-store.js';
import { registerChatRoutes } from '../chat/routes.js';
import { ChatService } from '../chat/service.js';
import { PluginHost } from './host/plugin-host.js';
import { VolumePluginLoader } from './loaders/volume-loader.js';
import { MemoryPluginRegistryStore } from './registry/memory-store.js';
import { registerPluginRoutes } from './routes.js';

class E2EStubClient implements ChatClient {
  readonly provider = 'stub' as const;
  private queued: ChatCompletionResult[] = [];
  readonly recordedRequests: Array<{ messages: unknown[]; tools: unknown[] }> = [];

  enqueue(result: ChatCompletionResult): void {
    this.queued.push(result);
  }

  complete(req: { messages: unknown[]; tools: unknown[] }): Promise<ChatCompletionResult> {
    this.recordedRequests.push(req);
    const next: ChatCompletionResult | undefined = this.queued.shift();
    if (!next) {
      return Promise.resolve({ content: 'Default response', toolCalls: [] });
    }
    return Promise.resolve(next);
  }
}

describe('Plugin System End-to-End', () => {
  let tempVolumeDir: string;

  beforeEach(async () => {
    tempVolumeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bb-e2e-vol-'));
  });

  afterEach(async () => {
    await fs.rm(tempVolumeDir, { recursive: true, force: true });
  });

  test('end-to-end: Volume discovery -> HTTP registry -> Chat tool dispatch -> Approval -> Reload', async () => {
    // 1. Create a plugin directory in the volume root
    const pluginDir = path.join(tempVolumeDir, 'inventory-plugin');
    await fs.mkdir(pluginDir, { recursive: true });

    const pluginCode = `
export default {
  metadata: {
    name: 'inventory-plugin',
    version: '1.0.0',
    description: 'Warehouse inventory connector',
    author: 'Logistics Team',
  },
  promptSections: [
    {
      name: 'inventory-policy',
      render: () => 'System rule: Inventory queries must report real-time warehouse count.',
    },
  ],
  hooks: {
    beforeTool: async (toolName, args) => {
      if (args.sku === 'FORBIDDEN_SKU') {
        return { block: 'Security: Access to restricted military SKU is blocked.' };
      }
    },
    afterTool: async (toolName, result) => {
      return result.replace(/CONFIDENTIAL_LOC/g, '[REDACTED_LOCATION]');
    },
  },
  tools: [
    {
      name: 'check_inventory',
      description: 'Check item stock levels',
      parameters: { type: 'object', properties: { sku: { type: 'string' } } },
      execute: async (args) => {
        return JSON.stringify({
          sku: args.sku,
          stock: 42,
          location: 'CONFIDENTIAL_LOC_BAY_9',
        });
      },
    },
  ],
};
`;
    await fs.writeFile(path.join(pluginDir, 'index.mjs'), pluginCode, 'utf-8');

    // 2. Initialize application services
    const store = new MemoryChatStore();
    const { primary } = await store.ensureBootstrap('admin-user');
    const client = new E2EStubClient();
    const pluginHost = new PluginHost();
    const volumeLoader = new VolumePluginLoader({ volumeRoot: tempVolumeDir, host: pluginHost });
    const registryStore = new MemoryPluginRegistryStore();

    // 3. Perform initial load from volume
    const loadResult = await volumeLoader.loadAll();
    expect(loadResult.errors).toHaveLength(0);
    expect(loadResult.loaded).toHaveLength(1);
    expect(loadResult.loaded[0].name).toBe('inventory-plugin');

    const chatService = new ChatService({
      store,
      client,
      pluginHost,
    });

    // 4. Setup Express server with live HTTP routes
    const app = express();
    app.use(express.json());
    registerPluginRoutes(app, {
      pluginHost,
      volumeLoader,
      registryStore,
    });
    registerChatRoutes(app, store, chatService);

    const server = await new Promise<import('node:http').Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to bind server');
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      // 5. Query GET /api/plugins via HTTP
      const listRes = await fetch(`${baseUrl}/api/plugins`);
      expect(listRes.status).toBe(200);
      const listData = (await listRes.json()) as {
        plugins: Array<{
          metadata: { name: string; version: string };
          tools: Array<{ name: string; askFirst: boolean }>;
          promptSections: string[];
        }>;
      };
      expect(listData.plugins).toHaveLength(1);
      expect(listData.plugins[0].metadata.name).toBe('inventory-plugin');
      expect(listData.plugins[0].tools[0].name).toBe('check_inventory');
      expect(listData.plugins[0].tools[0].askFirst).toBe(true);
      expect(listData.plugins[0].promptSections).toContain('inventory-policy');

      // 6. User initiates chat turn triggering the tool
      const chat = await store.getOrCreateChatForBot(primary.id);

      client.enqueue({
        content: '',
        toolCalls: [
          {
            id: 'call_inv_1',
            name: 'check_inventory',
            arguments: { sku: 'SKU-WIDGET-01' },
          },
        ],
      });

      const userMsgRes = await fetch(`${baseUrl}/api/chats/${chat.id}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-email': 'admin-user',
        },
        body: JSON.stringify({ content: 'How many SKU-WIDGET-01 in stock?' }),
      });
      expect(userMsgRes.status).toBe(201);
      const userMsgData = (await userMsgRes.json()) as {
        pendingApprovals: Array<{ id: string; toolCall: { name: string } }>;
      };

      // 7. Verify Ask-first approval was created
      expect(userMsgData.pendingApprovals).toHaveLength(1);
      const approvalId = userMsgData.pendingApprovals[0].id;
      expect(userMsgData.pendingApprovals[0].toolCall.name).toBe('check_inventory');

      // 8. User approves the tool execution
      client.enqueue({
        content: 'There are 42 SKU-WIDGET-01 units in stock at [REDACTED_LOCATION].',
        toolCalls: [],
      });

      const approvalRes = await fetch(`${baseUrl}/api/approvals/${approvalId}/decide`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-email': 'admin-user',
        },
        body: JSON.stringify({ decision: 'once' }),
      });
      expect(approvalRes.status).toBe(200);
      const approvalData = (await approvalRes.json()) as {
        assistant: { content: string };
      };
      expect(approvalData.assistant.content).toBe('There are 42 SKU-WIDGET-01 units in stock at [REDACTED_LOCATION].');

      // Verify the redacted tool message in chat history
      const history = await store.listMessages(chat.id);
      const toolMsg = history.find((m) => m.role === 'tool' && m.toolCallId === 'call_inv_1');
      expect(toolMsg).toBeDefined();
      expect(toolMsg?.content).toContain('[REDACTED_LOCATION]');
      expect(toolMsg?.content).not.toContain('CONFIDENTIAL_LOC_BAY_9');

      // 9. Verify security guardrail blocks forbidden SKU
      client.enqueue({
        content: '',
        toolCalls: [
          {
            id: 'call_inv_bad',
            name: 'check_inventory',
            arguments: { sku: 'FORBIDDEN_SKU' },
          },
        ],
      });
      client.enqueue({
        content: 'Access denied: That item is classified.',
        toolCalls: [],
      });

      const badMsgRes = await fetch(`${baseUrl}/api/chats/${chat.id}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-email': 'admin-user',
        },
        body: JSON.stringify({ content: 'Check stock for FORBIDDEN_SKU' }),
      });
      expect(badMsgRes.status).toBe(201);

      const updatedHistory = await store.listMessages(chat.id);
      const blockedMsg = updatedHistory.find((m) => m.role === 'tool' && m.toolCallId === 'call_inv_bad');
      expect(blockedMsg).toBeDefined();
      expect(JSON.parse(blockedMsg!.content)).toEqual({
        error: 'Security: Access to restricted military SKU is blocked.',
        tool: 'check_inventory',
      });

      // 10. Call POST /api/plugins/reload via HTTP
      const reloadRes = await fetch(`${baseUrl}/api/plugins/reload`, { method: 'POST' });
      expect(reloadRes.status).toBe(200);
      const reloadData = (await reloadRes.json()) as { ok: boolean };
      expect(reloadData.ok).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
});
