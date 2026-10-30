import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Select } from './Select';
import type { Bot } from '../../../shared/chat/types';
import {
  ROUTINE_WEBHOOK_HEADER,
  ROUTINE_WEBHOOK_PATH_TEMPLATE,
  defaultCronDescribeLocale,
  describeCronExpression,
  routineWebhookPath,
  type Routine,
} from '../../../shared/routines/types';

function copyText(value: string) {
  void navigator.clipboard?.writeText(value);
}

function CopyableField({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="flex gap-1 items-stretch">
        <input
          readOnly
          value={value}
          className={`field text-[11px] flex-1 min-w-0 ${mono ? 'font-mono' : ''}`}
          onFocus={(e) => e.target.select()}
        />
        <button type="button" className="pane-btn pane-btn-ghost" onClick={() => copyText(value)}>
          Copy
        </button>
      </div>
    </div>
  );
}

function newestRoutine(routines: Routine[]): Routine | null {
  if (routines.length === 0) return null;
  return [...routines].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

export function RoutinesPanel({
  bots,
  routines,
  lastWebhookSecret,
  busyId,
  onCreate,
  onToggle,
  onRun,
}: {
  bots: Bot[];
  routines: Routine[];
  lastWebhookSecret: string | null;
  busyId: string | null;
  onCreate: (input: { botId: string; name: string; cron: string; prompt: string }) => Promise<void>;
  onToggle: (id: string, enabled: boolean) => Promise<void>;
  onRun: (id: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [cron, setCron] = useState('0 9 * * *');
  const [prompt, setPrompt] = useState('');
  const [botId, setBotId] = useState(bots[0]?.id ?? '');
  const [creating, setCreating] = useState(false);
  const [trustRoutineId, setTrustRoutineId] = useState<string | null>(null);

  const selectedBotId = botId || bots[0]?.id || '';
  const cronLocale = useMemo(() => defaultCronDescribeLocale(), []);
  const createCronHint = describeCronExpression(cron.trim() || '0 9 * * *', cronLocale);
  const appOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const showBotSelect = bots.length > 1;

  useEffect(() => {
    if (bots[0]?.id && !bots.some((b) => b.id === botId)) {
      setBotId(bots[0].id);
    }
  }, [bots, botId]);

  useEffect(() => {
    if (!lastWebhookSecret) {
      setTrustRoutineId(null);
      return;
    }
    const match = newestRoutine(routines);
    if (match) setTrustRoutineId(match.id);
  }, [lastWebhookSecret, routines]);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (!selectedBotId || !name.trim() || !cron.trim()) return;
    setCreating(true);
    try {
      await onCreate({
        botId: selectedBotId,
        name: name.trim(),
        cron: cron.trim(),
        prompt: prompt.trim() || `Scheduled routine: ${name.trim()}`,
      });
      setName('');
      setPrompt('');
      setOpen(false);
    } finally {
      setCreating(false);
    }
  }

  const trustWebhookUrl =
    trustRoutineId && appOrigin ? `${appOrigin}${routineWebhookPath(trustRoutineId)}` : null;

  return (
    <div className="px-4 py-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Routines</p>
          <p className="text-xs text-muted-foreground">Scheduled jobs for this bot</p>
        </div>
        <button
          type="button"
          className="pane-btn pane-btn-ghost"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Cancel' : 'Add'}
        </button>
      </div>

      {lastWebhookSecret ? (
        <div className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2.5 space-y-2">
          <p className="text-xs text-foreground font-medium">
            Webhook secret (shown once — copy now)
          </p>
          <CopyableField label="Secret" value={lastWebhookSecret} />
          {trustWebhookUrl ? (
            <CopyableField label="Webhook URL (POST)" value={trustWebhookUrl} />
          ) : (
            <CopyableField label="Webhook path (POST)" value={ROUTINE_WEBHOOK_PATH_TEMPLATE} />
          )}
          <CopyableField
            label={`Header (${ROUTINE_WEBHOOK_HEADER})`}
            value={`${ROUTINE_WEBHOOK_HEADER}: ${lastWebhookSecret}`}
          />
          <CopyableField
            label="Or Authorization"
            value={`Authorization: Bearer ${lastWebhookSecret}`}
          />
        </div>
      ) : null}

      {open ? (
        <form className="space-y-2 rounded-lg border border-border/60 px-3 py-3" onSubmit={handleCreate}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            className="field"
            autoFocus
          />
          <input
            value={cron}
            onChange={(e) => setCron(e.target.value)}
            placeholder="Cron (e.g. 0 9 * * *)"
            className="field font-mono"
          />
          <p className="text-[11px] text-muted-foreground">{createCronHint}</p>
          {showBotSelect ? (
            <Select
              ariaLabel="Bot"
              value={selectedBotId}
              onChange={setBotId}
              options={bots.map((bot) => ({ value: bot.id, label: bot.name }))}
            />
          ) : null}
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Prompt (optional)"
            rows={2}
            className="field"
          />
          <button
            type="submit"
            className="pane-btn pane-btn-solid"
            disabled={creating || !bots.length}
          >
            Create
          </button>
        </form>
      ) : null}

      {routines.length === 0 && !open ? (
        <div className="rounded-lg border border-dashed border-border/70 px-4 py-8 text-center">
          <p className="text-sm text-muted-foreground">No routines yet</p>
          <p className="mt-1 text-xs text-muted-foreground/80">
            Ask the bot in chat to add one, or tap Add.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {routines.map((routine) => {
            const scheduleLabel = describeCronExpression(routine.cron, cronLocale);
            return (
              <li
                key={routine.id}
                className="rounded-lg border border-border/60 px-3 py-2.5 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{routine.name}</p>
                    <p className="text-xs text-muted-foreground">{scheduleLabel}</p>
                  </div>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0 pt-0.5">
                    <input
                      type="checkbox"
                      checked={routine.enabled}
                      onChange={(e) => void onToggle(routine.id, e.target.checked)}
                    />
                    On
                  </label>
                </div>
                <button
                  type="button"
                  className="pane-btn pane-btn-outline"
                  disabled={busyId === routine.id}
                  onClick={() => void onRun(routine.id)}
                >
                  {busyId === routine.id ? 'Running…' : 'Test'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
