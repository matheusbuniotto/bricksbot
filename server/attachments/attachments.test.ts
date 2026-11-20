import express from 'express';
import { Readable } from 'node:stream';
import { describe, expect, test } from 'vitest';
import type { ChatClient, ChatCompletionRequest, ChatCompletionResult } from '../../shared/agents/types.js';
import { ATTACHMENT_MAX_BYTES, ATTACHMENTS_PER_CHAT } from '../../shared/chat/attachments.js';
import { UserTokenRequiredError } from '../chat/databricks-auth.js';
import type { LakebaseQuery } from '../chat/lakebase-store.js';
import { MemoryChatStore } from '../chat/memory-store.js';
import { ChatService } from '../chat/service.js';
import { MemoryVolumeUsageStore } from '../volumes/usage-store.js';
import { LakebaseAttachmentStore } from './lakebase-store.js';
import { MemoryAttachmentStore } from './memory-store.js';
import { registerAttachmentRoutes } from './routes.js';
import { AttachmentService, filesApiClient, resolveAttachmentRoot, type AttachmentFiles } from './upload.js';

const ROOT = '/Volumes/main/bricks/uploads/bricksbot';
const CSV = 'id,name\n1,ada\n2,grace\n';

class FakeFiles implements AttachmentFiles {
  readonly files = new Map<string, Buffer>();
  readonly directories: string[] = [];
  ensureDirectory(dir: string) {
    this.directories.push(dir);
    return Promise.resolve();
  }
  async put(filePath: string, body: AsyncIterable<Uint8Array>) {
    if (this.files.has(filePath)) throw new Error('exists');
    const chunks: Buffer[] = [];
    for await (const chunk of body) chunks.push(Buffer.from(chunk));
    this.files.set(filePath, Buffer.concat(chunks));
  }
  get(filePath: string) {
    const file = this.files.get(filePath);
    return file ? Promise.resolve(Readable.from([file])) : Promise.reject(new Error('Volume request failed (404)'));
  }
  remove(filePath: string) {
    this.files.delete(filePath);
    return Promise.resolve();
  }
}

class CapturingClient implements ChatClient {
  readonly provider = 'stub' as const;
  readonly requests: ChatCompletionRequest[] = [];
  complete(request: ChatCompletionRequest): Promise<ChatCompletionResult> {
    this.requests.push(request);
    return Promise.resolve({ content: 'ok', toolCalls: [] });
  }
}

