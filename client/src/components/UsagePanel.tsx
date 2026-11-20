import { useEffect, useState, type FormEvent } from 'react';
import { Gauge, X } from 'lucide-react';
import type {
  BudgetAction,
  BudgetPeriod,
  BudgetStatus,
  BudgetedUsageView,
  UsageView,
} from '../../../shared/usage/types';
import { clearMyBudget, fetchUsage, setMyBudget } from '../lib/usage-api';
import { Select } from './Select';

/** Why a dollar figure is only an estimate. Shown as a tooltip on every cost. */
export const COST_TOOLTIP =
  'Estimated in USD from the provider-reported cost or the operator price list. Databricks Model Serving and Genie ' +
  'bill in DBU, so those calls have no dollar price here and are counted as $0. Check the workspace billing ' +
  'usage (system.billing.usage) for the real DBU figures.';

const usd = (amount: number) => `$${amount < 1 ? amount.toFixed(3) : amount.toFixed(2)}`;
const tokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const WINDOWS: Array<{ label: string; days: number }> = [
  { label: 'Today', days: 1 },
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
];

function sumSince(view: UsageView, days: number) {
  const since = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const rows = view.days.filter((row) => row.day >= since);
  return {
    costUsd: rows.reduce((sum, row) => sum + row.costUsd, 0),
    llmCalls: rows.reduce((sum, row) => sum + row.llmCalls, 0),
    unpricedCalls: rows.reduce((sum, row) => sum + row.unpricedCalls, 0),
    tokens: rows.reduce((sum, row) => sum + row.promptTokens + row.completionTokens, 0),
  };
}

export function UsageTable({ view }: { view: UsageView }) {
  return (
    <table className="w-full text-xs" aria-label="Usage">
      <thead>
        <tr className="text-left text-muted-foreground">
          <th className="font-normal py-1">Period</th>
          <th className="font-normal">
            <span title={COST_TOOLTIP}>Cost (estimated)</span>
          </th>
          <th className="font-normal">Calls</th>
          <th className="font-normal">Tokens</th>
        </tr>
      </thead>
      <tbody>
        {WINDOWS.map(({ label, days }) => {
          const row = sumSince(view, days);
          return (
            <tr key={label}>
              <td className="py-1">{label}</td>
              <td title={COST_TOOLTIP}>
                {usd(row.costUsd)}
                {row.unpricedCalls > 0 ? ` + ${row.unpricedCalls} unpriced` : ''}
              </td>
              <td>{row.llmCalls}</td>
              <td>{tokens(row.tokens)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Loads one usage endpoint and shows it. Used for a bot (owner only) and a routine. */
export function UsageSummary({ url }: { url: string }) {
  const [view, setView] = useState<UsageView | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetchUsage(url)
      .then((next) => live && setView(next))
      .catch((err: unknown) => live && setError(err instanceof Error ? err.message : 'Unable to load usage'));
    return () => {
      live = false;
    };
  }, [url]);
  if (error) return <p className="text-xs text-destructive">{error}</p>;
  if (!view) return <p className="text-xs text-muted-foreground">Loading usage…</p>;
  return <UsageTable view={view} />;
}

/** A routine's usage, loaded only when asked for. */
export function RoutineUsage({ routineId }: { routineId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" className="text-[11px] text-muted-foreground underline" onClick={() => setOpen(!open)}>
        {open ? 'Hide usage' : 'Usage'}
      </button>
      {open ? <UsageSummary url={`/api/routines/${routineId}/usage`} /> : null}
    </div>
  );
}

function budgetLine(budget: BudgetStatus): string {
  const period = budget.period === 'day' ? 'Daily' : 'Monthly';
  const what = budget.source === 'you' ? 'your limit' : budget.scope === 'bot' ? 'cap per bot' : 'cap per person';
  return `${period} ${what}: ${usd(budget.spentUsd)} of ${usd(budget.limitUsd)} (${budget.action === 'block' ? 'blocks' : 'warns'})`;
}

export function UsageDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [view, setView] = useState<BudgetedUsageView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<BudgetPeriod>('day');
  const [limit, setLimit] = useState('');
  const [action, setAction] = useState<BudgetAction>('warn');

  useEffect(() => {
    if (!isOpen) return;
    fetchUsage<BudgetedUsageView>('/api/usage/me')
      .then((next) => {
        setError(null);
        setView(next);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Unable to load usage'));
  }, [isOpen]);

  if (!isOpen) return null;

  async function changeBudgets(change: () => Promise<BudgetStatus[]>) {
    setError(null);
    try {
      const budgets = await change();
      setView((current) => (current ? { ...current, budgets } : current));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save the limit');
    }
  }

  function handleSet(event: FormEvent) {
    event.preventDefault();
    const limitUsd = Number(limit);
    if (!Number.isFinite(limitUsd) || limitUsd < 0) return;
    void changeBudgets(() => setMyBudget({ period, limitUsd, action })).then(() => setLimit(''));
  }

  const exceeded = view?.budgets.filter((budget) => budget.exceeded) ?? [];

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="usage-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-header-row">
          <h2 id="usage-title">
            <Gauge size={18} aria-hidden /> Your usage
          </h2>
          <button type="button" className="dialog-close-btn" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {error ? <p className="chat-error">{error}</p> : null}
        {!view ? (
          error ? null : (
            <p className="dialog-note">Loading…</p>
          )
        ) : (
          <>
            {view.budgets.length === 0 ? (
              <p className="dialog-note" role="status">
                No budget is set, so nothing limits spend. Set your own limit below, or ask your admin to set
                BRICKSBOT_BUDGET_* in the app config.
              </p>
            ) : null}
            {exceeded.map((budget) => (
              <p key={`${budget.scope}${budget.period}${budget.source}`} className="chat-error" role="alert">
                {budgetLine(budget)}: limit reached
              </p>
            ))}
            <UsageTable view={view} />
            {view.budgets.length > 0 ? (
              <ul className="space-members-list" aria-label="Budgets">
                {view.budgets.map((budget) => (
                  <li key={`${budget.scope}${budget.period}${budget.source}`} className="space-members-row">
                    <span className="space-members-user">{budgetLine(budget)}</span>
                    {budget.source === 'you' ? (
                      <button
                        type="button"
                        className="space-members-remove"
                        onClick={() => void changeBudgets(() => clearMyBudget(budget.period))}
                      >
                        Remove
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            <form className="space-members-form" onSubmit={handleSet}>
              <label className="dialog-field">
                Your limit (USD, estimated)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={limit}
                  placeholder="5.00"
                  onChange={(event) => setLimit(event.target.value)}
                  required
                />
              </label>
              <div className="flex gap-2">
                <Select
                  ariaLabel="Period"
                  value={period}
                  onChange={(value) => setPeriod(value as BudgetPeriod)}
                  options={[
                    { value: 'day', label: 'Per day' },
                    { value: 'month', label: 'Per month' },
                  ]}
                />
                <Select
                  ariaLabel="When reached"
                  value={action}
                  onChange={(value) => setAction(value as BudgetAction)}
                  options={[
                    { value: 'warn', label: 'Warn me' },
                    { value: 'block', label: 'Stop my chats' },
                  ]}
                />
              </div>
              <div className="dialog-actions">
                <button type="submit" className="dialog-primary">
                  Set limit
                </button>
              </div>
            </form>
            <p className="dialog-note">
              Your limit adds to the workspace caps. It can only make things stricter, never looser.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
