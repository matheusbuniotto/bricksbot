import { randomUUID } from 'node:crypto';
import express from 'express';
import { describe, expect, test } from 'vitest';
import { MemoryChatStore } from '../../chat/memory-store.js';
import { MemoryMemorySkillStore } from './memory-store.js';
import { registerMemoryRoutes } from './routes.js';

async function withMemoryApp(run: (baseUrl: string, botId: string) => Promise<void>) {
  const chats = new MemoryChatStore();
  const bot = await chats.ensurePrimaryBot();
  const app = express();
  app.use(express.json());
  registerMemoryRoutes(app, chats, new MemoryMemorySkillStore());

  const server = await new Promise<import('node:http').Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind test server');
  }

  try {
    await run(`http://127.0.0.1:${address.port}`, bot.id);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

describe('memory HTTP API', () => {
  test('upserts memory by key and creates, lists, and deletes skills', async () => {
    await withMemoryApp(async (baseUrl, botId) => {
      const first = await fetch(`${baseUrl}/api/bots/${botId}/memories`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'warehouse', content: 'us-east' }),
      });
      expect(first.status).toBe(200);
      const created = (await first.json()) as { memory: { id: string; content: string } };

      const second = await fetch(`${baseUrl}/api/bots/${botId}/memories`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'warehouse', content: 'us-west' }),
      });
      const updated = (await second.json()) as { memory: { id: string; content: string } };
      expect(updated.memory.id).toBe(created.memory.id);
      expect(updated.memory.content).toBe('us-west');

      const listed = await fetch(`${baseUrl}/api/bots/${botId}/memories`);
      const memories = (await listed.json()) as {
        memories: Array<{ key: string; content: string }>;
      };
      expect(memories.memories).toEqual([expect.objectContaining({ key: 'warehouse', content: 'us-west' })]);

      const skillRes = await fetch(`${baseUrl}/api/bots/${botId}/skills`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'SQL style', body: 'Prefer concise SQL.' }),
      });
      expect(skillRes.status).toBe(201);
      const { skill } = (await skillRes.json()) as { skill: { id: string; name: string } };

      const duplicate = await fetch(`${baseUrl}/api/bots/${botId}/skills`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'SQL style', body: 'again' }),
      });
      expect(duplicate.status).toBe(409);

      const skillsRes = await fetch(`${baseUrl}/api/bots/${botId}/skills`);
      const skills = (await skillsRes.json()) as { skills: Array<{ id: string }> };
      expect(skills.skills.map((entry) => entry.id)).toEqual([skill.id]);

      const deleted = await fetch(`${baseUrl}/api/bots/${botId}/skills/${skill.id}`, {
        method: 'DELETE',
      });
      expect(deleted.status).toBe(204);
      const after = (await (await fetch(`${baseUrl}/api/bots/${botId}/skills`)).json()) as {
        skills: unknown[];
      };
      expect(after.skills).toEqual([]);
    });
  });

  test('returns 404 for an unknown bot', async () => {
    await withMemoryApp(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/bots/${randomUUID()}/memories`);
      expect(res.status).toBe(404);
    });
  });
});
