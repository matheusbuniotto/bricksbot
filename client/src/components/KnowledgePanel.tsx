import { BookOpen, Loader2, Trash2, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { KnowledgeConfig, KnowledgeDoc } from '../../../shared/knowledge/types';
import { formatBytes } from '../lib/attachments-api';
import {
  deleteKnowledge,
  fetchKnowledgeConfig,
  knowledgeProblem,
  listKnowledge,
  uploadKnowledge,
} from '../lib/knowledge-api';

/** The bot's knowledge base. Hidden unless the install turned it on; only the owner adds or deletes files. */
export function KnowledgePanel({ botId, isOwner }: { botId: string; isOwner: boolean }) {
  const [config, setConfig] = useState<KnowledgeConfig | null>(null);
  const [docs, setDocs] = useState<KnowledgeDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let current = true;
    fetchKnowledgeConfig().then(
      (next) => current && setConfig(next),
      () => current && setConfig(null)
    );
    return () => {
      current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      setDocs(await listKnowledge(botId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load the knowledge base');
    }
  }, [botId]);

  useEffect(() => {
    if (config?.enabled) void refresh();
  }, [config?.enabled, refresh]);

  // Indexing runs after the upload returns; poll while a file is still processing.
  const processing = docs?.some((doc) => doc.status === 'processing') ?? false;
  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(() => void refresh(), 4000);
    return () => clearInterval(timer);
  }, [processing, refresh]);

  if (!config?.enabled) return null;

  async function add(files: FileList | null) {
    if (!files?.length || !config) return;
    setUploading(true);
    try {
      let count = docs?.length ?? 0;
      for (const file of Array.from(files)) {
        const problem = knowledgeProblem(file, config, count);
        if (problem) {
          setError(problem);
          continue;
        }
        await uploadKnowledge(botId, file);
        count += 1;
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (input.current) input.current.value = '';
    }
  }

  async function remove(doc: KnowledgeDoc) {
    try {
      await deleteKnowledge(botId, doc.id);
      setDocs((list) => list?.filter((other) => other.id !== doc.id) ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete the file');
    }
  }

  return (
    <section className="bot-details-section" aria-label="Knowledge base">
      <div className="flex items-center justify-between">
        <h3 className="bot-details-section-label">Knowledge base</h3>
        {isOwner ? (
          <>
            <input
              ref={input}
              type="file"
              multiple
              hidden
              accept={config.extensions.map((extension) => `.${extension}`).join(',')}
              onChange={(event) => void add(event.target.files)}
            />
            <button
              type="button"
              className="bot-details-file-action"
              aria-label="Add knowledge files"
              disabled={uploading}
              onClick={() => input.current?.click()}
            >
              {uploading ? (
                <Loader2 size={14} className="animate-spin" aria-hidden />
              ) : (
                <Upload size={14} aria-hidden />
              )}
            </button>
          </>
        ) : null}
      </div>
      {error ? <p className="chat-error">{error}</p> : null}
      {docs && docs.length === 0 ? (
        <div className="bot-details-empty">
          <p className="bot-details-empty-title">No knowledge files</p>
          <p className="bot-details-empty-copy">
            {isOwner
              ? `Add ${config.extensions.join(', ')} files. The bot searches them with search_knowledge.`
              : 'The bot owner can add files this bot searches before it answers.'}
          </p>
        </div>
      ) : docs ? (
        <div className="bot-details-card">
          <ul className="bot-details-file-list">
            {docs.map((doc) => (
              <li key={doc.id} className="bot-details-file-row" title={doc.error ?? undefined}>
                <span className="bot-details-file-icon is-blue" aria-hidden>
                  <BookOpen size={14} strokeWidth={2} />
                </span>
                <span className="bot-details-file-name" title={doc.name}>
                  {doc.name}
                </span>
                <span className="bot-details-file-meta">
                  {formatBytes(doc.sizeBytes)}
                  {doc.status === 'processing'
                    ? ' · indexing'
                    : doc.status === 'failed'
                      ? ' · failed'
                      : ` · ${doc.chunkCount} parts${doc.error ? ' · sync pending' : ''}`}
                </span>
                {isOwner ? (
                  <button
                    type="button"
                    className="bot-details-file-action"
                    aria-label={`Delete ${doc.name}`}
                    onClick={() => void remove(doc)}
                  >
                    <Trash2 size={14} aria-hidden />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="marketplace-privacy-note">
        Searched as each person, so Unity Catalog decides who can read it. Anyone with SELECT on the index can read
        every bot&apos;s files there.
      </p>
    </section>
  );
}