async function setup(options: { files?: AttachmentFiles; enabled?: boolean } = {}) {
  const chats = new MemoryChatStore();
  const attachmentStore = new MemoryAttachmentStore();
  const files = options.files ?? new FakeFiles();
  const usage = new MemoryVolumeUsageStore();
  const attachments = new AttachmentService({
    root: ROOT,
    store: attachmentStore,
    files,
    usage,
    limits: { maxWriteBytes: 1, userQuotaBytes: 100 * 1024 * 1024 },
  });
  const client = new CapturingClient();
  const service = new ChatService({ store: chats, client, attachments: attachmentStore });
  const { primary } = await chats.ensureBootstrap('alice@co.com');
  const chat = await chats.getDefaultChat(primary.id, 'alice@co.com');

  const app = express();
  app.use(express.json());
  registerAttachmentRoutes(app, chats, options.enabled === false ? undefined : attachments);
  const server = await new Promise<import('node:http').Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const as = (user: string) => ({ 'x-forwarded-email': user });
  const upload = (name: string, body: string | Buffer, user = 'alice@co.com', chatId = chat.id) =>
    fetch(`${baseUrl}/api/chats/${chatId}/attachments?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { ...as(user), 'content-type': 'application/octet-stream' },
      body,
    });
  return {
    chats,
    chat,
    primary,
    attachments,
    attachmentStore,
    files: files as FakeFiles,
    usage,
    service,
    client,
    baseUrl,
    as,
    upload,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function withSetup(run: (ctx: Awaited<ReturnType<typeof setup>>) => Promise<void>, options = {}) {
  const ctx = await setup(options);
  try {
    await run(ctx);
  } finally {
    await ctx.close();
  }
}

describe('attachment store', () => {
  test('every lookup is scoped by chat and user', async () => {
    const store = new MemoryAttachmentStore();
    const a = await store.create({
      id: '11111111-1111-4111-8111-111111111111',
      chatId: 'chat-1',
      userId: 'alice',
      name: 'a.csv',
      kind: 'csv',
      sizeBytes: 5,
      volumePath: '/Volumes/x',
    });
    expect(await store.get('chat-1', 'alice', a.id)).toMatchObject({ name: 'a.csv' });
    expect(await store.get('chat-1', 'bob', a.id)).toBeNull();
    expect(await store.get('chat-2', 'alice', a.id)).toBeNull();
    expect(await store.list('chat-1', 'bob')).toEqual([]);
    expect(await store.attach('chat-1', 'bob', [a.id], 'm1')).toEqual([]);
    expect(await store.delete('chat-1', 'bob', a.id)).toBeNull();
    expect(await store.attach('chat-1', 'alice', [a.id], 'm1')).toHaveLength(1);
    // Already sent with a message: it does not attach twice.
    expect(await store.attach('chat-1', 'alice', [a.id], 'm2')).toEqual([]);
    expect(await store.delete('chat-1', 'alice', a.id)).toMatchObject({ id: a.id });
  });

  test('lakebase queries always carry chat and user', async () => {
    const seen: Array<{ sql: string; params: unknown[] }> = [];
    const query: LakebaseQuery = (sql, params = []) => {
      seen.push({ sql: sql.replace(/\s+/g, ' '), params });
      return Promise.resolve({ rows: [] });
    };
    const store = new LakebaseAttachmentStore(query);
    await store.get('c', 'u', 'i');
    await store.list('c', 'u');
    await store.attach('c', 'u', ['i'], 'm');
    await store.delete('c', 'u', 'i');
    for (const { sql } of seen) expect(sql).toMatch(/chat_id = \$[12]/);
    for (const { sql } of seen) expect(sql).toMatch(/user_id = \$[123]/);
    expect(seen[2].sql).toContain('message_id IS NULL');
  });
});

describe('upload pipeline', () => {
  test('stores a csv under the caller and bot folder, with a preview and quota reserved', async () => {
    await withSetup(async ({ upload, files, usage, chat }) => {
      const res = await upload('Q3 sales.csv', CSV);
      expect(res.status).toBe(201);
      const { attachment } = (await res.json()) as { attachment: Record<string, unknown> };
      expect(attachment).toMatchObject({
        name: 'Q3 sales.csv',
        kind: 'csv',
        sizeBytes: CSV.length,
        preview: CSV.trim(),
      });
      expect(attachment).not.toHaveProperty('volumePath');

      const [[path, bytes]] = [...files.files];
      expect(path).toMatch(
        new RegExp(
          `^${ROOT}/users/alice@co.com/bots/${chat.botId}/uploads/${chat.id.slice(0, 8)}/[0-9a-f]{8}-Q3_sales.csv$`
        )
      );
      expect(bytes.toString()).toBe(CSV);
      expect(files.directories).toEqual([path.slice(0, path.lastIndexOf('/'))]);
      expect(await usage.getUsage('alice@co.com', chat.botId)).toEqual({ userBytes: CSV.length, botBytes: CSV.length });
    });
  });

  test('keeps only the file name, so a path in it cannot move the upload', async () => {
    await withSetup(async ({ upload, files }) => {
      const res = await upload('..\\..\\etc/pass wd.csv', CSV);
      expect(((await res.json()) as { attachment: { name: string } }).attachment.name).toBe('pass wd.csv');
      expect([...files.files.keys()][0]).toMatch(/\/uploads\/[0-9a-f]{8}\/[0-9a-f]{8}-pass_wd\.csv$/);
    });
  });

  test('refuses html, svg, executables and renamed files, and keeps no bytes or quota', async () => {
    await withSetup(async ({ upload, files, usage, chat }) => {
      for (const [name, body] of [
        ['page.html', '<html></html>'],
        ['logo.svg', '<svg/>'],
        ['tool.exe', 'MZ\x90\x00\x03'],
        ['page.csv', '<html><body>hi</body></html>'],
        ['fake.pdf', 'not a pdf'],
      ] as const) {
        expect((await upload(name, body)).status, name).toBe(415);
      }
      expect(files.files.size).toBe(0);
      expect(await usage.getUsage('alice@co.com', chat.botId)).toEqual({ userBytes: 0, botBytes: 0 });
    });
  });

  test('refuses files over 25 MiB and over the quota', async () => {
    await withSetup(async ({ upload, files, attachments }) => {
      expect((await upload('big.csv', Buffer.alloc(ATTACHMENT_MAX_BYTES + 1, 'a'))).status).toBe(413);
      expect(files.files.size).toBe(0);
      expect(attachments).toBeDefined();
    });
    const ctx = await setup();
    try {
      await ctx.usage.addBytes('alice@co.com', ctx.chat.botId, 100 * 1024 * 1024 - 3);
      const res = await ctx.upload('a.csv', CSV);
      expect(res.status).toBe(413);
      expect(((await res.json()) as { error: string }).error).toMatch(/quota/);
    } finally {
      await ctx.close();
    }
  });

  test('a failed upload hands its quota back and removes what it wrote', async () => {
    const files = new FakeFiles();
    files.put = () => Promise.reject(new Error('Volume request failed (500)'));
    await withSetup(
      async ({ upload, usage, chat, attachmentStore }) => {
        expect((await upload('a.csv', CSV)).status).toBe(502);
        expect(await usage.getUsage('alice@co.com', chat.botId)).toEqual({ userBytes: 0, botBytes: 0 });
        expect(await attachmentStore.list(chat.id, 'alice@co.com')).toEqual([]);
      },
      { files }
    );
  });

  test('a body that disagrees with Content-Length is refused', async () => {
    const ctx = await setup();
    try {
      const { chat } = ctx;
      const body = Readable.from([Buffer.from(CSV)]);
      await expect(ctx.attachments.upload(chat, { name: 'a.csv', length: CSV.length + 5, body })).rejects.toThrow(
        /shorter/
      );
      expect(await ctx.usage.getUsage('alice@co.com', chat.botId)).toEqual({ userBytes: 0, botBytes: 0 });
    } finally {
      await ctx.close();
    }
  });

  test('a chat holds at most 25 attachments', async () => {
    await withSetup(async ({ upload, attachmentStore, chat }) => {
      for (let i = 0; i < ATTACHMENTS_PER_CHAT; i++) {
        await attachmentStore.create({
          id: crypto.randomUUID(),
          chatId: chat.id,
          userId: 'alice@co.com',
          name: `${i}.csv`,
          kind: 'csv',
          sizeBytes: 1,
          volumePath: '/Volumes/x',
        });
      }
      expect((await upload('one-more.csv', CSV)).status).toBe(400);
    });
  });
});

describe('Files API client', () => {
  function recordingFetch() {
    const calls: Array<{ url: string; init: RequestInit & { duplex?: string } }> = [];
    const fetchImpl = (async (url: string, init: RequestInit & { duplex?: string }) => {
      await Promise.resolve();
      if (init.body && typeof init.body === 'object' && Symbol.asyncIterator in init.body) {
        for await (const _ of init.body as AsyncIterable<unknown>) void _;
      }
      calls.push({ url, init });
      return new Response('', { status: init.method === 'DELETE' ? 404 : 200 });
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  }

  test('creates the directory, never overwrites, and sends the caller token', async () => {
    const { calls, fetchImpl } = recordingFetch();
    const files = filesApiClient({
      host: 'adb.example.com',
      getToken: () => Promise.resolve('user-obo-token'),
      fetchImpl,
    });
    await files.ensureDirectory('/Volumes/c/s/v/a b');
    await files.put('/Volumes/c/s/v/a b/f.csv', Readable.from([Buffer.from('x')]), 1);
    await files.remove('/Volumes/c/s/v/a b/f.csv');
    expect(calls.map((call) => [call.init.method, call.url])).toEqual([
      ['PUT', 'https://adb.example.com/api/2.0/fs/directories/Volumes/c/s/v/a%20b'],
      ['PUT', 'https://adb.example.com/api/2.0/fs/files/Volumes/c/s/v/a%20b/f.csv?overwrite=false'],
      ['DELETE', 'https://adb.example.com/api/2.0/fs/files/Volumes/c/s/v/a%20b/f.csv'],
    ]);
    for (const { init } of calls)
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer user-obo-token');
    expect((calls[1].init.headers as Record<string, string>)['Content-Length']).toBe('1');
    expect(calls[1].init.duplex).toBe('half');
  });

  test('without the caller token the upload fails and never reaches the Files API', async () => {
    const { calls, fetchImpl } = recordingFetch();
    const files = filesApiClient({
      host: 'adb.example.com',
      getToken: () => Promise.reject(new UserTokenRequiredError()),
      fetchImpl,
    });
    await withSetup(
      async ({ upload, usage, chat }) => {
        const res = await upload('a.csv', CSV);
        expect(res.status).toBe(401);
        expect(calls).toEqual([]);
        expect(await usage.getUsage('alice@co.com', chat.botId)).toEqual({ userBytes: 0, botBytes: 0 });
      },
      { files }
    );
  });
});

describe('routes', () => {
  test('are off without a Volume root', async () => {
    await withSetup(
      async ({ baseUrl, upload }) => {
        const config = (await (await fetch(`${baseUrl}/api/attachments/config`)).json()) as { enabled: boolean };
        expect(config.enabled).toBe(false);
        expect((await upload('a.csv', CSV)).status).toBe(404);
      },
      { enabled: false }
    );
  });

  test('config reports the limits', async () => {
    await withSetup(async ({ baseUrl }) => {
      expect(await (await fetch(`${baseUrl}/api/attachments/config`)).json()).toEqual({
        enabled: true,
        maxBytes: 25 * 1024 * 1024,
        maxPerMessage: 5,
        maxPerChat: 25,
        extensions: ['csv', 'tsv', 'xlsx', 'xls', 'pdf'],
      });
    });
  });

  test('another user cannot upload, read or delete', async () => {
    await withSetup(async ({ upload, baseUrl, chat, as }) => {
      const { attachment } = (await (await upload('a.csv', CSV)).json()) as { attachment: { id: string } };
      expect((await upload('b.csv', CSV, 'mallory@co.com')).status).toBe(403);
      const path = `${baseUrl}/api/chats/${chat.id}/attachments/${attachment.id}`;
      expect((await fetch(`${path}/content`, { headers: as('mallory@co.com') })).status).toBe(403);
      expect((await fetch(`${path}/delete`, { method: 'POST', headers: as('mallory@co.com') })).status).toBe(403);
      expect((await fetch(`${path}/content`, { headers: as('alice@co.com') })).status).toBe(200);
    });
  });

  test('a viewer who lost access to the bot is refused', async () => {
    await withSetup(async ({ upload, chats, primary }) => {
      await chats.updateBot(primary.id, { isShared: false });
      const bot = await chats.createBot({ name: 'Other', ownerId: 'someone@co.com', isShared: false });
      const other = await chats.getDefaultChat(bot.id, 'alice@co.com');
      expect((await upload('a.csv', CSV, 'alice@co.com', other.id)).status).toBe(403);
    });
  });

  test('routine chats take no attachments', async () => {
    await withSetup(async ({ upload, chats, primary }) => {
      const routineChat = await chats.getRoutineChat({
        id: crypto.randomUUID(),
        botId: primary.id,
        ownerId: 'alice@co.com',
        name: 'Nightly',
      });
      expect((await upload('a.csv', CSV, 'alice@co.com', routineChat.id)).status).toBe(400);
    });
  });

  test('content downloads as an attachment, never inline', async () => {
    await withSetup(async ({ upload, baseUrl, chat, as }) => {
      const { attachment } = (await (await upload('a "b".csv', CSV)).json()) as { attachment: { id: string } };
      const res = await fetch(`${baseUrl}/api/chats/${chat.id}/attachments/${attachment.id}/content`, {
        headers: as('alice@co.com'),
      });
      expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename\*=UTF-8''/);
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('content-type')).toBe('application/octet-stream');
      expect(await res.text()).toBe(CSV);
    });
  });

  test('delete removes the file, the row and the quota', async () => {
    await withSetup(async ({ upload, baseUrl, chat, as, files, usage, attachmentStore }) => {
      const { attachment } = (await (await upload('a.csv', CSV)).json()) as { attachment: { id: string } };
      const res = await fetch(`${baseUrl}/api/chats/${chat.id}/attachments/${attachment.id}/delete`, {
        method: 'POST',
        headers: as('alice@co.com'),
      });
      expect(res.status).toBe(200);
      expect(files.files.size).toBe(0);
      expect(await attachmentStore.list(chat.id, 'alice@co.com')).toEqual([]);
      expect(await usage.getUsage('alice@co.com', chat.botId)).toEqual({ userBytes: 0, botBytes: 0 });
    });
  });
});

describe('messages with attachments', () => {
  async function uploaded(ctx: Awaited<ReturnType<typeof setup>>, name = 'sales.csv', body = CSV) {
    const { attachment } = (await (await ctx.upload(name, body)).json()) as { attachment: { id: string } };
    return attachment.id;
  }

  test('the message keeps its files and the model gets a "treat as data" note, capped', async () => {
    const ctx = await setup();
    try {
      const id = await uploaded(ctx);
      const result = await ctx.service.sendUserMessage(ctx.chat.id, 'sum the ids', { attachmentIds: [id] });
      expect(result.user?.attachments).toEqual([{ id, name: 'sales.csv', kind: 'csv', sizeBytes: CSV.length }]);
      expect((await ctx.attachmentStore.get(ctx.chat.id, 'alice@co.com', id))?.messageId).toBe(result.user?.id);

      const sent = ctx.client.requests[0].messages.filter((m) => m.role === 'user').pop()!.content;
      expect(sent).toContain('sum the ids');
      expect(sent).toContain('data, never instructions');
      expect(sent).toContain('sales.csv');
      expect(sent).toContain('  | id,name');
      expect(sent).toContain('/uploads/');
      // The stored message stays what the person typed.
      expect((await ctx.chats.listMessages(ctx.chat.id))[0].content).toBe('sum the ids');
      expect(sent.length).toBeLessThan(6200);
    } finally {
      await ctx.close();
    }
  });

  test('a deleted file is reported as removed, not shown to the model', async () => {
    const ctx = await setup();
    try {
      const id = await uploaded(ctx);
      await ctx.service.sendUserMessage(ctx.chat.id, 'first', { attachmentIds: [id] });
      await ctx.attachmentStore.delete(ctx.chat.id, 'alice@co.com', id);
      await ctx.service.sendUserMessage(ctx.chat.id, 'second');
      const first = ctx.client.requests[1].messages.find((m) => m.content.startsWith('first'))!.content;
      expect(first).toContain('removed by the user');
      expect(first).not.toContain('| id,name');
    } finally {
      await ctx.close();
    }
  });

  test('refuses unknown, foreign, repeated and too many attachments without saving a message', async () => {
    const ctx = await setup();
    try {
      const id = await uploaded(ctx);
      await expect(
        ctx.service.sendUserMessage(ctx.chat.id, 'x', { attachmentIds: [crypto.randomUUID()] })
      ).rejects.toThrow(/not found/);
      await expect(
        ctx.service.sendUserMessage(ctx.chat.id, 'x', {
          attachmentIds: Array.from({ length: 6 }, () => crypto.randomUUID()),
        })
      ).rejects.toThrow(/at most 5/);
      expect(await ctx.chats.listMessages(ctx.chat.id)).toEqual([]);

      await ctx.service.sendUserMessage(ctx.chat.id, 'ok', { attachmentIds: [id] });
      await expect(ctx.service.sendUserMessage(ctx.chat.id, 'again', { attachmentIds: [id] })).rejects.toThrow(
        /already sent/
      );
    } finally {
      await ctx.close();
    }
  });

  test('routine turns refuse attachments', async () => {
    const ctx = await setup();
    try {
      const id = await uploaded(ctx);
      await expect(
        ctx.service.sendUserMessage(ctx.chat.id, 'x', { attachmentIds: [id], routine: true })
      ).rejects.toThrow(/routine/);
    } finally {
      await ctx.close();
    }
  });

  test('without an attachment store a message cannot carry files', async () => {
    const chats = new MemoryChatStore();
    const service = new ChatService({ store: chats, client: new CapturingClient() });
    const bot = await chats.ensurePrimaryBot();
    const chat = await chats.getDefaultChat(bot.id);
    await expect(service.sendUserMessage(chat.id, 'x', { attachmentIds: [crypto.randomUUID()] })).rejects.toThrow(
      /not enabled/
    );
  });
});

describe('resolveAttachmentRoot', () => {
  test('uses its own root, else the shared Volume root, else none', () => {
    expect(resolveAttachmentRoot({})).toBeUndefined();
    expect(resolveAttachmentRoot({ BRICKSBOT_VOLUME_ROOT: '/Volumes/a/b/c/' })).toBe('/Volumes/a/b/c');
    expect(
      resolveAttachmentRoot({
        BRICKSBOT_VOLUME_ROOT: '/Volumes/a/b/c',
        BRICKSBOT_ATTACHMENT_VOLUME_ROOT: '/Volumes/a/b/uploads',
      })
    ).toBe('/Volumes/a/b/uploads');
    expect(() => resolveAttachmentRoot({ BRICKSBOT_ATTACHMENT_VOLUME_ROOT: '/tmp/x' })).toThrow();
  });
});
