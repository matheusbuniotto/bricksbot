import type { BudgetAction, BudgetPeriod, BudgetStatus } from '../../shared/usage/types.js';
import type { LakebaseQuery } from '../chat/lakebase-store.js';
import { presentEnv } from '../lib/env.js';
import type { UsageStore } from './usage-store.js';

/** A limit a person set on themselves. The operator's caps come from env and are never stored. */
export interface PersonalBudget {
  period: BudgetPeriod;
  limitUsd: number;
  action: BudgetAction;
}

export interface BudgetStore {
  list(userId: string): Promise<PersonalBudget[]>;
  set(userId: string, budget: PersonalBudget): Promise<void>;
  clear(userId: string, period: BudgetPeriod): Promise<void>;
}

export class MemoryBudgetStore implements BudgetStore {
  private readonly rows = new Map<string, PersonalBudget>();

  list(userId: string): Promise<PersonalBudget[]> {
    const mine = [...this.rows.entries()].filter(([key]) => key.startsWith(`${userId}|`));
    return Promise.resolve(mine.map(([, row]) => row));
  }

  set(userId: string, budget: PersonalBudget): Promise<void> {
    this.rows.set(`${userId}|${budget.period}`, budget);
    return Promise.resolve();
  }

  clear(userId: string, period: BudgetPeriod): Promise<void> {
    this.rows.delete(`${userId}|${period}`);
    return Promise.resolve();
  }
}

export class LakebaseBudgetStore implements BudgetStore {
  constructor(private readonly query: LakebaseQuery) {}

  async list(userId: string): Promise<PersonalBudget[]> {
    const { rows } = await this.query(
      `SELECT period, limit_usd::float8 AS "limitUsd", action FROM bricksbot.budgets
       WHERE scope_kind = 'user' AND scope_id = $1 ORDER BY period`,
      [userId]
    );
    return rows as unknown as PersonalBudget[];
  }

  async set(userId: string, { period, limitUsd, action }: PersonalBudget): Promise<void> {
    await this.query(
      `INSERT INTO bricksbot.budgets (scope_kind, scope_id, period, limit_usd, action)
       VALUES ('user', $1, $2, $3, $4)
       ON CONFLICT (scope_kind, scope_id, period) DO UPDATE
         SET limit_usd = EXCLUDED.limit_usd, action = EXCLUDED.action, updated_at = NOW()`,
      [userId, period, limitUsd, action]
    );
  }

  async clear(userId: string, period: BudgetPeriod): Promise<void> {
    await this.query(`DELETE FROM bricksbot.budgets WHERE scope_kind = 'user' AND scope_id = $1 AND period = $2`, [
      userId,
      period,
    ]);
  }
}

/** The operator's caps: per person and per bot, USD, estimated. Unset means no limit. */
export interface BudgetCaps {
  user: Partial<Record<BudgetPeriod, number>>;
  bot: Partial<Record<BudgetPeriod, number>>;
  action: BudgetAction;
}

/**
 * `BRICKSBOT_BUDGET_{USER,BOT}_{DAILY,MONTHLY}_USD` set the caps; `BRICKSBOT_BUDGET_ACTION` is `warn`
 * (default: the Usage panel shows it) or `block` (no model call is made once a cap is reached).
 */
export function budgetCapsFromEnv(env: Record<string, string | undefined>): BudgetCaps {
  const cap = (name: string): number | undefined => {
    const raw = presentEnv(env[`BRICKSBOT_BUDGET_${name}_USD`]);
    const value = raw === undefined ? NaN : Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  };
  return {
    user: { day: cap('USER_DAILY'), month: cap('USER_MONTHLY') },
    bot: { day: cap('BOT_DAILY'), month: cap('BOT_MONTHLY') },
    action: presentEnv(env.BRICKSBOT_BUDGET_ACTION)?.toLowerCase() === 'block' ? 'block' : 'warn',
  };
}

