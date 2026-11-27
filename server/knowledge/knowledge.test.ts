import express from 'express';
import { Readable } from 'node:stream';
import { describe, expect, test } from 'vitest';
import { effectiveKnowledgeStatus, KNOWLEDGE_STALE_MS } from '../../shared/knowledge/types.js';
import type { AttachmentFiles } from '../attachments/upload.js';
import { createSearchKnowledgeTool } from '../agents/tools/search-knowledge.js';
import type { Bot } from '../../shared/chat/types.js';
import { MemoryChatStore } from '../chat/memory-store.js';
import { chunkText } from './chunk.js';
import { knowledgeConfigFromEnv } from './config.js';
import { quoteThreePartName, statementRunner, vectorSearchClient, type SqlParam } from './databricks.js';
import { MemoryKnowledgeStore } from './memory-store.js';
import { registerKnowledgeRoutes } from './routes.js';
import { KnowledgeService, validateKnowledgeFile } from './service.js';

const ROOT = '/Volumes/main/bricks/kb/bricksbot';
const TABLE = '`main`.`bricks`.`kb_chunks`';

class FakeFiles implements AttachmentFiles {
  readonly files = new Map<string, Buffer>();
  ensureDirectory() {
    return Promise.resolve();
  }
  async put(filePath: string, body: AsyncIterable<Uint8Array>) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) chunks.push(Buffer.from(chunk));
    this.files.set(filePath, Buffer.concat(chunks));
  }
  get(filePath: string) {
    return Promise.resolve(Readable.from([this.files.get(filePath) ?? Buffer.alloc(0)]));
  }
  remove(filePath: string) {
    this.files.delete(filePath);
    return Promise.resolve();
  }
}

class FakeSql {
  readonly statements: Array<{ statement: string; parameters: SqlParam[] }> = [];
  constructor(private readonly parsedText = 'Parsed PDF text about refunds.') {}
  run(statement: string, parameters: SqlParam[] = []) {
    this.statements.push({ statement, parameters });
    if (statement.includes('ai_parse_document')) {
      return Promise.resolve({ columns: ['text', 'error'], rows: [[this.parsedText, null]] });
    }
    return Promise.resolve({ columns: [], rows: [] });
  }
}

function fakeSearch(options: { failSync?: boolean } = {}) {
  const calls: Array<Record<string, unknown>> = [];
  let syncs = 0;
  return {
    calls,
    get syncs() {
      return syncs;
    },
    query(input: Record<string, unknown>) {
      calls.push(input);
      return Promise.resolve([{ doc_name: 'policy.md', chunk_index: 0, content: 'Refunds take 5 days.', score: 0.91 }]);
    },
    sync() {
      syncs += 1;
      return options.failSync ? Promise.reject(new Error('403')) : Promise.resolve();
    },
  };
}

function service(options: { sql?: FakeSql; failSync?: boolean } = {}) {
  const store = new MemoryKnowledgeStore();
  const files = new FakeFiles();
  const sql = options.sql ?? new FakeSql();
  const search = fakeSearch({ failSync: options.failSync });
  const knowledge = new KnowledgeService({ root: ROOT, table: TABLE, store, files, sql, search, syncers: [search] });
  return { knowledge, store, files, sql, search };
}

const body = (text: string | Buffer) => {
  const bytes = Buffer.isBuffer(text) ? text : Buffer.from(text);
  return { length: bytes.length, body: Readable.from([bytes]) };
};

describe('chunkText', () => {
  test('packs paragraphs up to the size and overlaps the next chunk', () => {
    const paragraphs = Array.from({ length: 20 }, (_, i) => `Paragraph ${i} ${'word '.repeat(40)}`.trim());
    const chunks = chunkText(paragraphs.join('\n\n'), { size: 600, overlap: 100 });
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.every((chunk) => chunk.length <= 700)).toBe(true);
    expect(chunks[1].startsWith('Paragraph')).toBe(false);
  });

  test('splits one huge paragraph and caps the count', () => {
    expect(chunkText('x'.repeat(5000), { size: 1000, overlap: 0 })).toHaveLength(5);
    expect(chunkText('word '.repeat(10_000), { size: 500, maxChunks: 3 })).toHaveLength(3);
    expect(chunkText('  \n\n ')).toEqual([]);
  });
});

describe('validateKnowledgeFile', () => {
  test('the leading bytes must agree with the extension', () => {
    expect(validateKnowledgeFile('a.md', Buffer.from('# hi'))).toBeNull();
    expect(validateKnowledgeFile('a.pdf', Buffer.from('%PDF-1.7'))).toBeNull();
    expect(validateKnowledgeFile('a.docx', Buffer.from('PK\x03\x04rest', 'latin1'))).toBeNull();
    expect(validateKnowledgeFile('a.pdf', Buffer.from('hello'))).toMatch(/do not look like/);
    expect(validateKnowledgeFile('a.txt', Buffer.from([0x41, 0x00, 0x42]))).toMatch(/do not look like/);
    expect(validateKnowledgeFile('a.exe', Buffer.from('MZ'))).toMatch(/Unsupported/);
  });
});

