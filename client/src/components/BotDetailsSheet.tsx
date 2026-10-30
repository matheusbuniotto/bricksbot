import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { X } from 'lucide-react';
import type { ArtifactPinNotice } from '../../../shared/chat/artifact-pin-notice';
import type { Bot, Message } from '../../../shared/chat/types';
import type { Routine } from '../../../shared/routines/types';
import type { SandboxUiStatus } from '../../../shared/sandbox/types';
import { listArtifactPinsFromMessages } from '../lib/artifact-pins';
import { RoutinesPanel } from './RoutinesPanel';

export type BotDetailsTab = 'details' | 'library' | 'computer';

const TAB_LABELS: Record<BotDetailsTab, string> = {
  details: 'Details',
  library: 'Library',
  computer: 'Computer',
};

const KIND_LABELS: Record<ArtifactPinNotice['artifactKind'], string> = {
  note: 'File',
  sql: 'SQL',
  volume_path: 'Volume',
  link: 'Link',
  table: 'Table',
  chart: 'Chart',
  mermaid: 'Diagram',
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

const tabClass = (active: boolean) =>
  [
    'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
    active
      ? 'bg-muted text-foreground'
      : 'text-muted-foreground hover:text-foreground hover:bg-muted/60',
  ].join(' ');

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
}) {
  const [tab, setTab] = useState<BotDetailsTab>('details');
  const [resizing, setResizing] = useState(false);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const files = listArtifactPinsFromMessages(messages);

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
      // Pane is on the right: drag left → wider.
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
      <header className="shrink-0 border-b border-border/80 px-4 py-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-baseline gap-2 min-w-0">
            <h2 className="text-sm font-medium truncate">{bot.name}</h2>
            {bot.isPrimary ? (
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0">
                Primary
              </span>
            ) : null}
          </div>
          <button
            type="button"
            className="bot-details-close"
            aria-label="Close details"
            onClick={onClose}
          >
            <X size={16} strokeWidth={2} aria-hidden />
          </button>
        </div>
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Bot details sections">
          {(Object.keys(TAB_LABELS) as BotDetailsTab[]).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={tabClass(tab === key)}
              onClick={() => setTab(key)}
            >
              {TAB_LABELS[key]}
            </button>
          ))}
        </div>
      </header>

      <div className="bot-details-scroll flex-1 min-h-0 overflow-y-auto">
        {tab === 'details' ? (
          <div role="tabpanel" aria-label="Details">
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
          <div role="tabpanel" aria-label="Library" className="px-4 py-4 space-y-3">
            <p className="text-xs text-muted-foreground">Files sent in this chat</p>
            {files.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/70 px-4 py-8 text-center">
                <p className="text-sm text-muted-foreground">No files yet</p>
              </div>
            ) : (
              <ul className="space-y-1.5">
                {files.map(({ messageId, notice, createdAt }) => {
                  const when = formatPinTime(createdAt);
                  return (
                    <li
                      key={messageId}
                      className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/50"
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        {KIND_LABELS[notice.artifactKind].slice(0, 3)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm truncate">{notice.title}</p>
                        {when ? (
                          <p className="text-[11px] text-muted-foreground">{when}</p>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : null}

        {tab === 'computer' ? (
          <div role="tabpanel" aria-label="Computer" className="px-4 py-4 space-y-4">
            {!sandboxStatus?.enabled ? (
              <div className="py-6 flex flex-col items-center justify-center text-center gap-2">
                <div className="size-16 rounded-xl border border-dashed border-border/70 bg-muted/30" />
                <p className="text-sm font-medium text-foreground">Computer is asleep</p>
                <p className="text-xs text-muted-foreground max-w-[220px] leading-relaxed">
                  Sandbox tools are off (`SANDBOX_BACKEND=off`). Enable databricks, python_exec, or
                  e2b to run code in an isolated Linux sandbox.
                </p>
              </div>
            ) : (
              <>
                <div className="rounded-lg border border-border/80 bg-muted/20 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-foreground">
                      {(sandboxStatus.session?.backend ?? sandboxStatus.backend) === 'databricks'
                        ? 'Databricks Sandbox'
                        : (sandboxStatus.session?.backend ?? sandboxStatus.backend) ===
                            'python_exec'
                          ? 'Databricks system.ai.python_exec'
                          : 'E2B Sandbox'}
                    </span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {bot.presence === 'working' || sandboxStatus.session?.status === 'running'
                        ? 'Working'
                        : sandboxStatus.session?.status &&
                            sandboxStatus.session.status !== 'deleted'
                          ? sandboxStatus.session.status
                          : 'Asleep'}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
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
                    <div className="flex items-center gap-2 pt-1">
                      {sandboxStatus.session.status === 'ready' ||
                      sandboxStatus.session.status === 'running' ||
                      sandboxStatus.session.status === 'creating' ? (
                        <button
                          type="button"
                          disabled={sandboxBusy}
                          onClick={() => void onStopSandbox?.()}
                          className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
                        >
                          Stop
                        </button>
                      ) : null}
                      <button
                        type="button"
                        disabled={sandboxBusy}
                        onClick={() => void onDeleteSandbox?.()}
                        className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-destructive hover:bg-muted disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  ) : null}
                </div>

                {sandboxStatus.recentEvents.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">Recent sandbox activity</p>
                    <ul className="space-y-1.5">
                      {sandboxStatus.recentEvents.map((event) => {
                        const when = formatPinTime(event.createdAt);
                        return (
                          <li
                            key={event.id}
                            className="rounded-md border border-border/60 px-2.5 py-1.5 text-xs space-y-0.5"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium truncate">{event.summary}</span>
                              {event.exitCode !== undefined ? (
                                <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                                  exit {event.exitCode}
                                </span>
                              ) : null}
                            </div>
                            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                              <span>{event.artifactName ?? event.type}</span>
                              {when ? <span>{when}</span> : null}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
