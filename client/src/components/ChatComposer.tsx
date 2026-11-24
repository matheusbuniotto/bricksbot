import { ArrowUp, FileText, Loader2, Paperclip, Square, X } from 'lucide-react';
import { useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import type { AttachmentConfig, AttachmentRef } from '../../../shared/chat/attachments';
import { attachmentProblem, deleteAttachment, formatBytes, uploadAttachment } from '../lib/attachments-api';

/** A file on its way to the next message: uploading, ready (it has a server id) or refused. */
type Chip = { key: string; name: string; sizeBytes: number; ref?: AttachmentRef; error?: string };

export function ChatComposer({
  disabled,
  placeholder,
  accent,
  running,
  chatId,
  attachments,
  onSend,
  onStop,
}: {
  disabled?: boolean;
  placeholder?: string;
  accent: string;
  /** The bot is busy with something this composer did not send (e.g. an approved tool). */
  running?: boolean;
  chatId?: string | null;
  /** The server's attachment limits; absent or disabled hides the paperclip. */
  attachments?: AttachmentConfig | null;
  onSend: (content: string, attachments: AttachmentRef[]) => Promise<void>;
  onStop: () => Promise<void>;
}) {
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const [chips, setChips] = useState<Chip[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const label = placeholder ?? 'Message';
  const canAttach = Boolean(attachments?.enabled && chatId && !disabled);
  const uploading = chips.some((chip) => !chip.ref && !chip.error);

  function addFiles(files: File[]) {
    if (!attachments || !chatId || files.length === 0) return;
    let count = chips.filter((chip) => !chip.error).length;
    setProblem(null);
    for (const file of files) {
      const refused = attachmentProblem(file, attachments, count);
      if (refused) {
        setProblem(refused);
        continue;
      }
      count += 1;
      const key = crypto.randomUUID();
      setChips((current) => [...current, { key, name: file.name, sizeBytes: file.size }]);
      uploadAttachment(chatId, file).then(
        (ref) => setChips((current) => current.map((chip) => (chip.key === key ? { ...chip, ref } : chip))),
        (err: unknown) => {
          setChips((current) => current.filter((chip) => chip.key !== key));
          setProblem(`${file.name}: ${err instanceof Error ? err.message : 'upload failed'}`);
        }
      );
    }
  }

  function removeChip(chip: Chip) {
    setChips((current) => current.filter((other) => other.key !== chip.key));
    // The file is already on the Volume; taking it off the message takes it off the Volume too.
    if (chip.ref && chatId) void deleteAttachment(chatId, chip.ref.id).catch(() => undefined);
  }

  async function submit() {
    const content = value.trim();
    if (!content || sending || uploading || disabled) return;
    const sent = chips.flatMap((chip) => (chip.ref ? [chip.ref] : []));
    setValue('');
    setChips([]);
    setProblem(null);
    setSending(true);
    try {
      await onSend(content, sent);
    } catch {
      setValue((current) => current || content);
      setChips((current) => [
        ...sent.map((ref) => ({ key: ref.id, name: ref.name, sizeBytes: ref.sizeBytes, ref })),
        ...current,
      ]);
    } finally {
      setSending(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  function onDrop(event: DragEvent) {
    if (!canAttach || !event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    addFiles([...event.dataTransfer.files]);
  }

  function onPaste(event: ClipboardEvent) {
    const files = [...event.clipboardData.files];
    if (!canAttach || files.length === 0) return;
    event.preventDefault();
    addFiles(files);
  }

  return (
    <>
      {chips.length > 0 || problem ? (
        <div className="composer-files">
          {chips.map((chip) => (
            <span key={chip.key} className="composer-file" title={chip.name}>
              {chip.ref ? <FileText size={14} aria-hidden /> : <Loader2 size={14} className="spin" aria-hidden />}
              <span className="composer-file-name">{chip.name}</span>
              <span className="composer-file-size">{chip.ref ? formatBytes(chip.sizeBytes) : 'Uploading…'}</span>
              <button type="button" aria-label={`Remove ${chip.name}`} onClick={() => removeChip(chip)}>
                <X size={12} aria-hidden />
              </button>
            </span>
          ))}
          {problem ? (
            <span className="composer-file-error" role="alert">
              {problem}
            </span>
          ) : null}
        </div>
      ) : null}
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        onDragOver={(event) => canAttach && event.preventDefault()}
        onDrop={onDrop}
      >
        {attachments?.enabled ? (
          <>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              accept={attachments.extensions.map((extension) => `.${extension}`).join(',')}
              onChange={(event) => {
                addFiles([...(event.target.files ?? [])]);
                event.target.value = '';
              }}
            />
            <button
              type="button"
              className="composer-plus"
              aria-label="Attach files"
              title={`Attach ${attachments.extensions.join(', ')} (up to ${formatBytes(attachments.maxBytes)})`}
              disabled={!canAttach}
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip size={18} strokeWidth={2} />
            </button>
          </>
        ) : null}
        <textarea
          ref={inputRef}
          value={value}
          rows={1}
          placeholder={label}
          aria-label={label}
          disabled={disabled}
          onChange={(event) => setValue(event.target.value)}
          onPaste={onPaste}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        {sending || running ? (
          <button
            type="button"
            className="composer-send"
            aria-label="Stop"
            style={{ background: accent }}
            onClick={() => void onStop()}
          >
            <Square size={14} strokeWidth={2} fill="currentColor" />
          </button>
        ) : (
          <button
            type="submit"
            className="composer-send"
            aria-label="Send"
            disabled={disabled || uploading || !value.trim()}
            style={{ background: accent }}
          >
            <ArrowUp size={18} strokeWidth={2} />
          </button>
        )}
      </form>
    </>
  );
}
