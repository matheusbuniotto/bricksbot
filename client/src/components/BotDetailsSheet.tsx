import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { FileSpreadsheet, FileText, Link2, Pencil, Table2, X } from 'lucide-react';
import type { ArtifactPinNotice } from '../../../shared/chat/artifact-pin-notice';
import type { Bot, Message } from '../../../shared/chat/types';
import type { Routine } from '../../../shared/routines/types';
import type { SandboxUiStatus } from '../../../shared/sandbox/types';
import { listArtifactPinsFromMessages } from '../lib/artifact-pins';
import {
  BotFace,
  botColor,
  botLook,
  encodeLook,
  type BotLook,
  COLORS,
} from './BotFace';
import { BotPicker } from './BotPicker';
import { RoutinesPanel } from './RoutinesPanel';

export type BotDetailsTab = 'details' | 'library' | 'computer';

const TAB_LABELS: Record<BotDetailsTab, string> = {
  details: 'Detalhes',
  library: 'Biblioteca',
  computer: 'Computador',
};

const LIBRARY_PAGE_SIZE = 6;
const RECENT_MS = 7 * 24 * 60 * 60 * 1000;

type LibraryFile = {
  messageId: string;
  notice: ArtifactPinNotice;
  createdAt?: string;
};

function formatPinTime(iso: string | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function fileTone(kind: ArtifactPinNotice['artifactKind'], title: string): 'green' | 'red' | 'blue' | 'amber' | 'slate' {
  const lower = title.toLowerCase();
  if (lower.endsWith('.csv') || lower.endsWith('.xlsx') || lower.endsWith('.tsv') || kind === 'table') {
    return 'green';
  }
  if (lower.endsWith('.pdf') || kind === 'note') return 'red';
  if (kind === 'sql' || kind === 'chart' || kind === 'mermaid') return 'blue';
  if (kind === 'link') return 'amber';
  if (kind === 'volume_path') return 'slate';
  return 'slate';
}

function FileKindIcon({ kind, title }: { kind: ArtifactPinNotice['artifactKind']; title: string }) {
  const tone = fileTone(kind, title);
  const Icon =
    kind === 'link'
      ? Link2
      : kind === 'table' || title.toLowerCase().endsWith('.csv')
        ? FileSpreadsheet
        : kind === 'sql'
          ? Table2
          : FileText;
  return (
    <span className={`bot-details-file-icon is-${tone}`} aria-hidden>
      <Icon size={14} strokeWidth={2} />
    </span>
  );
}

function LibraryFileList({
  files,
  expanded,
  onExpand,
}: {
  files: LibraryFile[];
  expanded: boolean;
  onExpand: () => void;
}) {
  const visible = expanded ? files : files.slice(0, LIBRARY_PAGE_SIZE);
  const canShowMore = !expanded && files.length > LIBRARY_PAGE_SIZE;

  if (files.length === 0) return null;

  return (
    <div className="bot-details-card">
      <ul className="bot-details-file-list">
        {visible.map(({ messageId, notice }) => (
          <li key={messageId} className="bot-details-file-row">
            <FileKindIcon kind={notice.artifactKind} title={notice.title} />
            <span className="bot-details-file-name" title={notice.title}>
              {notice.title}
            </span>
          </li>
        ))}
      </ul>
      {canShowMore ? (
        <button type="button" className="bot-details-show-more" onClick={onExpand}>
          Mostrar mais
        </button>
      ) : null}
    </div>
  );
}

export function BotDetailsSheet({
  bot,
  messages,
  routines,
  routineBusyId,
  lastWebhookSecret,
  sandboxStatus,
  sandboxBusy,
  width,
  minWidth,
  maxWidth,
  onWidthChange,
  onCreateRoutine,
  onUpdateRoutine,
  onRunRoutine,
  onDeleteRoutine,
  onStopSandbox,
  onDeleteSandbox,
  onClose,
  onChangeLook,
  onUpdateBotConfig,
}: {
  bot: Bot;
  messages: Message[];
  routines: Routine[];
  routineBusyId: string | null;
  lastWebhookSecret: string | null;
  sandboxStatus?: SandboxUiStatus | null;
  sandboxBusy?: boolean;
  width: number;
  minWidth: number;
  maxWidth: number;
  onWidthChange: (width: number) => void;
  onCreateRoutine: (input: {
    botId: string;
    name: string;
    cron: string;
    prompt: string;
  }) => Promise<void>;
  onUpdateRoutine: (
    id: string,
    patch: { name?: string; cron?: string; prompt?: string; enabled?: boolean },
  ) => Promise<void>;
  onRunRoutine: (id: string) => Promise<void>;
  onDeleteRoutine: (id: string) => Promise<void>;
  onStopSandbox?: () => Promise<void>;
  onDeleteSandbox?: () => Promise<void>;
  onClose: () => void;
  onChangeLook: (botId: string, avatarLabel: string) => void | Promise<void>;
  onUpdateBotConfig?: (
    botId: string,
    patch: { description?: string; isShared?: boolean },
  ) => Promise<void>;
}) {
  const [tab, setTab] = useState<BotDetailsTab>('details');
  const [libraryExpanded, setLibraryExpanded] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [editLook, setEditLook] = useState<BotLook | null>(null);
  const [descriptionDraft, setDescriptionDraft] = useState(bot.description ?? '');

  useEffect(() => {
    setDescriptionDraft(bot.description ?? '');
  }, [bot.id, bot.description]);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const files = listArtifactPinsFromMessages(messages);
  const accent = botColor(bot.id, bot.isPrimary);

  const [renderEpoch] = useState(() => Date.now());
  const { recentFiles, olderFiles } = useMemo(() => {
    const now = renderEpoch;
    const recent: LibraryFile[] = [];
    const older: LibraryFile[] = [];
    for (const file of files) {
      const ts = file.createdAt ? Date.parse(file.createdAt) : Number.NaN;
      if (Number.isFinite(ts) && now - ts <= RECENT_MS) recent.push(file);
      else older.push(file);
    }
    // If everything is undated / older, keep a single “Mais antigos” section like Grok.
    if (recent.length === 0) return { recentFiles: [] as LibraryFile[], olderFiles: files };
    return { recentFiles: recent, olderFiles: older };
  }, [files]);

  const onResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      dragRef.current = { startX: event.clientX, startWidth: width };
      setResizing(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [width],
  );

  const onResizePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      const next = drag.startWidth + (drag.startX - event.clientX);
      onWidthChange(Math.min(maxWidth, Math.max(minWidth, next)));
    },
    [maxWidth, minWidth, onWidthChange],
  );

  const onResizePointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setResizing(false);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* already released */
    }
  }, []);

  return (
    <aside
      className={
        resizing
          ? 'bot-details-pane is-resizing hidden md:flex flex-none min-h-0 flex-col border-l border-border bg-background'
          : 'bot-details-pane hidden md:flex flex-none min-h-0 flex-col border-l border-border bg-background'
      }
      style={{ width }}
      aria-label={`Details for ${bot.name}`}
    >
      <div
        className="bot-details-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize details"
        aria-valuemin={minWidth}
        aria-valuemax={maxWidth}
        aria-valuenow={Math.round(width)}
        tabIndex={0}
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
        onPointerCancel={onResizePointerUp}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') {
            event.preventDefault();
            onWidthChange(width + 16);
          } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            onWidthChange(width - 16);
          } else if (event.key === 'Home') {
            event.preventDefault();
            onWidthChange(maxWidth);
          } else if (event.key === 'End') {
            event.preventDefault();
            onWidthChange(minWidth);
          }
        }}
      />

      <header className="bot-details-header">
        <button
          type="button"
          className="bot-details-close"
          aria-label="Close details"
          onClick={onClose}
        >
          <X size={18} strokeWidth={2} aria-hidden />
        </button>

        <div className="bot-details-hero">
          <button
            type="button"
            className="bot-details-face-btn"
            aria-label={`Change look for ${bot.name}`}
            onClick={() => setEditLook({ ...botLook(bot.id, bot.isPrimary) })}
          >
            <BotFace
              color={accent}
              size={56}
              botId={bot.id}
              track
              presence={bot.presence}
            />
            <span className="bot-details-face-edit" aria-hidden>
              <Pencil size={14} strokeWidth={2.25} />
            </span>
          </button>
          <h2 className="bot-details-name">{bot.name}</h2>
        </div>

        <div className="bot-details-tabs" role="tablist" aria-label="Bot details sections">
          {(Object.keys(TAB_LABELS) as BotDetailsTab[]).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={tab === key ? 'bot-details-tab is-active' : 'bot-details-tab'}
              onClick={() => setTab(key)}
            >
              {TAB_LABELS[key]}
            </button>
          ))}
        </div>
      </header>

      <div className="bot-details-scroll flex-1 min-h-0 overflow-y-auto">
        {tab === 'details' ? (
          <div role="tabpanel" aria-label="Detalhes" className="bot-details-panel">
            {!bot.isPrimary && onUpdateBotConfig ? (
              <section className="bot-details-section">
                <h3 className="bot-details-section-label">Marketplace & Comportamento</h3>
                <div className="bot-details-card">
                  <div className="marketplace-toggle-row">
                    <span className="marketplace-toggle-label">Compartilhar no Marketplace</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={Boolean(bot.isShared)}
                      className={bot.isShared ? 'marketplace-toggle is-on' : 'marketplace-toggle'}
                      onClick={() => void onUpdateBotConfig(bot.id, { isShared: !bot.isShared })}
                    >
                      <span className="marketplace-toggle-knob" />
                    </button>
                  </div>
                  <p className="marketplace-toggle-status">
                    {bot.isShared
                      ? 'Publicado no Marketplace (comportamento e skills visíveis a outros usuários)'
                      : 'Privado (apenas você vê e usa este bot)'}
                  </p>
                  <div className="bot-details-field">
                    <label htmlFor="bot-desc-input" className="bot-details-field-label">
                      Instruções do Bot
                    </label>
                    <textarea
                      id="bot-desc-input"
                      className="dialog-textarea"
                      rows={3}
                      value={descriptionDraft}
                      placeholder="Instruções ou papel durável deste bot..."
                      onChange={(e) => setDescriptionDraft(e.target.value)}
                    />
                    {descriptionDraft !== (bot.description ?? '') ? (
                      <button
                        type="button"
                        className="pane-btn pane-btn-solid mt-2 self-start"
                        onClick={() =>
                          void onUpdateBotConfig(bot.id, { description: descriptionDraft.trim() })
                        }
                      >
                        Salvar instruções
                      </button>
                    ) : null}
                  </div>
                  <p className="marketplace-privacy-note">
                    Mensagens, histórico, aprovações e memórias são 100% privadas por usuário.
                  </p>
                </div>
              </section>
            ) : null}
            <RoutinesPanel
              bots={[bot]}
              routines={routines}
              lastWebhookSecret={lastWebhookSecret}
              busyId={routineBusyId}
              onCreate={onCreateRoutine}
              onUpdate={onUpdateRoutine}
              onRun={onRunRoutine}
              onDelete={onDeleteRoutine}
            />
          </div>
        ) : null}

        {tab === 'library' ? (
          <div role="tabpanel" aria-label="Biblioteca" className="bot-details-panel">
            {files.length === 0 ? (
              <div className="bot-details-empty">
                <p className="bot-details-empty-title">Nenhum arquivo ainda</p>
                <p className="bot-details-empty-copy">
                  Páginas, arquivos e apps que este bot cria aparecem aqui.
                </p>
              </div>
            ) : (
              <div className="bot-details-sections">
                {recentFiles.length > 0 ? (
                  <section className="bot-details-section">
                    <h3 className="bot-details-section-label">Recentes</h3>
                    <LibraryFileList
                      files={recentFiles}
                      expanded={libraryExpanded}
                      onExpand={() => setLibraryExpanded(true)}
                    />
                  </section>
                ) : null}
                {olderFiles.length > 0 ? (
                  <section className="bot-details-section">
                    <h3 className="bot-details-section-label">Mais antigos</h3>
                    <LibraryFileList
                      files={olderFiles}
                      expanded={libraryExpanded}
                      onExpand={() => setLibraryExpanded(true)}
                    />
                  </section>
                ) : null}
              </div>
            )}
          </div>
        ) : null}

        {tab === 'computer' ? (
          <div role="tabpanel" aria-label="Computador" className="bot-details-panel">
            {!sandboxStatus?.enabled ? (
              <div className="bot-details-empty">
                <div className="bot-details-empty-art" />
                <p className="bot-details-empty-title">Computador dormindo</p>
                <p className="bot-details-empty-copy">
                  Sandbox tools are off (`SANDBOX_BACKEND=off`). Enable databricks, python_exec, or
                  e2b to run code in an isolated Linux sandbox.
                </p>
              </div>
            ) : (
              <div className="bot-details-sections">
                <section className="bot-details-section">
                  <h3 className="bot-details-section-label">Status</h3>
                  <div className="bot-details-card bot-details-computer-card">
                    <div className="bot-details-computer-top">
                      <span className="bot-details-computer-name">
                        {(sandboxStatus.session?.backend ?? sandboxStatus.backend) === 'databricks'
                          ? 'Databricks Sandbox'
                          : (sandboxStatus.session?.backend ?? sandboxStatus.backend) ===
                              'python_exec'
                            ? 'Databricks system.ai.python_exec'
                            : 'E2B Sandbox'}
                      </span>
                      <span className="bot-details-computer-badge">
                        {bot.presence === 'working' || sandboxStatus.session?.status === 'running'
                          ? 'Working'
                          : sandboxStatus.session?.status &&
                              sandboxStatus.session.status !== 'deleted'
                            ? sandboxStatus.session.status
                            : 'Asleep'}
                      </span>
                    </div>
                    <p className="bot-details-computer-copy">
                      {bot.presence === 'working' || sandboxStatus.session?.status === 'running'
                        ? 'Running command in isolated Linux sandbox…'
                        : sandboxStatus.session?.status === 'ready'
                          ? 'Sandbox session is active and ready for commands.'
                          : sandboxStatus.session?.status === 'stopped'
                            ? 'Sandbox is paused. Next command resumes this session (same home directory).'
                            : sandboxStatus.session?.status === 'failed'
                              ? 'Last sandbox operation reported an error.'
                              : 'Computer is asleep. Starts lazily on the first sandbox command.'}
                    </p>
                    {sandboxStatus.session && sandboxStatus.session.status !== 'deleted' ? (
                      <div className="bot-details-computer-actions">
                        {sandboxStatus.session.status === 'ready' ||
                        sandboxStatus.session.status === 'running' ||
                        sandboxStatus.session.status === 'creating' ? (
                          <button
                            type="button"
                            disabled={sandboxBusy}
                            onClick={() => void onStopSandbox?.()}
                            className="pane-btn pane-btn-outline"
                          >
                            Stop
                          </button>
                        ) : null}
                        <button
                          type="button"
                          disabled={sandboxBusy}
                          onClick={() => void onDeleteSandbox?.()}
                          className="pane-btn pane-btn-ghost"
                        >
                          Delete
                        </button>
                      </div>
                    ) : null}
                  </div>
                </section>

                {sandboxStatus.recentEvents.length > 0 ? (
                  <section className="bot-details-section">
                    <h3 className="bot-details-section-label">Atividade recente</h3>
                    <div className="bot-details-card">
                      <ul className="bot-details-event-list">
                        {sandboxStatus.recentEvents.map((event) => {
                          const when = formatPinTime(event.createdAt);
                          return (
                            <li key={event.id} className="bot-details-event-row">
                              <div className="bot-details-event-main">
                                <span className="bot-details-event-summary">{event.summary}</span>
                                {event.exitCode !== undefined ? (
                                  <span className="bot-details-event-exit">exit {event.exitCode}</span>
                                ) : null}
                              </div>
                              <div className="bot-details-event-meta">
                                <span>{event.artifactName ?? event.type}</span>
                                {when ? <span>{when}</span> : null}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </section>
                ) : null}
              </div>
            )}
          </div>
        ) : null}
      </div>

      {editLook ? (
        <div className="dialog-backdrop" role="presentation" onClick={() => setEditLook(null)}>
          <div
            className="dialog"
            role="dialog"
            aria-label="Mudar visual"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dialog-header-row">
              <h2>Mudar visual</h2>
              <button
                type="button"
                className="dialog-close-btn"
                aria-label="Fechar"
                onClick={() => setEditLook(null)}
              >
                <X size={18} />
              </button>
            </div>
            <BotPicker value={editLook} onChange={setEditLook} />
            <div className="dialog-actions">
              <button type="button" onClick={() => setEditLook(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="dialog-primary"
                style={{
                  background: COLORS[editLook.color]?.[0] ?? COLORS[7][0],
                  color: '#fff',
                  borderColor: 'transparent',
                }}
                onClick={() => {
                  void onChangeLook(bot.id, encodeLook(editLook));
                  setEditLook(null);
                }}
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
