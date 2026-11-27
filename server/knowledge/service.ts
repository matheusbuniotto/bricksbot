import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import {
  KNOWLEDGE_DOCS_PER_BOT,
  KNOWLEDGE_EXTENSIONS,
  KNOWLEDGE_MAX_BYTES,
  KNOWLEDGE_TEXT_MAX_BYTES,
  knowledgeKindFor,
  type KnowledgeDoc,
  type KnowledgeHit,
  type KnowledgeKind,
  type KnowledgeStore,
} from '../../shared/knowledge/types.js';
import type { Bot } from '../../shared/chat/types.js';
import type { AttachmentFiles } from '../attachments/upload.js';
import { sanitizeVolumeBotId } from '../agents/tools/volume-namespace.js';
import { asString } from '../lib/coerce.js';
import { chunkText } from './chunk.js';
import type { SqlParam, StatementRunner, VectorSearchClient } from './databricks.js';

export class KnowledgeError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export interface KnowledgeServiceOptions {
  /** Volume folder for the files, such as /Volumes/main/bricksbot/knowledge/bricksbot. */
  root: string;
  /** Back-quoted `catalog`.`schema`.`table` holding the chunks (Change Data Feed on). */
  table: string;
  store: KnowledgeStore;
  /** Files API with the uploader's own token. */
  files: AttachmentFiles;
  /** Warehouse statements with the uploader's own token (parse, insert, delete). */
  sql: StatementRunner;
  /** Index queries with the signed-in caller's token. */
  search: VectorSearchClient;
  /** Tried in order to sync the index: the uploader first, then the App identity. */
  syncers: VectorSearchClient[];
  log?: (message: string) => void;
}

const ROWS_PER_INSERT = 25;
const MAX_TEXT_CHARS = 2_000_000;

const startsWith = (head: Buffer, magic: string) => head.subarray(0, magic.length).equals(Buffer.from(magic, 'latin1'));

/** The extension picks the kind; the leading bytes must agree. */
export function validateKnowledgeFile(name: string, bytes: Buffer): string | null {
  const kind = knowledgeKindFor(name);
  if (!kind) return `Unsupported file type. Allowed: ${Object.keys(KNOWLEDGE_EXTENSIONS).join(', ')}`;
  const extension = name.split('.').pop()!.toLowerCase();
  const head = bytes.subarray(0, 4096);
  const ok =
    extension === 'pdf'
      ? startsWith(head, '%PDF-')
      : kind === 'document'
        ? startsWith(head, 'PK\x03\x04')
        : !head.includes(0) && !startsWith(head, '%PDF-') && !startsWith(head, 'PK\x03\x04');
  return ok ? null : `The contents do not look like a .${extension} file`;
}

function displayName(raw: string): string {
  const printable = [...(raw.split(/[\\/]/).pop() ?? '')].filter((char) => char.charCodeAt(0) >= 32);
  return printable.join('').trim().slice(0, 200);
}

/** A SQL string literal. Paths are built from sanitized segments, so this is belt and braces. */
const sqlLiteral = (value: string) => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

async function readAll(body: AsyncIterable<Uint8Array>, declared: number, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.length;
    if (size > declared || size > limit) throw new KnowledgeError(413, 'The upload is longer than its Content-Length');
    chunks.push(Buffer.from(chunk));
  }
  if (size !== declared) throw new KnowledgeError(400, 'The upload is shorter than its Content-Length');
  return Buffer.concat(chunks);
}

export class KnowledgeService {
  constructor(private readonly options: KnowledgeServiceOptions) {}

  get store(): KnowledgeStore {
    return this.options.store;
  }

