import { useState } from 'react';
import type { ArtifactPinNotice } from '../../../shared/chat/artifact-pin-notice';
import type { BotMemory, BotSkill } from '../../../shared/agents/memory/types';
import type { Bot, Message } from '../../../shared/chat/types';
import type { Routine } from '../../../shared/routines/types';
import { listArtifactPinsFromMessages } from '../lib/artifact-pins';
import type { SetupStatus } from '../lib/routines-api';
import { InstallWizard } from './InstallWizard';
import { MemoryPanel } from './MemoryPanel';
import { RoutinesPanel } from './RoutinesPanel';

export type BotDetailsTab = 'detalhes' | 'biblioteca' | 'computador';

const TAB_LABELS: Record<BotDetailsTab, string> = {
  detalhes: 'Detalhes',
  biblioteca: 'Biblioteca',
  computador: 'Computador',
};

const KIND_LABELS: Record<ArtifactPinNotice['artifactKind'], string> = {
  note: 'Note',
  sql: 'SQL',
  volume_path: 'Volume',
  link: 'Link',
};

const tabClass = (active: boolean) =>
  [
    'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
    active
      ? 'bg-muted text-foreground shadow-sm'
      : 'text-muted-foreground hover:text-foreground hover:bg-muted/60',
  ].join(' ');

export function BotDetailsSheet({
  bot,
  messages,
  setupStatus,
  installWizardDismissed,
  onInstallWizardDismiss,
  onInstallWizardOpen,
  routines,
  routineBusyId,
  lastWebhookSecret,
  memories,
  skills,
  onCreateRoutine,
  onToggleRoutine,
  onRunRoutine,
  onSaveMemory,
  onCreateSkill,
  onDeleteSkill,
}: {
  bot: Bot;
  messages: Message[];
  setupStatus: SetupStatus | null;
  installWizardDismissed: boolean;
  onInstallWizardDismiss: () => void;
  onInstallWizardOpen: () => void;
  routines: Routine[];
  routineBusyId: string | null;
  lastWebhookSecret: string | null;
  memories: BotMemory[];
  skills: BotSkill[];
  onCreateRoutine: (input: {
    botId: string;
    name: string;
    cron: string;
    prompt: string;
  }) => Promise<void>;
  onToggleRoutine: (id: string, enabled: boolean) => Promise<void>;
  onRunRoutine: (id: string) => Promise<void>;
  onSaveMemory: (key: string, content: string) => Promise<void>;
  onCreateSkill: (name: string, body: string) => Promise<void>;
  onDeleteSkill: (skillId: string) => Promise<void>;
}) {
  const [tab, setTab] = useState<BotDetailsTab>('detalhes');
  const pins = listArtifactPinsFromMessages(messages);
  const rosterBot = [bot];

  return (
    <aside
      className="bot-details-pane hidden md:flex w-[min(380px,34vw)] flex-none min-h-0 flex-col border-l border-border bg-background"
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
        {tab === 'detalhes' ? (
          <div role="tabpanel" aria-label="Detalhes">
            <InstallWizard
              status={setupStatus}
              dismissed={installWizardDismissed}
              onDismiss={onInstallWizardDismiss}
              onOpen={onInstallWizardOpen}
            />
            <RoutinesPanel
              bots={rosterBot}
              routines={routines}
              lastWebhookSecret={lastWebhookSecret}
              busyId={routineBusyId}
              onCreate={onCreateRoutine}
              onToggle={onToggleRoutine}
              onRun={onRunRoutine}
            />
            <MemoryPanel
              botId={bot.id}
              botName={bot.name}
              memories={memories}
              skills={skills}
              onSaveMemory={onSaveMemory}
              onCreateSkill={onCreateSkill}
              onDeleteSkill={onDeleteSkill}
            />
          </div>
        ) : null}

        {tab === 'biblioteca' ? (
          <div role="tabpanel" aria-label="Biblioteca" className="px-4 py-4 space-y-3">
            <p className="text-xs text-muted-foreground">
              Pinned findings from this chat (read-only). New pins appear after you allow{' '}
              <span className="font-medium text-foreground">Pin finding</span> in chat.
            </p>
            {pins.length === 0 ? (
              <p className="text-xs text-muted-foreground">No pins yet.</p>
            ) : (
              <ul className="space-y-2">
                {pins.map(({ messageId, notice }) => {
                  const summary = notice.summary?.trim() || notice.title.trim();
                  return (
                    <li
                      key={messageId}
                      className="rounded-md border border-border/70 px-3 py-2 space-y-1"
                    >
                      <p className="text-xs font-medium truncate">{notice.title}</p>
                      <p className="text-[11px] text-muted-foreground">
                        <span className="font-medium text-foreground/80">
                          {KIND_LABELS[notice.artifactKind]}
                        </span>
                        {summary && summary !== notice.title ? (
                          <span> · {summary}</span>
                        ) : null}
                      </p>
                      {notice.body ? (
                        <p className="text-[11px] text-muted-foreground line-clamp-3 whitespace-pre-wrap">
                          {notice.body}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : null}

        {tab === 'computador' ? (
          <div role="tabpanel" aria-label="Computador" className="px-4 py-6">
            <p className="text-xs text-muted-foreground leading-relaxed">
              Desktop and sandbox tools are deferred to Phase 5. When they ship, this tab will host
              computer-use sessions for {bot.name} — not in the MVP.
            </p>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
