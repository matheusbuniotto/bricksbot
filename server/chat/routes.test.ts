import express from 'express';
import { describe, expect, test } from 'vitest';
import { StubChatClient } from '../llm/stub-client.js';
import { MemoryChatStore } from './memory-store.js';
import { registerChatRoutes } from './routes.js';
import { ChatService } from './service.js';

async function withChatApp(run: (baseUrl: string) => Promise<void>) {
  const store = new MemoryChatStore();
  const service = new ChatService({ store, client: new StubChatClient() });
  const app = express();
  app.use(express.json());
  registerChatRoutes(app, store, service);

  const server = await new Promise<import('node:http').Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind test server');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await run(baseUrl);
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
        body: JSON.stringify({ name: 'Analyst', spaceId: spaces[0]!.id }),
      });
      expect(createBot.status).toBe(201);
      const { bot } = (await createBot.json()) as { bot: { id: string; name: string } };
      expect(bot.name).toBe('Analyst');

      const botsRes = await fetch(`${baseUrl}/api/bots?spaceId=${spaces[0]!.id}`);
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
      const chatRes = await fetch(`${baseUrl}/api/bots/${bots[0]!.id}/chat`);
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
      const chatRes = await fetch(`${baseUrl}/api/bots/${bots[0]!.id}/chat`);
      const { chat, autoApprovedTools } = (await chatRes.json()) as {
        chat: { id: string };
        autoApprovedTools: string[];
      };
      expect(autoApprovedTools).toEqual([]);

      // Check auto list endpoint
      const listRes = await fetch(`${baseUrl}/api/chats/${chat.id}/approvals/auto`);
      expect(listRes.status).toBe(200);
      expect((await listRes.json()) as unknown).toEqual({ autoApprovedTools: [] });

      // Revoke endpoint (when none exist)
      const revokeRes = await fetch(`${baseUrl}/api/chats/${chat.id}/approvals/auto/sql_query`, {
        method: 'DELETE',
      });
      expect(revokeRes.status).toBe(200);
    });
  });
});
