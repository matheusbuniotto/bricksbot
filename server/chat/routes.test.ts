import express from 'express';
import { describe, expect, test } from 'vitest';
import { StubChatClient } from '../agents/clients/stub-client.js';
import { MemoryIdempotencyStore } from '../durable/idempotency-store.js';
import { MemoryChatStore } from './memory-store.js';
import { registerChatRoutes } from './routes.js';
import { ChatService } from './service.js';

async function withChatApp(
  run: (baseUrl: string, ctx: { store: MemoryChatStore; service: ChatService }) => Promise<void>,
  options?: Parameters<typeof registerChatRoutes>[3]
) {
  const store = new MemoryChatStore();
  const service = new ChatService({ store, client: new StubChatClient(), idempotency: new MemoryIdempotencyStore() });
  const app = express();
  app.use(express.json());
  registerChatRoutes(app, store, service, options);

  const server = await new Promise<import('node:http').Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind test server');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await run(baseUrl, { store, service });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

describe('chat HTTP API', () => {
  test('bootstraps spaces, creates a bot, and chats', async () => {
    await withChatApp(async (baseUrl) => {
      const spacesRes = await fetch(`${baseUrl}/api/spaces`);
      expect(spacesRes.status).toBe(200);
      const { spaces } = (await spacesRes.json()) as {
        spaces: Array<{ id: string; name: string }>;
      };
      expect(spaces[0]?.name).toBe('Personal');

      const createBot = await fetch(`${baseUrl}/api/bots`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Analyst', spaceId: spaces[0].id }),
      });
      expect(createBot.status).toBe(201);
      const { bot } = (await createBot.json()) as { bot: { id: string; name: string } };
      expect(bot.name).toBe('Analyst');

      const botsRes = await fetch(`${baseUrl}/api/bots?spaceId=${spaces[0].id}`);
      const { bots } = (await botsRes.json()) as { bots: Array<{ name: string }> };
      expect(bots.map((b) => b.name).sort()).toEqual(['Analyst', 'Primary']);

      const chatRes = await fetch(`${baseUrl}/api/bots/${bot.id}/chat`);
      const { chat } = (await chatRes.json()) as { chat: { id: string } };
      const postRes = await fetch(`${baseUrl}/api/chats/${chat.id}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'hi analyst' }),
      });
      expect(postRes.status).toBe(201);
      const body = (await postRes.json()) as { assistant: { content: string } };
      expect(body.assistant.content).toContain('hi analyst');
    });
  });

  test('rejects empty message bodies', async () => {
    await withChatApp(async (baseUrl) => {
      const botsRes = await fetch(`${baseUrl}/api/bots`);
      const { bots } = (await botsRes.json()) as { bots: Array<{ id: string }> };
      const chatRes = await fetch(`${baseUrl}/api/bots/${bots[0].id}/chat`);
      const { chat } = (await chatRes.json()) as { chat: { id: string } };

      const postRes = await fetch(`${baseUrl}/api/chats/${chat.id}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: '  ' }),
      });
      expect(postRes.status).toBe(400);
    });
  });

  test('handles auto-approvals query and revocation endpoints', async () => {
    await withChatApp(async (baseUrl) => {
      const botsRes = await fetch(`${baseUrl}/api/bots`);
      const { bots } = (await botsRes.json()) as { bots: Array<{ id: string }> };
      const chatRes = await fetch(`${baseUrl}/api/bots/${bots[0].id}/chat`);
      const { chat, autoApprovedTools } = (await chatRes.json()) as {
        chat: { id: string };
        autoApprovedTools: string[];
      };
      expect(autoApprovedTools).toEqual([]);

      const listRes = await fetch(`${baseUrl}/api/chats/${chat.id}/approvals/auto`);
      expect(listRes.status).toBe(200);
      expect(await listRes.json()).toEqual({ autoApprovedTools: [] });

      const revokeRes = await fetch(`${baseUrl}/api/chats/${chat.id}/approvals/auto/sql_query`, {
        method: 'DELETE',
      });
      expect(revokeRes.status).toBe(200);
    });
  });

  test('supports bot rename, move, archive, and delete', async () => {
    await withChatApp(async (baseUrl) => {
      const spacesRes = await fetch(`${baseUrl}/api/spaces`);
      const { spaces } = (await spacesRes.json()) as { spaces: Array<{ id: string }> };
      const createSpace = await fetch(`${baseUrl}/api/spaces`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Code' }),
      });
      const { space: code } = (await createSpace.json()) as { space: { id: string } };

      const createBot = await fetch(`${baseUrl}/api/bots`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Analyst', spaceId: spaces[0].id }),
      });
      const { bot } = (await createBot.json()) as { bot: { id: string } };

      const rename = await fetch(`${baseUrl}/api/bots/${bot.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Fraud Analyst' }),
      });
      expect(rename.status).toBe(200);
      expect(((await rename.json()) as { bot: { name: string } }).bot.name).toBe('Fraud Analyst');

      const moved = await fetch(`${baseUrl}/api/bots/${bot.id}/move`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ spaceId: code.id, index: 0 }),
      });
      expect(moved.status).toBe(200);
      expect(((await moved.json()) as { bot: { spaceId: string } }).bot.spaceId).toBe(code.id);

      const archived = await fetch(`${baseUrl}/api/bots/${bot.id}/archive`, { method: 'POST' });
      expect(archived.status).toBe(200);
      const hidden = await fetch(`${baseUrl}/api/bots?archived=archived`);
      expect(((await hidden.json()) as { bots: Array<{ id: string }> }).bots.map((row) => row.id)).toContain(bot.id);

      const restored = await fetch(`${baseUrl}/api/bots/${bot.id}/unarchive`, { method: 'POST' });
      expect(restored.status).toBe(200);

      const deleted = await fetch(`${baseUrl}/api/bots/${bot.id}`, { method: 'DELETE' });
      expect(deleted.status).toBe(204);
    });
  });

  test('isolates per-user chats on the same bot via HTTP headers', async () => {
    await withChatApp(async (baseUrl) => {
      const spaceRes = await fetch(`${baseUrl}/api/spaces`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-user': 'user-a' },
        body: JSON.stringify({ name: 'Shared' }),
      });
      const { space } = (await spaceRes.json()) as { space: { id: string } };
      await fetch(`${baseUrl}/api/spaces/${space.id}/members`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-user': 'user-a' },
        body: JSON.stringify({ userId: 'user-b', role: 'member' }),
      });

      const botRes = await fetch(`${baseUrl}/api/bots`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-user': 'user-a' },
        body: JSON.stringify({ name: 'Analyst', spaceId: space.id, isShared: true }),
      });
      const { bot } = (await botRes.json()) as { bot: { id: string } };

      const chatARes = await fetch(`${baseUrl}/api/bots/${bot.id}/chat`, {
        headers: { 'x-forwarded-user': 'user-a' },
      });
      const { chat: chatA } = (await chatARes.json()) as { chat: { id: string } };

      const chatBRes = await fetch(`${baseUrl}/api/bots/${bot.id}/chat`, {
        headers: { 'x-forwarded-user': 'user-b' },
      });
      const { chat: chatB } = (await chatBRes.json()) as { chat: { id: string } };
      expect(chatA.id).not.toBe(chatB.id);

      await fetch(`${baseUrl}/api/chats/${chatA.id}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-user': 'user-a' },
        body: JSON.stringify({ content: 'hello from user-a' }),
      });

      const reloadB = await fetch(`${baseUrl}/api/bots/${bot.id}/chat`, {
        headers: { 'x-forwarded-user': 'user-b' },
      });
      const { messages: messagesB } = (await reloadB.json()) as { messages: unknown[] };
      expect(messagesB).toHaveLength(0);

      const botsBRes = await fetch(`${baseUrl}/api/bots`, {
        headers: { 'x-forwarded-user': 'user-b' },
      });
      const { bots: botsB } = (await botsBRes.json()) as {
        bots: Array<{ id: string; lastPreview?: string }>;
      };
      expect(botsB.find((b) => b.id === bot.id)?.lastPreview).toBe('');

      const crossPostRes = await fetch(`${baseUrl}/api/chats/${chatA.id}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-user': 'user-b' },
        body: JSON.stringify({ content: 'malicious injection' }),
      });
      expect(crossPostRes.status).toBe(403);

      const crossAutoRes = await fetch(`${baseUrl}/api/chats/${chatA.id}/approvals/auto`, {
        headers: { 'x-forwarded-user': 'user-b' },
      });
      expect(crossAutoRes.status).toBe(403);
    });
  });

  test('supports personal-first bots and Workspace Marketplace publish + install flow', async () => {
    await withChatApp(async (baseUrl, { service }) => {
      const createRes = await fetch(`${baseUrl}/api/bots`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-user': 'alice' },
        body: JSON.stringify({
          name: 'FinOps Guru',
          avatarLabel: '1.2.0.0',
          description: 'Audits DBU spend across workspaces.',
        }),
      });
      expect(createRes.status).toBe(201);
      const { bot: sourceBot } = (await createRes.json()) as {
        bot: { id: string; isShared: boolean; description: string };
      };
      expect(sourceBot.isShared).toBe(false);
      expect(sourceBot.description).toBe('Audits DBU spend across workspaces.');

      await service.getMemory().upsertSkill(sourceBot.id, 'dbu-audit', '# DBU Audit steps');
      await service.getMemory().upsertMemory(sourceBot.id, 'secret-token', 'private-owner-note');

      const chatAliceRes = await fetch(`${baseUrl}/api/bots/${sourceBot.id}/chat`, {
        headers: { 'x-forwarded-user': 'alice' },
      });
      const { chat: aliceChat } = (await chatAliceRes.json()) as { chat: { id: string } };
      await fetch(`${baseUrl}/api/chats/${aliceChat.id}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-user': 'alice' },
        body: JSON.stringify({ content: 'my private chat message' }),
      });

      const emptyMarket = await fetch(`${baseUrl}/api/marketplace/bots`, {
        headers: { 'x-forwarded-user': 'bob' },
      });
      expect(((await emptyMarket.json()) as { bots: unknown[] }).bots).toEqual([]);

      const forbiddenShare = await fetch(`${baseUrl}/api/bots/${sourceBot.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-forwarded-user': 'bob' },
        body: JSON.stringify({ isShared: true }),
      });
      expect(forbiddenShare.status).toBe(403);

      const shareRes = await fetch(`${baseUrl}/api/bots/${sourceBot.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-forwarded-user': 'alice' },
        body: JSON.stringify({ isShared: true }),
      });
      expect(shareRes.status).toBe(200);

      const marketRes = await fetch(`${baseUrl}/api/marketplace/bots`, {
        headers: { 'x-forwarded-user': 'bob' },
      });
      const { bots: marketBots } = (await marketRes.json()) as {
        bots: Array<{
          id: string;
          name: string;
          description: string;
          ownerId: string;
          skillNames: string[];
        }>;
      };
      expect(marketBots).toEqual([
        expect.objectContaining({
          id: sourceBot.id,
          name: 'FinOps Guru',
          description: 'Audits DBU spend across workspaces.',
          ownerId: 'alice',
          skillNames: ['dbu-audit'],
        }),
      ]);

      const installRes = await fetch(`${baseUrl}/api/marketplace/bots/${sourceBot.id}/install`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-user': 'bob' },
        body: JSON.stringify({}),
      });
      expect(installRes.status).toBe(201);
      const { bot: installed } = (await installRes.json()) as {
        bot: {
          id: string;
          name: string;
          avatarLabel: string;
          description: string;
          ownerId: string;
          isShared: boolean;
          sourceBotId: string;
        };
      };
      expect(installed.id).not.toBe(sourceBot.id);
      expect(installed).toMatchObject({
        name: 'FinOps Guru',
        avatarLabel: '1.2.0.0',
        description: 'Audits DBU spend across workspaces.',
        ownerId: 'bob',
        isShared: false,
        sourceBotId: sourceBot.id,
      });

      const clonedSkills = await service.getMemory().listSkills(installed.id);
      expect(clonedSkills.map((s) => ({ name: s.name, body: s.body }))).toEqual([
        { name: 'dbu-audit', body: '# DBU Audit steps' },
      ]);
      const clonedMemories = await service.getMemory().listMemories(installed.id);
      expect(clonedMemories).toEqual([]);

      const bobChatRes = await fetch(`${baseUrl}/api/bots/${installed.id}/chat`, {
        headers: { 'x-forwarded-user': 'bob' },
      });
      const { messages: bobMessages } = (await bobChatRes.json()) as {
        messages: Array<{ role: string; content: string }>;
      };
      expect(bobMessages).toHaveLength(1);
      expect(bobMessages[0]?.role).toBe('assistant');
      expect(bobMessages[0]?.content).toContain("Hi — I'm FinOps Guru.");
    });
  });

  test('serves viable MCPs and supports discovery refresh and registration', async () => {
    await withChatApp(async (baseUrl) => {
      const getRes = await fetch(`${baseUrl}/api/mcps`);
      expect(getRes.status).toBe(200);
      const { mcps } = (await getRes.json()) as { mcps: Array<{ service: string; isViable?: boolean }> };
      expect(mcps.every((m) => m.isViable !== false)).toBe(true);
      expect(mcps.some((m) => m.service === 'system.ai.genie_one_mcp')).toBe(true);
      expect(mcps.some((m) => m.service === 'system.ai.slack')).toBe(false);
    });
  });

  test('connect registers MCP tools on ChatService and disconnect removes them', async () => {
    const { McpDiscoveryService } = await import('../agents/tools/mcp-discovery.js');
    const mockFetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const bodyText = typeof init?.body === 'string' ? init.body : '{}';
      if (url.includes('/ai-gateway/mcp-services/system.ai.web_search')) {
        const body = JSON.parse(bodyText) as { id: number; method: string };
        if (body.method === 'tools/list') {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                jsonrpc: '2.0',
                id: body.id,
                result: { tools: [{ name: 'web_search', description: 'Search' }] },
              }),
              { status: 200 }
            )
          );
        }
      }
      return Promise.resolve(new Response('Not Found', { status: 404 }));
    }) as typeof fetch;
    const mcpDiscovery = new McpDiscoveryService({
      host: 'https://workspace.cloud.databricks.com',
      getToken: () => Promise.resolve('tok'),
      fetchImpl: mockFetch,
    });

    await withChatApp(
      async (baseUrl, { service }) => {
        expect(service.listToolNames('alice')).not.toContain('mcp_system_ai_web_search_web_search');

        const connectRes = await fetch(`${baseUrl}/api/mcps/connect`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-user': 'alice' },
          body: JSON.stringify({ service: 'system.ai.web_search' }),
        });
        expect(connectRes.status).toBe(200);
        const connectedBody = (await connectRes.json()) as {
          mcp: { service: string; connected?: boolean };
        };
        expect(connectedBody.mcp.service).toBe('system.ai.web_search');
        expect(connectedBody.mcp.connected).toBe(true);
        expect(service.listToolNames('alice')).toContain('mcp_system_ai_web_search_web_search');

        const listRes = await fetch(`${baseUrl}/api/mcps`, { headers: { 'x-forwarded-user': 'alice' } });
        const { mcps } = (await listRes.json()) as {
          mcps: Array<{ service: string; connected?: boolean }>;
        };
        expect(mcps.find((m) => m.service === 'system.ai.web_search')?.connected).toBe(true);

        const disconnectRes = await fetch(`${baseUrl}/api/mcps/connect/${encodeURIComponent('system.ai.web_search')}`, {
          method: 'DELETE',
          headers: { 'x-forwarded-user': 'alice' },
        });
        expect(disconnectRes.status).toBe(200);
        expect(service.listToolNames('alice')).not.toContain('mcp_system_ai_web_search_web_search');
      },
      { mcpDiscovery }
    );
  });

  test('connectors are user-level: one user cannot see, disconnect, or remove another user’s connectors', async () => {
    const { McpDiscoveryService } = await import('../agents/tools/mcp-discovery.js');
    const toolsByService: Record<string, string> = {
      'system.ai.web_search': 'web_search',
      'main.analytics.custom_mcp': 'query_custom_data',
    };
    const mockFetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const match = url.match(/\/ai-gateway\/mcp-services\/([^?]+)/);
      const toolName = match ? toolsByService[decodeURIComponent(match[1])] : undefined;
      if (toolName) {
        const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as { id: number };
        return Promise.resolve(
          new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { tools: [{ name: toolName }] } }), {
            status: 200,
          })
        );
      }
      return Promise.resolve(new Response('Not Found', { status: 404 }));
    }) as typeof fetch;
    const mcpDiscovery = new McpDiscoveryService({
      host: 'https://workspace.cloud.databricks.com',
      getToken: () => Promise.resolve('tok'),
      fetchImpl: mockFetch,
    });
    const webSearchTool = 'mcp_system_ai_web_search_web_search';
    const customTool = 'mcp_main_analytics_custom_mcp_query_custom_data';

    await withChatApp(
      async (baseUrl, { service }) => {
        const as = (user: string, init: RequestInit = {}) => ({
          ...init,
          headers: { 'content-type': 'application/json', 'x-forwarded-user': user },
        });
        const listFor = async (user: string) => {
          const res = await fetch(`${baseUrl}/api/mcps`, as(user));
          return ((await res.json()) as { mcps: Array<{ service: string; connected?: boolean }> }).mcps;
        };

        const connectRes = await fetch(
          `${baseUrl}/api/mcps/connect`,
          as('alice', { method: 'POST', body: JSON.stringify({ service: 'system.ai.web_search' }) })
        );
        expect(connectRes.status).toBe(200);
        const registerRes = await fetch(
          `${baseUrl}/api/mcps/register`,
          as('alice', { method: 'POST', body: JSON.stringify({ service: 'main.analytics.custom_mcp' }) })
        );
        expect(registerRes.status).toBe(201);

        // Bob cannot see Alice's connection or custom registration.
        const bobList = await listFor('bob');
        expect(bobList.find((m) => m.service === 'system.ai.web_search')?.connected).toBe(false);
        expect(bobList.some((m) => m.service === 'main.analytics.custom_mcp')).toBe(false);
        expect(service.listToolNames('bob')).not.toContain(webSearchTool);
        expect(service.listToolNames('bob')).not.toContain(customTool);

        // Bob's disconnect / remove are no-ops for Alice.
        const bobDisconnect = await fetch(
          `${baseUrl}/api/mcps/connect/${encodeURIComponent('system.ai.web_search')}`,
          as('bob', { method: 'DELETE' })
        );
        expect(await bobDisconnect.json()).toEqual({ success: false });
        const bobRemove = await fetch(
          `${baseUrl}/api/mcps/${encodeURIComponent('main.analytics.custom_mcp')}`,
          as('bob', { method: 'DELETE' })
        );
        expect(await bobRemove.json()).toEqual({ success: false });

        // Bob connecting and disconnecting the same service still leaves Alice connected.
        await fetch(
          `${baseUrl}/api/mcps/connect`,
          as('bob', { method: 'POST', body: JSON.stringify({ service: 'system.ai.web_search' }) })
        );
        expect(service.listToolNames('bob')).toContain(webSearchTool);
        await fetch(
          `${baseUrl}/api/mcps/connect/${encodeURIComponent('system.ai.web_search')}`,
          as('bob', { method: 'DELETE' })
        );
        expect(service.listToolNames('bob')).not.toContain(webSearchTool);

        const aliceList = await listFor('alice');
        expect(aliceList.find((m) => m.service === 'system.ai.web_search')?.connected).toBe(true);
        expect(aliceList.find((m) => m.service === 'main.analytics.custom_mcp')?.connected).toBe(true);
        expect(service.listToolNames('alice')).toContain(webSearchTool);
        expect(service.listToolNames('alice')).toContain(customTool);

        // Alice removing her own custom MCP works.
        const aliceRemove = await fetch(
          `${baseUrl}/api/mcps/${encodeURIComponent('main.analytics.custom_mcp')}`,
          as('alice', { method: 'DELETE' })
        );
        expect(await aliceRemove.json()).toEqual({ success: true });
        expect((await listFor('alice')).some((m) => m.service === 'main.analytics.custom_mcp')).toBe(false);
        expect(service.listToolNames('alice')).not.toContain(customTool);
      },
      { mcpDiscovery }
    );
  });

  test('a retried message with the same requestId runs the turn once, and only in its own chat', async () => {
    await withChatApp(async (baseUrl, { store }) => {
      const bot = await store.ensurePrimaryBot();
      const chat = await store.getOrCreateChatForBot(bot.id);
      const other = await store.getOrCreateChatForBot(
        (await store.createBot({ name: 'Analyst', ownerId: bot.ownerId, spaceId: bot.spaceId })).id
      );
      const send = (chatId: string) =>
        fetch(`${baseUrl}/api/chats/${chatId}/messages`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ content: 'hello', requestId: 'req-1' }),
        });

      expect((await send(chat.id)).status).toBe(201);
      expect((await send(chat.id)).status).toBe(201);
      const users = (await store.listMessages(chat.id)).filter((m) => m.role === 'user');
      expect(users).toHaveLength(1);

      const reused = await send(other.id);
      expect(reused.status).toBe(409);
      expect(await store.listMessages(other.id)).toEqual([]);
    });
  });
});
