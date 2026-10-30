import { Button } from '@databricks/appkit-ui/react';
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
        <Button type="button" size="sm" variant="ghost" onClick={() => copyText(value)}>
          Copy
        </Button>
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
    <div className="border-t border-border/80 px-3 py-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Routines
        </p>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>
          {open ? 'Cancel' : 'Add'}
        </Button>
      </div>

      {lastWebhookSecret ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-2 py-2 space-y-2">
          <p className="text-[11px] text-foreground font-medium">
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
          <p className="text-[10px] text-muted-foreground">
            Lakeflow Jobs call this URL on schedule. Store the secret in Databricks secrets scope{' '}
            <span className="font-mono">bricksbot</span>; see{' '}
            <span className="font-mono">resources/jobs/routine-webhook.job.yml.stub</span>.
          </p>
        </div>
      ) : null}

      {open ? (
        <form className="space-y-2" onSubmit={handleCreate}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            className="field"
          />
          <input
            value={cron}
            onChange={(e) => setCron(e.target.value)}
            placeholder="Cron (e.g. 0 9 * * *)"
            className="field font-mono"
          />
          <p className="text-[11px] text-muted-foreground">{createCronHint}</p>
          <Select
            ariaLabel="Bot"
            value={selectedBotId}
            onChange={setBotId}
            options={bots.map((bot) => ({ value: bot.id, label: bot.name }))}
          />
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Prompt (optional)"
            rows={2}
            className="field"
          />
          <Button type="submit" size="sm" disabled={creating || !bots.length}>
            Create
          </Button>
        </form>
      ) : null}

      <ul className="space-y-2 max-h-48 overflow-y-auto">
        {routines.length === 0 ? (
          <li className="text-xs text-muted-foreground">No routines yet.</li>
        ) : (
          routines.map((routine) => {
            const scheduleLabel = describeCronExpression(routine.cron, cronLocale);
            const path = routineWebhookPath(routine.id);
            const fullUrl = appOrigin ? `${appOrigin}${path}` : path;
            return (
              <li
                key={routine.id}
                className="rounded-md border border-border/70 px-2 py-2 space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium truncate">{routine.name}</p>
                  <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={routine.enabled}
                      onChange={(e) => void onToggle(routine.id, e.target.checked)}
                    />
                    On
                  </label>
                </div>
                <p className="text-[11px] text-foreground">{scheduleLabel}</p>
                <p className="text-[10px] font-mono text-muted-foreground truncate">{routine.cron}</p>
                <div className="flex gap-1 items-center">
                  <input
                    readOnly
                    value={fullUrl}
                    title={ROUTINE_WEBHOOK_PATH_TEMPLATE}
                    className="field font-mono text-[10px] flex-1 min-w-0 py-1"
                    onFocus={(e) => e.target.select()}
                  />
                  <Button type="button" size="sm" variant="ghost" onClick={() => copyText(fullUrl)}>
                    Copy
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Auth: header{' '}
                  <span className="font-mono">{ROUTINE_WEBHOOK_HEADER}</span> or{' '}
                  <span className="font-mono">Authorization: Bearer</span> (secret shown once at
                  create).
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={busyId === routine.id}
                  onClick={() => void onRun(routine.id)}
                >
                  {busyId === routine.id ? 'Running…' : 'Test'}
                </Button>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
