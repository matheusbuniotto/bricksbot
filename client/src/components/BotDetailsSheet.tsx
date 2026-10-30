import { useState } from 'react';
import type { ArtifactPinNotice } from '../../../shared/chat/artifact-pin-notice';
import type { Bot, Message } from '../../../shared/chat/types';
import type { Routine } from '../../../shared/routines/types';
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
  onCreateRoutine,
  onToggleRoutine,
  onRunRoutine,
}: {
  bot: Bot;
  messages: Message[];
  routines: Routine[];
  routineBusyId: string | null;
  lastWebhookSecret: string | null;
  onCreateRoutine: (input: {
    botId: string;
    name: string;
    cron: string;
    prompt: string;
  }) => Promise<void>;
  onToggleRoutine: (id: string, enabled: boolean) => Promise<void>;
  onRunRoutine: (id: string) => Promise<void>;
}) {
  const [tab, setTab] = useState<BotDetailsTab>('details');
  const files = listArtifactPinsFromMessages(messages);

  return (
    <aside
      className="bot-details-pane hidden md:flex w-[min(360px,32vw)] flex-none min-h-0 flex-col border-l border-border bg-background"
      aria-label={`Details for ${bot.name}`}
    >
      <header className="shrink-0 border-b border-border/80 px-4 py-3 space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium truncate">{bot.name}</h2>
          {bot.isPrimary ? (
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0">
              Primary
            </span>
          ) : null}
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

      <div className="flex-1 min-h-0 overflow-y-auto">
        {tab === 'details' ? (
          <div role="tabpanel" aria-label="Details">
            <RoutinesPanel
              bots={[bot]}
              routines={routines}
              lastWebhookSecret={lastWebhookSecret}
              busyId={routineBusyId}
              onCreate={onCreateRoutine}
              onToggle={onToggleRoutine}
              onRun={onRunRoutine}
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
          <div
            role="tabpanel"
            aria-label="Computer"
            className="px-4 py-10 flex flex-col items-center justify-center text-center gap-2"
          >
            <div className="size-16 rounded-xl border border-dashed border-border/70 bg-muted/30" />
            <p className="text-sm font-medium text-foreground">Computer is asleep</p>
            <p className="text-xs text-muted-foreground max-w-[220px] leading-relaxed">
              Desktop tools come later. For now this bot works from chat.
            </p>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
