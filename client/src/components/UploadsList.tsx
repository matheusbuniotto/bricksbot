import { Download, FileSpreadsheet, FileText, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AttachmentSummary } from '../../../shared/chat/attachments';
import { attachmentDownloadUrl, deleteAttachment, formatBytes, listAttachments } from '../lib/attachments-api';

/** The files this person uploaded to the open chat. `refreshKey` changes when a message may have sent some. */
export function UploadsList({ chatId, refreshKey }: { chatId: string; refreshKey: number }) {
  const [files, setFiles] = useState<AttachmentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    listAttachments(chatId).then(
      (list) => current && (setFiles(list), setError(null)),
      (err: unknown) => current && setError(err instanceof Error ? err.message : 'Unable to load uploads')
    );
    return () => {
      current = false;
    };
  }, [chatId, refreshKey]);

  async function remove(file: AttachmentSummary) {
    try {
      await deleteAttachment(chatId, file.id);
      setFiles((list) => list?.filter((other) => other.id !== file.id) ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete the file');
    }
  }

  if (!files) return error ? <p className="chat-error">{error}</p> : null;
  return (
    <>
      {error ? <p className="chat-error">{error}</p> : null}
      {files.length === 0 ? (
        <div className="bot-details-empty">
          <p className="bot-details-empty-title">No uploads yet</p>
          <p className="bot-details-empty-copy">Files you attach in this chat appear here.</p>
        </div>
      ) : (
        <div className="bot-details-card">
          <ul className="bot-details-file-list">
            {files.map((file) => {
              const Icon = file.kind === 'pdf' ? FileText : FileSpreadsheet;
              return (
                <li key={file.id} className="bot-details-file-row">
                  <span className={`bot-details-file-icon is-${file.kind === 'pdf' ? 'red' : 'green'}`} aria-hidden>
                    <Icon size={14} strokeWidth={2} />
                  </span>
                  <span className="bot-details-file-name" title={file.name}>
                    {file.name}
                  </span>
                  <span className="bot-details-file-meta">
                    {formatBytes(file.sizeBytes)}
                    {file.sent ? '' : ' · not sent'}
                  </span>
                  <a
                    className="bot-details-file-action"
                    href={attachmentDownloadUrl(chatId, file.id)}
                    download={file.name}
                    aria-label={`Download ${file.name}`}
                  >
                    <Download size={14} aria-hidden />
                  </a>
                  <button
                    type="button"
                    className="bot-details-file-action"
                    aria-label={`Delete ${file.name}`}
                    onClick={() => void remove(file)}
                  >
                    <Trash2 size={14} aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
}