const utcToday = () => new Date().toISOString().slice(0, 10);
const periodStart = (period: BudgetPeriod) => (period === 'day' ? utcToday() : `${utcToday().slice(0, 7)}-01`);
const usd = (amount: number) => `$${amount.toFixed(2)}`;

export interface BudgetSubject {
  payerUserId?: string;
  botId?: string;
  /** Routine calls fail closed when the budget cannot be read; interactive ones fail open. */
  routine?: boolean;
}

/**
 * Compares spend with the caps before every model call. The check reads before the call is made, so
 * calls already in flight can push spend past a cap: it is approximate by design, off by at most the
 * calls running at the moment the cap is crossed.
 */
export class BudgetService {
  constructor(
    private readonly usage: UsageStore,
    readonly store: BudgetStore,
    readonly caps: BudgetCaps,
    private readonly warn: (message: string, err: unknown) => void = console.warn
  ) {}

  /** Every limit that applies to the user or bot, with what is spent so far. Empty when nothing is set. */
  async statuses(scope: 'user' | 'bot', id: string): Promise<BudgetStatus[]> {
    const limits: Array<Omit<BudgetStatus, 'spentUsd' | 'unpricedCalls' | 'exceeded'>> = [];
    for (const period of ['day', 'month'] as const) {
      const limitUsd = this.caps[scope][period];
      if (limitUsd !== undefined) limits.push({ scope, period, limitUsd, action: this.caps.action, source: 'app' });
    }
    if (scope === 'user') {
      for (const { period, limitUsd, action } of await this.store.list(id)) {
        limits.push({ scope, period, limitUsd, action, source: 'you' });
      }
    }
    return Promise.all(
      limits.map(async (limit) => {
        const { usd: spentUsd, unpricedCalls } = await this.usage.spent({ kind: scope, id }, periodStart(limit.period));
        return { ...limit, spentUsd, unpricedCalls, exceeded: spentUsd >= limit.limitUsd };
      })
    );
  }

  /** The notice to show instead of calling the model when a blocking limit is used up; undefined means go ahead. */
  async check({ payerUserId, botId, routine }: BudgetSubject): Promise<string | undefined> {
    try {
      const statuses = [
        ...(payerUserId ? await this.statuses('user', payerUserId) : []),
        ...(botId ? await this.statuses('bot', botId) : []),
      ];
      // Unpriced calls count as $0, so once one has run the spend is unknown and a block limit cannot be trusted.
      const hit = statuses.find((status) => status.action === 'block' && (status.exceeded || status.unpricedCalls > 0));
      return hit && blockedNotice(hit);
    } catch (err) {
      this.warn('[bricksbot] Budget check failed', err);
      if (routine) throw new Error('Budget check unavailable; routine call not accepted');
      return undefined;
    }
  }
}

function blockedNotice(status: BudgetStatus): string {
  const whose = status.scope === 'bot' ? "This bot's" : status.source === 'you' ? 'Your' : "Your workspace's";
  const period = status.period === 'day' ? 'daily' : 'monthly';
  const resets = status.period === 'day' ? 'tomorrow' : 'next month';
  if (!status.exceeded) {
    return (
      `${whose} ${period} budget of ${usd(status.limitUsd)} cannot be enforced: ${status.unpricedCalls} call(s) this ` +
      `${status.period} had no price, so spend is unknown and no model call was made. Add prices to BRICKSBOT_MODELS ` +
      `or use a warning limit instead. It resets ${resets} at 00:00 UTC.`
    );
  }
  // The bot's total is everyone's spend and only its owner sees usage, so members get the cap but not the figure.
  const spent = status.scope === 'bot' ? '' : ` (${usd(status.spentUsd)} spent)`;
  return (
    `${whose} ${period} budget of ${usd(status.limitUsd)} (estimated) is used up${spent}, ` +
    `so no model call was made. It resets ${resets} at 00:00 UTC.`
  );
}
