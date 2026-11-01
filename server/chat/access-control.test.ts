import express from 'express';
import { describe, expect, test } from 'vitest';
import { StubChatClient } from '../agents/clients/stub-client.js';
import { MemoryChatStore } from './memory-store.js';
import { registerChatRoutes } from './routes.js';
import { ChatService } from './service.js';
import { MemoryMemorySkillStore } from '../agents/memory/memory-store.js';

async function withChatApp(
  run: (baseUrl: string, ctx: { store: MemoryChatStore; service: ChatService; memory: MemoryMemorySkillStore }) => Promise<void>,
) {
  const store = new MemoryChatStore();
  const memory = new MemoryMemorySkillStore();
  const service = new ChatService({ store, client: new StubChatClient(), memory });
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
    await run(baseUrl, { store, service, memory });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

describe('security and access control (review blockers)', () => {
  test('Blocker 1: prevents cross-user bot chat and sandbox access without visibility', async () => {
    await withChatApp(async (baseUrl) => {
      const createRes = await fetch(`${baseUrl}/api/bots`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-user': 'alice' },
        body: JSON.stringify({ name: 'PrivateBot' }),
      });
      expect(createRes.status).toBe(201);
      const { bot } = (await createRes.json()) as { bot: { id: string } };

      const chatRes = await fetch(`${baseUrl}/api/bots/${bot.id}/chat`, {
        headers: { 'x-forwarded-user': 'bob' },
      });
      expect(chatRes.status).toBe(403);

      const sandboxGetRes = await fetch(`${baseUrl}/api/bots/${bot.id}/sandbox`, {
        headers: { 'x-forwarded-user': 'bob' },
      });
      expect(sandboxGetRes.status).toBe(403);

      const sandboxStopRes = await fetch(`${baseUrl}/api/bots/${bot.id}/sandbox/stop`, {
        method: 'POST',
        headers: { 'x-forwarded-user': 'bob' },
      });
      expect(sandboxStopRes.status).toBe(403);

      const sandboxDeleteRes = await fetch(`${baseUrl}/api/bots/${bot.id}/sandbox`, {
        method: 'DELETE',
        headers: { 'x-forwarded-user': 'bob' },
      });
      expect(sandboxDeleteRes.status).toBe(403);
    });
  });

  test('Blocker 2: non-primary bot in space is hidden from other space members unless isShared is true', async () => {
    await withChatApp(async (baseUrl) => {
      const spaceRes = await fetch(`${baseUrl}/api/spaces`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-user': 'alice' },
        body: JSON.stringify({ name: 'Team Space' }),
      });
      const { space } = (await spaceRes.json()) as { space: { id: string } };
      await fetch(`${baseUrl}/api/spaces/${space.id}/members`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-user': 'alice' },
        body: JSON.stringify({ userId: 'bob', role: 'member' }),
      });

      const botRes = await fetch(`${baseUrl}/api/bots`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-user': 'alice' },
        body: JSON.stringify({ name: 'SecretBot', spaceId: space.id, isShared: false }),
      });
      const { bot } = (await botRes.json()) as { bot: { id: string } };

      const listBob1 = await fetch(`${baseUrl}/api/bots?spaceId=${space.id}`, {
        headers: { 'x-forwarded-user': 'bob' },
      });
      const { bots: botsBob1 } = (await listBob1.json()) as { bots: Array<{ id: string }> };
      expect(botsBob1.some((b) => b.id === bot.id)).toBe(false);

      const listAlice = await fetch(`${baseUrl}/api/bots?spaceId=${space.id}`, {
        headers: { 'x-forwarded-user': 'alice' },
      });
      const { bots: botsAlice } = (await listAlice.json()) as { bots: Array<{ id: string }> };
      expect(botsAlice.some((b) => b.id === bot.id)).toBe(true);

      const shareRes = await fetch(`${baseUrl}/api/bots/${bot.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-forwarded-user': 'alice' },
        body: JSON.stringify({ isShared: true }),
      });
      expect(shareRes.status).toBe(200);

      const listBob2 = await fetch(`${baseUrl}/api/bots?spaceId=${space.id}`, {
        headers: { 'x-forwarded-user': 'bob' },
      });
      const { bots: botsBob2 } = (await listBob2.json()) as { bots: Array<{ id: string }> };
      expect(botsBob2.some((b) => b.id === bot.id)).toBe(true);
    });
  });

  test('Blocker 3: prevents non-owner from updating, moving, archiving, unarchiving, or deleting bot', async () => {
    await withChatApp(async (baseUrl) => {
      const spaceRes = await fetch(`${baseUrl}/api/spaces`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-user': 'alice' },
        body: JSON.stringify({ name: 'Space A' }),
      });
      const { space } = (await spaceRes.json()) as { space: { id: string } };

      const botRes = await fetch(`${baseUrl}/api/bots`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-user': 'alice' },
        body: JSON.stringify({ name: 'AliceBot', spaceId: space.id }),
      });
      const { bot } = (await botRes.json()) as { bot: { id: string } };

      const updateRes = await fetch(`${baseUrl}/api/bots/${bot.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-forwarded-user': 'bob' },
        body: JSON.stringify({ name: 'HackedBot', description: 'Malicious system prompt injection' }),
      });
      expect(updateRes.status).toBe(403);

      const moveRes = await fetch(`${baseUrl}/api/bots/${bot.id}/move`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-user': 'bob' },
        body: JSON.stringify({ spaceId: null, index: 0 }),
      });
      expect(moveRes.status).toBe(403);

      const archiveRes = await fetch(`${baseUrl}/api/bots/${bot.id}/archive`, {
        method: 'POST',
        headers: { 'x-forwarded-user': 'bob' },
      });
      expect(archiveRes.status).toBe(403);

      const unarchiveRes = await fetch(`${baseUrl}/api/bots/${bot.id}/unarchive`, {
        method: 'POST',
        headers: { 'x-forwarded-user': 'bob' },
      });
      expect(unarchiveRes.status).toBe(403);

      const deleteRes = await fetch(`${baseUrl}/api/bots/${bot.id}`, {
        method: 'DELETE',
        headers: { 'x-forwarded-user': 'bob' },
      });
      expect(deleteRes.status).toBe(403);
    });
  });

  test('Blocker 4: marketplace install rejects spaceId caller is not a member of', async () => {
    await withChatApp(async (baseUrl) => {
      const botRes = await fetch(`${baseUrl}/api/bots`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-user': 'alice' },
        body: JSON.stringify({ name: 'SharedBot', isShared: true }),
      });
      const { bot } = (await botRes.json()) as { bot: { id: string } };

      const spaceRes = await fetch(`${baseUrl}/api/spaces`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-user': 'alice' },
        body: JSON.stringify({ name: 'Alice Private Space' }),
      });
      const { space } = (await spaceRes.json()) as { space: { id: string } };

      const installRes = await fetch(`${baseUrl}/api/marketplace/bots/${bot.id}/install`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-user': 'bob' },
        body: JSON.stringify({ spaceId: space.id }),
      });
      expect(installRes.status).toBe(403);
    });
  });

  test('Marketplace masks corporate emails and provides skill names without N+1 queries', async () => {
    await withChatApp(async (baseUrl, { memory }) => {
      const botRes = await fetch(`${baseUrl}/api/bots`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-email': 'alice.smith@enterprise.corp' },
        body: JSON.stringify({ name: 'MarketplaceBot', isShared: true, description: 'Helps with data' }),
      });
      const { bot } = (await botRes.json()) as { bot: { id: string } };

      await memory.createSkill(bot.id, 'DataAnalysis', 'Analyze tabular metrics');

      const marketRes = await fetch(`${baseUrl}/api/marketplace/bots`, {
        headers: { 'x-forwarded-user': 'bob' },
      });
      expect(marketRes.status).toBe(200);
      const { bots } = (await marketRes.json()) as {
        bots: Array<{ id: string; name: string; ownerId: string; skillNames: string[] }>;
      };

      const found = bots.find((b) => b.id === bot.id);
      expect(found).toBeDefined();
      expect(found?.ownerId).toBe('alice.smith');
      expect(found?.skillNames).toEqual(['DataAnalysis']);
    });
  });

  test('Databricks proxy environment fails closed with 401 when identity headers are missing', async () => {
    await withChatApp(async (baseUrl) => {
      const originalAppName = process.env.DATABRICKS_APP_NAME;
      try {
        process.env.DATABRICKS_APP_NAME = 'bricksbot';

        const unauthRes = await fetch(`${baseUrl}/api/marketplace/bots`);
        expect(unauthRes.status).toBe(401);

        const authRes = await fetch(`${baseUrl}/api/marketplace/bots`, {
          headers: { 'x-forwarded-user': 'verified-user' },
        });
        expect(authRes.status).toBe(200);
      } finally {
        if (originalAppName !== undefined) {
          process.env.DATABRICKS_APP_NAME = originalAppName;
        } else {
          delete process.env.DATABRICKS_APP_NAME;
        }
      }
    });
  });

  test('Memories are strictly isolated per user on shared bots', async () => {
    await withChatApp(async (baseUrl, { store, memory }) => {
      const bot = await store.createBot({
        name: 'SharedAdvisor',
        ownerId: 'alice',
        isShared: true,
      });

      await memory.upsertMemory(bot.id, 'favorite_color', 'blue', 'alice');
      await memory.upsertMemory(bot.id, 'favorite_color', 'red', 'bob');

      const aliceMemories = await memory.listMemories(bot.id, 'alice');
      const bobMemories = await memory.listMemories(bot.id, 'bob');

      expect(aliceMemories).toEqual([
        expect.objectContaining({ key: 'favorite_color', content: 'blue', userId: 'alice' }),
      ]);
      expect(bobMemories).toEqual([
        expect.objectContaining({ key: 'favorite_color', content: 'red', userId: 'bob' }),
      ]);
    });
  });
});