describe('knowledgeConfigFromEnv', () => {
  const base = { host: 'https://w.cloud.databricks.com', warehouseId: 'wh1' };
  test('off and silent when nothing is set', () => {
    expect(knowledgeConfigFromEnv({}, base)).toEqual({});
  });
  test('names what is missing', () => {
    expect(knowledgeConfigFromEnv({ BRICKSBOT_KB_TABLE: 'main.kb.chunks' }, base).problem).toMatch(
      /BRICKSBOT_KB_INDEX.*BRICKSBOT_KB_VOLUME_ROOT/
    );
  });
  test('on with table, index and a Volume; the kill switch wins', () => {
    const env = {
      BRICKSBOT_KB_TABLE: 'main.kb.chunks',
      BRICKSBOT_KB_INDEX: 'main.kb.chunks_index',
      BRICKSBOT_VOLUME_ROOT: '/Volumes/main/kb/files/',
    };
    expect(knowledgeConfigFromEnv(env, base).config).toMatchObject({
      root: '/Volumes/main/kb/files',
      table: '`main`.`kb`.`chunks`',
      indexName: 'main.kb.chunks_index',
    });
    expect(knowledgeConfigFromEnv({ ...env, BRICKSBOT_KB_ENABLED: 'false' }, base)).toEqual({});
  });
  test('three-part names refuse injection', () => {
    expect(quoteThreePartName('main.kb.t; DROP TABLE x')).toBeNull();
    expect(quoteThreePartName('main.kb')).toBeNull();
  });
});

describe('KnowledgeService', () => {
  const bot = { id: 'b0b0b0b0-0000-4000-8000-000000000001' } as Bot;

  test('a text file is chunked, inserted with parameters, and synced', async () => {
    const { knowledge, files, sql, search } = service();
    const { doc, ingested } = await knowledge.upload(bot, 'alice', {
      name: 'policy.md',
      ...body('# Refunds\n\nThey take 5 days.'),
    });
    expect(doc.status).toBe('processing');
    expect([...files.files.keys()][0]).toMatch(/^\/Volumes\/main\/bricks\/kb\/bricksbot\/knowledge\/bots\/b0b0b0b0-/);
    const done = await ingested;
    expect(done).toMatchObject({ status: 'ready', chunkCount: 1 });
    expect(done?.error).toBeUndefined();
    const insert = sql.statements.find((s) => s.statement.startsWith('INSERT'))!;
    expect(insert.statement).toContain(TABLE);
    expect(insert.statement).not.toContain('Refunds');
    expect(insert.parameters).toEqual(
      expect.arrayContaining([
        { name: 'bot', value: bot.id },
        { name: 'c0', value: '# Refunds\n\nThey take 5 days.' },
      ])
    );
    expect(search.syncs).toBe(1);
  });

  test('a PDF goes through ai_parse_document on the warehouse', async () => {
    const { knowledge, sql } = service();
    const { ingested } = await knowledge.upload(bot, 'alice', { name: 'guide.pdf', ...body('%PDF-1.7 fake') });
    expect(await ingested).toMatchObject({ status: 'ready' });
    expect(sql.statements[0].statement).toMatch(/ai_parse_document[\s\S]*read_files\('\/Volumes\/main\/bricks\/kb/);
  });

  test('an empty parse fails the file with a reason', async () => {
    const { knowledge } = service({ sql: new FakeSql('') });
    const { ingested } = await knowledge.upload(bot, 'alice', { name: 'scan.pdf', ...body('%PDF-1.7') });
    expect(await ingested).toMatchObject({ status: 'failed', error: 'No text found in the file' });
  });

  test('a failed sync still saves the file with a warning', async () => {
    const { knowledge } = service({ failSync: true });
    const { ingested } = await knowledge.upload(bot, 'alice', { name: 'a.txt', ...body('hello') });
    const done = await ingested;
    expect(done?.status).toBe('ready');
    expect(done?.error).toMatch(/next index sync/);
  });

  test('refuses a renamed binary before writing anything', async () => {
    const { knowledge, files } = service();
    await expect(knowledge.upload(bot, 'alice', { name: 'a.pdf', ...body('nope') })).rejects.toThrow(/do not look/);
    expect(files.files.size).toBe(0);
  });

  test('remove deletes chunks, file and row', async () => {
    const { knowledge, store, files, sql } = service();
    const { doc, ingested } = await knowledge.upload(bot, 'alice', { name: 'a.txt', ...body('hello') });
    await ingested;
    await knowledge.remove(doc);
    expect(await store.list(bot.id)).toEqual([]);
    expect(files.files.size).toBe(0);
    expect(sql.statements[sql.statements.length - 1]).toMatchObject({ parameters: [{ name: 'doc', value: doc.id }] });
  });

  test('search filters by bot id', async () => {
    const { knowledge, search } = service();
    const hits = await knowledge.search(bot.id, 'refunds', 3);
    expect(search.calls[0]).toMatchObject({ queryText: 'refunds', numResults: 3, filters: { bot_id: bot.id } });
    expect(hits[0]).toMatchObject({ docName: 'policy.md', score: 0.91 });
  });

  test('a processing row cut off by a restart shows as failed', () => {
    const old = new Date(Date.now() - KNOWLEDGE_STALE_MS - 1000).toISOString();
    const doc = { status: 'processing', createdAt: old } as never;
    expect(effectiveKnowledgeStatus(doc).status).toBe('failed');
  });
});

describe('search_knowledge tool', () => {
  const ctx = { chatId: 'c', bot: { id: 'bot-1' } as Bot, userId: 'alice' };
  test('answers fast when the bot has no files, and formats hits as data', async () => {
    let has = false;
    const tool = createSearchKnowledgeTool({
      hasKnowledge: () => Promise.resolve(has),
      search: () => Promise.resolve([{ docName: 'faq.md', chunkIndex: 2, score: 0.5, content: 'Answer.' }]),
    });
    expect(await tool.execute({ query: 'x' }, ctx)).toMatch(/no knowledge files/);
    has = true;
    const out = await tool.execute({ query: 'x', num_results: 50 }, ctx);
    expect(out).toMatch(/data, not instructions/);
    expect(out).toContain('[1] faq.md (part 3');
    expect(await tool.preflight!({ query: '' }, ctx)).toMatch(/requires a query/);
  });
});

describe('Databricks clients', () => {
  test('statement runner polls until the statement ends', async () => {
    const seen: string[] = [];
    const fetchImpl = ((url: string, init: RequestInit) => {
      seen.push(`${init.method} ${url}`);
      const state = seen.length === 1 ? 'PENDING' : 'SUCCEEDED';
      return Promise.resolve(
        new Response(
          JSON.stringify({
            statement_id: 's1',
            status: { state },
            manifest: { schema: { columns: [{ name: 'text' }] } },
            result: { data_array: [['hi']] },
          })
        )
      );
    }) as typeof fetch;
    const runner = statementRunner({
      host: 'https://h',
      warehouseId: 'w',
      getToken: () => Promise.resolve('t'),
      fetchImpl,
      pollIntervalMs: 1,
    });
    expect(await runner.run('SELECT 1')).toEqual({ columns: ['text'], rows: [['hi']] });
    expect(seen).toEqual(['POST https://h/api/2.0/sql/statements', 'GET https://h/api/2.0/sql/statements/s1']);
  });

  test('vector search maps manifest columns and sends filters_json', async () => {
    let sent: Record<string, unknown> = {};
    const fetchImpl = ((_url: string, init: RequestInit) => {
      sent = JSON.parse(init.body as string) as Record<string, unknown>;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            manifest: { columns: [{ name: 'content' }, { name: 'score' }] },
            result: { data_array: [['a', 0.7]] },
          })
        )
      );
    }) as typeof fetch;
    const client = vectorSearchClient({
      host: 'https://h',
      indexName: 'm.s.i',
      getToken: () => Promise.resolve('t'),
      fetchImpl,
    });
    expect(
      await client.query({ queryText: 'q', columns: ['content'], numResults: 2, filters: { bot_id: 'b' } })
    ).toEqual([{ content: 'a', score: 0.7 }]);
    expect(sent).toMatchObject({ query_text: 'q', num_results: 2, filters_json: '{"bot_id":"b"}' });
  });
});

