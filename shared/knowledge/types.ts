/**
 * Bot knowledge base (optional RAG). The bot owner adds files; the bytes live on a Unity Catalog Volume, the text
 * chunks in a Delta table, and a Databricks Vector Search index (Delta Sync, managed embeddings) serves the search.
 */

export const KNOWLEDGE_MAX_BYTES = 25 * 1024 * 1024;
/** Plain-text files are decoded in the App, so they get a tighter cap than parsed documents. */
export const KNOWLEDGE_TEXT_MAX_BYTES = 10 * 1024 * 1024;
export const KNOWLEDGE_DOCS_PER_BOT = 50;

/** `text` is decoded in the App; `document` goes through `ai_parse_document` on the SQL warehouse. */
export type KnowledgeKind = 'text' | 'document';

export const KNOWLEDGE_EXTENSIONS: Record<string, KnowledgeKind> = {
  txt: 'text',
  md: 'text',
  markdown: 'text',
  csv: 'text',
  tsv: 'text',
  json: 'text',
  pdf: 'document',
  docx: 'document',
  pptx: 'document',
};

export function knowledgeKindFor(fileName: string): KnowledgeKind | null {
  if (!fileName.includes('.')) return null;
  return KNOWLEDGE_EXTENSIONS[fileName.split('.').pop()?.toLowerCase() ?? ''] ?? null;
}

/** `processing` until the chunks are written and the index sync is requested; `failed` keeps the reason. */
export type KnowledgeStatus = 'processing' | 'ready' | 'failed';

export interface KnowledgeDoc {
  id: string;
  botId: string;
  /** Who uploaded it: always the bot owner at upload time. */
  userId: string;
  name: string;
  kind: KnowledgeKind;
  sizeBytes: number;
  volumePath: string;
  status: KnowledgeStatus;
  chunkCount: number;
  /** Why it failed, or a warning on a ready doc (such as an index sync that has to wait). */
  error?: string;
  createdAt: string;
}

export interface KnowledgeStore {
  create(input: Omit<KnowledgeDoc, 'createdAt' | 'status' | 'chunkCount'>): Promise<KnowledgeDoc>;
  get(botId: string, id: string): Promise<KnowledgeDoc | null>;
  list(botId: string): Promise<KnowledgeDoc[]>;
  update(
    botId: string,
    id: string,
    patch: Partial<Pick<KnowledgeDoc, 'status' | 'chunkCount' | 'error'>>
  ): Promise<KnowledgeDoc | null>;
  delete(botId: string, id: string): Promise<KnowledgeDoc | null>;
}

export interface KnowledgeConfig {
  enabled: boolean;
  maxBytes: number;
  maxTextBytes: number;
  maxDocs: number;
  extensions: string[];
}

export function knowledgeConfig(enabled: boolean): KnowledgeConfig {
  return {
    enabled,
    maxBytes: KNOWLEDGE_MAX_BYTES,
    maxTextBytes: KNOWLEDGE_TEXT_MAX_BYTES,
    maxDocs: KNOWLEDGE_DOCS_PER_BOT,
    extensions: Object.keys(KNOWLEDGE_EXTENSIONS),
  };
}

/** A processing row older than this was cut off by a restart; it shows as failed. */
export const KNOWLEDGE_STALE_MS = 20 * 60 * 1000;

export function effectiveKnowledgeStatus(doc: KnowledgeDoc, now = Date.now()): KnowledgeDoc {
  if (doc.status !== 'processing' || now - Date.parse(doc.createdAt) < KNOWLEDGE_STALE_MS) return doc;
  return { ...doc, status: 'failed', error: 'Processing was interrupted. Delete the file and add it again.' };
}

/** One search hit as the tool returns it. */
export interface KnowledgeHit {
  docName: string;
  chunkIndex: number;
  score: number;
  content: string;
}
