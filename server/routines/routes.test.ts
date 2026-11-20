import express from 'express';
import { describe, expect, test } from 'vitest';
import { getRequestUserAccessToken } from '../chat/databricks-auth.js';
import { MemoryChatStore } from '../chat/memory-store.js';
import { ChatService } from '../chat/service.js';
import { StubChatClient } from '../agents/clients/stub-client.js';
import { MemoryRoutineStore } from './memory-store.js';
import { registerRoutineRoutes } from './routes.js';
import { RoutineService } from './service.js';
import { WEBHOOK_HEADER } from './webhook-auth.js';

async function withRoutineApp(run: (ctx: { baseUrl: string; botId: string; chats: MemoryChatStore }) => Promise<void>) {
  const chats = new MemoryChatStore();
  const { primary } = await chats.ensureBootstrap('workspace-user');
  const routines = new MemoryRoutineStore();
  const chatService = new ChatService({ store: chats, client: new StubChatClient() });
  const service = new RoutineService(routines, chats, chatService);
  const app = express();
  app.use(express.json());
  registerRoutineRoutes(app, routines, service, {
    provider: 'stub',
    chats,
    env: {},
  });

  const server = await new Promise<import('node:http').Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind test server');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await run({ baseUrl, botId: primary.id, chats });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

describe('routines HTTP API', () => {
  test('refuses to schedule a routine on another user private bot', async () => {
    await withRoutineApp(async ({ baseUrl, botId }) => {
      const res = await fetch(`${baseUrl}/api/routines`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-email': 'mallory@example.com' },
        body: JSON.stringify({ botId, name: 'Snoop', cron: '0 * * * *' }),
      });
      expect(res.status).toBe(403);
    });
  });

  test('refuses App identity routines unless the operator allows them', async () => {
    await withRoutineApp(async ({ baseUrl, botId }) => {
      const res = await fetch(`${baseUrl}/api/routines`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ botId, name: 'As SP', cron: '0 * * * *', runAs: 'app' }),
      });
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: string }).error).toMatch(/BRICKSBOT_ROUTINE_APP_IDENTITY/);
    });
  });

  test('lists, creates, toggles, runs, and accepts authenticated webhooks', async () => {
    await withRoutineApp(async ({ baseUrl, botId, chats }) => {
      const statusRes = await fetch(`${baseUrl}/api/setup/status`);
      expect(statusRes.status).toBe(200);
      const status = (await statusRes.json()) as { provider: string; needsLlmSetup: boolean };
      expect(status.provider).toBe('stub');
      expect(status.needsLlmSetup).toBe(true);

      const createRes = await fetch(`${baseUrl}/api/routines`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          botId,
          name: 'Hourly',
          cron: '0 * * * *',
          prompt: 'Hourly check-in',
        }),
      });
      expect(createRes.status).toBe(201);
      const created = (await createRes.json()) as {
        routine: { id: string; enabled: boolean };
        webhookSecret: string;
      };
      expect(created.webhookSecret).toBeTruthy();

      const listRes = await fetch(`${baseUrl}/api/routines`);
      const { routines } = (await listRes.json()) as { routines: Array<{ name: string }> };
      expect(routines.map((r) => r.name)).toEqual(['Hourly']);

      const patchRes = await fetch(`${baseUrl}/api/routines/${created.routine.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });
      expect(patchRes.status).toBe(200);
      const patched = (await patchRes.json()) as { routine: { enabled: boolean } };
      expect(patched.routine.enabled).toBe(false);

      const runRes = await fetch(`${baseUrl}/api/routines/${created.routine.id}/run`, {
        method: 'POST',
      });
      expect(runRes.status).toBe(201);
      const runBody = (await runRes.json()) as { chat: { user: { content: string } } };
      expect(runBody.chat.user.content).toBe('Hourly check-in');

      await fetch(`${baseUrl}/api/routines/${created.routine.id}/update`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      });

      const badHook = await fetch(`${baseUrl}/api/webhooks/routines/${created.routine.id}`, { method: 'POST' });
      expect(badHook.status).toBe(401);

      const okHook = await fetch(`${baseUrl}/api/webhooks/routines/${created.routine.id}`, {
        method: 'POST',
        headers: { [WEBHOOK_HEADER]: created.webhookSecret },
      });
      expect(okHook.status).toBe(201);

      const bodyHook = await fetch(`${baseUrl}/api/webhooks/routines/${created.routine.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ webhookKey: created.webhookSecret }),
      });
      expect(bodyHook.status).toBe(201);

      const del = await fetch(`${baseUrl}/api/routines/${created.routine.id}/delete`, {
        method: 'POST',
      });
      expect(del.status).toBe(204);

      // Its chat leaves the lists with it, so it does not linger as an orphan.
      const kinds = (await chats.listChats(botId, 'workspace-user')).map((chat) => chat.kind);
      expect(kinds).not.toContain('routine');
    });
  });

  test('Test runs with the caller OBO token', async () => {
    let seenToken: string | undefined;
    const service = {
      runNow: () => {
        seenToken = getRequestUserAccessToken();
        return Promise.resolve({});
      },
    } as unknown as RoutineService;
    const app = express();
    app.use(express.json());
    registerRoutineRoutes(app, new MemoryRoutineStore(), service, {
      provider: 'stub',
      chats: new MemoryChatStore(),
      env: {},
    });
    const server = await new Promise<import('node:http').Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
      const { port } = server.address() as import('node:net').AddressInfo;
      const res = await fetch(`http://127.0.0.1:${port}/api/routines/r1/run`, {
        method: 'POST',
        headers: { 'x-forwarded-access-token': 'caller-obo' },
      });
      expect(res.status).toBe(201);
      expect(seenToken).toBe('caller-obo');
    } finally {
      server.close();
    }
  });
});
