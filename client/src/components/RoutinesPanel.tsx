import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Select } from './Select';
import type { Bot } from '../../../shared/chat/types';
import type { ModelCatalogView } from '../lib/chat-api';
import {
  ROUTINE_WEBHOOK_HEADER,
  ROUTINE_WEBHOOK_PATH_TEMPLATE,
  defaultCronDescribeLocale,
  describeCronExpression,
  routineWebhookPath,
  unixCronToQuartzHint,
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

export type RoutineUpdatePatch = {
  name?: string;
  cron?: string;
  prompt?: string;
  enabled?: boolean;
  /** Catalog model id; null follows the bot. */
  model?: string | null;
};

export function RoutinesPanel({
  bots,
  routines,
  models,
  lastWebhookSecret,
  busyId,
  onCreate,
  onUpdate,
  onRun,
  onDelete,
}: {
  bots: Bot[];
  routines: Routine[];
  /** Models a routine owner may override the bot's with; none hides the picker. */
  models?: ModelCatalogView | null;
  lastWebhookSecret: string | null;
  busyId: string | null;
  onCreate: (input: {
    botId: string;
    name: string;
    cron: string;
    prompt: string;
    model?: string | null;
  }) => Promise<void>;
  onUpdate: (id: string, patch: RoutineUpdatePatch) => Promise<void>;
  onRun: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [cron, setCron] = useState('0 9 * * *');
  const [prompt, setPrompt] = useState('');
  // '' follows the bot's model.
  const [model, setModel] = useState('');
  const [botId, setBotId] = useState(bots[0]?.id ?? '');
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [trustRoutineId, setTrustRoutineId] = useState<string | null>(null);

  const selectedBotId = botId || bots[0]?.id || '';
  const cronLocale = useMemo(() => defaultCronDescribeLocale(), []);
  const createCronHint = describeCronExpression(cron.trim() || '0 9 * * *', cronLocale);
  const createQuartzHint = unixCronToQuartzHint(cron.trim() || '0 9 * * *');
  const appOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const showBotSelect = bots.length > 1;
  const modelSelect = models?.models.length ? (
    <Select
      ariaLabel="Model"
      value={model}
      onChange={setModel}
      options={[
        { value: '', label: "Bot's model" },
        ...models.models.map((option) => ({ value: option.id, label: option.label })),
      ]}
    />
  ) : null;

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

  useEffect(() => {
    if (editingId && !routines.some((r) => r.id === editingId)) {
      setEditingId(null);
    }
  }, [routines, editingId]);

  function startCreate() {
    setEditingId(null);
    setName('');
    setCron('0 9 * * *');
    setPrompt('');
    setModel('');
    setOpen(true);
  }

  function startEdit(routine: Routine) {
    setOpen(false);
    setEditingId(routine.id);
    setName(routine.name);
    setCron(routine.cron);
    setPrompt(routine.prompt);
    setModel(routine.model ?? '');
  }

  function cancelForms() {
    setOpen(false);
    setEditingId(null);
    setName('');
    setCron('0 9 * * *');
    setPrompt('');
    setModel('');
  }

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
        model: model || null,
      });
      cancelForms();
    } finally {
      setCreating(false);
    }
  }

  async function handleSaveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editingId || !name.trim() || !cron.trim() || !prompt.trim()) return;
    setSaving(true);
    try {
      await onUpdate(editingId, {
        name: name.trim(),
        cron: cron.trim(),
        prompt: prompt.trim(),
        model: model || null,
      });
      cancelForms();
    } finally {
      setSaving(false);
    }
  }

  const trustWebhookUrl = trustRoutineId && appOrigin ? `${appOrigin}${routineWebhookPath(trustRoutineId)}` : null;

  const editCronHint = describeCronExpression(cron.trim() || '0 9 * * *', cronLocale);
  const editQuartzHint = unixCronToQuartzHint(cron.trim() || '0 9 * * *');

  return (
    <div className="bot-details-routines space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="bot-details-section-label bot-details-section-label-tight">Routines</p>
          <p className="text-xs text-muted-foreground">Scheduled jobs for this bot</p>
        </div>
        <button
          type="button"
          className="pane-btn pane-btn-ghost"
          onClick={() => {
            if (open || editingId) cancelForms();
            else startCreate();
          }}
        >
          {open || editingId ? 'Cancel' : 'Add'}
        </button>
      </div>

      {lastWebhookSecret ? (
        <div className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2.5 space-y-2">
          <p className="text-xs text-foreground font-medium">Webhook secret (shown once — copy now)</p>
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
          <CopyableField label="Or Authorization" value={`Authorization: Bearer ${lastWebhookSecret}`} />
          <p className="text-[11px] text-muted-foreground leading-snug">
            For scheduled runs, store this secret in scope <span className="font-mono">bricksbot</span> / key{' '}
            <span className="font-mono">routine-webhook-key</span>, set bundle variables{' '}
            <span className="font-mono">routine_webhook_app_base_url</span> and{' '}
            <span className="font-mono">routine_webhook_routine_id</span>, then{' '}
            <span className="font-mono">databricks bundle deploy</span>. See README{' '}
            <span className="font-mono">#wiring-a-scheduled-job</span>.
          </p>
        </div>
      ) : null}

      {open ? (
        <form className="space-y-2 rounded-lg border border-border/60 px-3 py-3" onSubmit={handleCreate}>
          <p className="text-xs font-medium text-foreground">New routine</p>
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
          {createQuartzHint ? (
            <p className="text-[11px] text-muted-foreground">
              Job schedule (Quartz): <span className="font-mono">{createQuartzHint}</span>
            </p>
          ) : null}
          {showBotSelect ? (
            <Select
              ariaLabel="Bot"
              value={selectedBotId}
              onChange={setBotId}
              options={bots.map((bot) => ({ value: bot.id, label: bot.name }))}
            />
          ) : null}
          {modelSelect}
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Prompt (optional)"
            rows={2}
            className="field"
          />
          <button type="submit" className="pane-btn pane-btn-solid" disabled={creating || !bots.length}>
            Create
          </button>
        </form>
      ) : null}

      {routines.length === 0 && !open ? (
        <div className="rounded-lg border border-dashed border-border/70 px-4 py-8 text-center">
          <p className="text-sm text-muted-foreground">No routines yet</p>
          <p className="mt-1 text-xs text-muted-foreground/80">Ask the bot in chat to add one, or tap Add.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {routines.map((routine) => {
            const scheduleLabel = describeCronExpression(routine.cron, cronLocale);
            const quartzHint = unixCronToQuartzHint(routine.cron);
            const isEditing = editingId === routine.id;

            if (isEditing) {
              return (
                <li key={routine.id} className="rounded-lg border border-border/60 px-3 py-2.5 space-y-2">
                  <form className="space-y-2" onSubmit={handleSaveEdit}>
                    <p className="text-xs font-medium text-foreground">Edit routine</p>
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
                    <p className="text-[11px] text-muted-foreground">{editCronHint}</p>
                    {editQuartzHint ? (
                      <p className="text-[11px] text-muted-foreground">
                        Job schedule (Quartz): <span className="font-mono">{editQuartzHint}</span>
                      </p>
                    ) : null}
                    {modelSelect}
                    <textarea
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      placeholder="Prompt"
                      rows={3}
                      className="field"
                    />
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="submit"
                        className="pane-btn pane-btn-solid"
                        disabled={saving || busyId === routine.id}
                      >
                        {saving ? 'Saving…' : 'Save'}
                      </button>
                      <button type="button" className="pane-btn pane-btn-ghost" disabled={saving} onClick={cancelForms}>
                        Cancel
                      </button>
                    </div>
                  </form>
                </li>
              );
            }

            return (
              <li key={routine.id} className="rounded-lg border border-border/60 px-3 py-2.5 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{routine.name}</p>
                    <p className="text-xs text-muted-foreground">{scheduleLabel}</p>
                    {quartzHint ? (
                      <p className="text-[11px] text-muted-foreground/90 font-mono">Quartz: {quartzHint}</p>
                    ) : null}
                    {routine.model ? (
                      <p className="text-[11px] text-muted-foreground/90 font-mono">Model: {routine.model}</p>
                    ) : null}
                    {routine.prompt ? (
                      <p className="mt-1 text-[11px] text-muted-foreground line-clamp-2">{routine.prompt}</p>
                    ) : null}
                  </div>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0 pt-0.5">
                    <input
                      type="checkbox"
                      checked={routine.enabled}
                      disabled={busyId === routine.id || Boolean(editingId)}
                      onChange={(e) => void onUpdate(routine.id, { enabled: e.target.checked })}
                    />
                    On
                  </label>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="pane-btn pane-btn-outline"
                    disabled={busyId === routine.id || Boolean(editingId)}
                    onClick={() => void onRun(routine.id)}
                  >
                    {busyId === routine.id ? 'Running…' : 'Test'}
                  </button>
                  <button
                    type="button"
                    className="pane-btn pane-btn-ghost"
                    disabled={busyId === routine.id || Boolean(editingId)}
                    onClick={() => startEdit(routine)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="pane-btn pane-btn-ghost"
                    disabled={busyId === routine.id || Boolean(editingId)}
                    onClick={() => {
                      if (window.confirm(`Delete routine “${routine.name}”?`)) {
                        void onDelete(routine.id);
                      }
                    }}
                  >
                    Delete
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