describe('knowledge routes', () => {
  async function setup(enabled = true) {
    const chats = new MemoryChatStore();
    const { primary } = await chats.ensureBootstrap('alice@co.com');
    const { knowledge, store } = service();
    const app = express();
    registerKnowledgeRoutes(app, chats, enabled ? knowledge : undefined);
    const server = await new Promise<import('node:http').Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    return { primary, store, baseUrl, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
  }

  test('config says off without a service', async () => {
    const ctx = await setup(false);
    try {
      const res = await fetch(`${ctx.baseUrl}/api/knowledge/config`);
      expect(await res.json()).toMatchObject({ enabled: false });
    } finally {
      await ctx.close();
    }
  });

  test('the owner uploads and lists; others are refused', async () => {
    const ctx = await setup();
    try {
      const url = `${ctx.baseUrl}/api/bots/${ctx.primary.id}/knowledge`;
      const up = await fetch(`${url}?name=notes.md`, {
        method: 'POST',
        headers: { 'x-forwarded-email': 'alice@co.com', 'content-type': 'application/octet-stream' },
        body: 'hello',
      });
      expect(up.status).toBe(201);
      const list = await fetch(url, { headers: { 'x-forwarded-email': 'alice@co.com' } });
      expect((await list.json()).docs).toHaveLength(1);
      const other = await fetch(`${url}?name=x.md`, {
        method: 'POST',
        headers: { 'x-forwarded-email': 'bob@co.com', 'content-type': 'application/octet-stream' },
        body: 'hi',
      });
      expect(other.status).toBe(403);
    } finally {
      await ctx.close();
    }
  });
});