  /**
   * Saves the file to the Volume as the uploader and starts indexing it. Returns the `processing` row at once;
   * `ingested` settles when the chunks are written (tests await it). Call inside the request's auth context so
   * the background work keeps the uploader's token.
   */
  async upload(
    bot: Bot,
    userId: string,
    input: { name: string; length: number; body: AsyncIterable<Uint8Array> }
  ): Promise<{ doc: KnowledgeDoc; ingested: Promise<KnowledgeDoc | null> }> {
    const { store, files, root } = this.options;
    const name = displayName(input.name);
    const kind = knowledgeKindFor(name);
    if (!kind) throw new KnowledgeError(415, 'Unsupported file type');
    if (!(input.length > 0)) throw new KnowledgeError(400, 'The file is empty');
    const limit = kind === 'text' ? KNOWLEDGE_TEXT_MAX_BYTES : KNOWLEDGE_MAX_BYTES;
    if (input.length > limit) {
      throw new KnowledgeError(413, `The file is too large (limit ${limit / 1024 / 1024} MiB)`);
    }
    if ((await store.list(bot.id)).length >= KNOWLEDGE_DOCS_PER_BOT) {
      throw new KnowledgeError(400, `A bot holds at most ${KNOWLEDGE_DOCS_PER_BOT} knowledge files`);
    }
    const botSegment = sanitizeVolumeBotId(bot.id);
    if (!botSegment) throw new KnowledgeError(400, 'Invalid bot id');

    const bytes = await readAll(input.body, input.length, limit);
    const invalid = validateKnowledgeFile(name, bytes);
    if (invalid) throw new KnowledgeError(415, invalid);

    const id = randomUUID();
    const safeName = name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80);
    const volumePath = `${root}/knowledge/bots/${botSegment}/${id.slice(0, 8)}-${safeName}`;
    await files.ensureDirectory(path.posix.dirname(volumePath));
    await files.put(volumePath, Readable.from([bytes]), bytes.length);
    const doc = await store.create({ id, botId: bot.id, userId, name, kind, sizeBytes: bytes.length, volumePath });
    const ingested = this.ingest(doc, bytes).catch(async (err: unknown) => {
      const reason = err instanceof Error ? err.message : 'Indexing failed';
      this.options.log?.(`[bricksbot] Knowledge file ${doc.id.slice(0, 8)} failed: ${reason}`);
      return store.update(bot.id, doc.id, { status: 'failed', error: reason.slice(0, 500) }).catch(() => null);
    });
    return { doc, ingested };
  }

  private async extractText(doc: KnowledgeDoc, kind: KnowledgeKind, bytes: Buffer): Promise<string> {
    if (kind === 'text') return new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '');
    // read_files() takes a literal path, not a parameter marker.
    const { rows } = await this.options.sql.run(
      `WITH parsed AS (
         SELECT ai_parse_document(content) AS doc FROM read_files(${sqlLiteral(doc.volumePath)}, format => 'binaryFile')
       )
       SELECT
         concat_ws('\\n\\n', transform(try_cast(doc:document:elements AS ARRAY<VARIANT>), e -> try_cast(e:content AS STRING))) AS text,
         try_cast(doc:error_status AS STRING) AS error
       FROM parsed`
    );
    const [text, error] = (rows[0] ?? []) as [string | null, string | null];
    if (!text && error && error !== 'null') throw new Error(`ai_parse_document: ${error.slice(0, 300)}`);
    return text ?? '';
  }

  private async ingest(doc: KnowledgeDoc, bytes: Buffer): Promise<KnowledgeDoc | null> {
    const { sql, table, store } = this.options;
    const text = (await this.extractText(doc, doc.kind, bytes)).slice(0, MAX_TEXT_CHARS);
    const chunks = chunkText(text);
    if (chunks.length === 0) throw new Error('No text found in the file');

    // A retry must not double the rows.
    await sql.run(`DELETE FROM ${table} WHERE doc_id = :doc`, [{ name: 'doc', value: doc.id }]);
    for (let start = 0; start < chunks.length; start += ROWS_PER_INSERT) {
      const batch = chunks.slice(start, start + ROWS_PER_INSERT);
      const params: SqlParam[] = [
        { name: 'doc', value: doc.id },
        { name: 'bot', value: doc.botId },
        { name: 'name', value: doc.name },
      ];
      const values = batch.map((content, offset) => {
        const index = start + offset;
        params.push(
          { name: `id${offset}`, value: `${doc.id}:${index}` },
          { name: `i${offset}`, value: String(index), type: 'INT' },
          { name: `c${offset}`, value: content }
        );
        return `(:id${offset}, :doc, :bot, :name, :i${offset}, :c${offset}, current_timestamp())`;
      });
      await sql.run(
        `INSERT INTO ${table} (chunk_id, doc_id, bot_id, doc_name, chunk_index, content, created_at) VALUES ${values.join(', ')}`,
        params
      );
    }
    // Deleted while it was being indexed: take the rows back out instead of leaving them unowned.
    if (!(await store.get(doc.botId, doc.id))) {
      await sql.run(`DELETE FROM ${table} WHERE doc_id = :doc`, [{ name: 'doc', value: doc.id }]);
      return null;
    }
    const warning = await this.syncIndex();
    return store.update(doc.botId, doc.id, { status: 'ready', chunkCount: chunks.length, error: warning ?? undefined });
  }

  /** Null when a sync was requested; otherwise a warning to show next to the file. */
  private async syncIndex(): Promise<string | null> {
    const reasons: string[] = [];
    for (const syncer of this.options.syncers) {
      try {
        await syncer.sync();
        return null;
      } catch (err) {
        reasons.push(err instanceof Error ? err.message : 'sync failed');
      }
    }
    this.options.log?.(`[bricksbot] Knowledge index sync failed: ${reasons.join(' | ')}`);
    return 'Saved, but the index sync could not be started. It becomes searchable on the next index sync.';
  }

  /** Deletes the chunks, then the file, then the row, all as the caller. */
  async remove(doc: KnowledgeDoc): Promise<void> {
    await this.options.sql.run(`DELETE FROM ${this.options.table} WHERE doc_id = :doc`, [
      { name: 'doc', value: doc.id },
    ]);
    await this.options.files.remove(doc.volumePath);
    await this.options.store.delete(doc.botId, doc.id);
    await this.syncIndex();
  }

  async search(botId: string, query: string, numResults: number): Promise<KnowledgeHit[]> {
    const rows = await this.options.search.query({
      queryText: query,
      columns: ['doc_name', 'chunk_index', 'content'],
      numResults,
      filters: { bot_id: botId },
    });
    return rows.map((row) => ({
      docName: asString(row.doc_name),
      chunkIndex: Number(row.chunk_index ?? 0),
      score: Number(row.score ?? 0),
      content: asString(row.content),
    }));
  }
}
