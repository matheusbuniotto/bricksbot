import { Button } from '@databricks/appkit-ui/react';
import { useState, type FormEvent } from 'react';
import type { Bot } from '../../../shared/chat/types';
import type { Routine } from '../../../shared/routines/types';

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

  const selectedBotId = botId || bots[0]?.id || '';

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
        <p className="text-[11px] text-muted-foreground break-all">
          Copy webhook secret now (shown once):{' '}
          <span className="font-mono text-foreground">{lastWebhookSecret}</span>
        </p>
      ) : null}

      {open ? (
        <form className="space-y-2" onSubmit={handleCreate}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <input
            value={cron}
            onChange={(e) => setCron(e.target.value)}
            placeholder="Cron (e.g. 0 9 * * *)"
            className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs font-mono outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <select
            value={selectedBotId}
            onChange={(e) => setBotId(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {bots.map((bot) => (
              <option key={bot.id} value={bot.id}>
                {bot.name}
              </option>
            ))}
          </select>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Prompt (optional)"
            rows={2}
            className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
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
          routines.map((routine) => (
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
              <p className="text-[11px] font-mono text-muted-foreground truncate">
                {routine.cron}
              </p>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busyId === routine.id}
                onClick={() => void onRun(routine.id)}
              >
                {busyId === routine.id ? 'Running…' : 'Run now'}
              </Button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
