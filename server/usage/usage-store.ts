import { randomUUID } from 'node:crypto';
import type { UsageAttribution } from '../../shared/agents/types.js';
import type { UsageDay, UsageScopeKind } from '../../shared/usage/types.js';
import type { LakebaseQuery } from '../chat/lakebase-store.js';
import type { CostSource } from './pricing.js';

export interface UsageScope {
  kind: UsageScopeKind;
  id: string;
}

const utcDay = (date = new Date()) => date.toISOString().slice(0, 10);
const daysAgo = (days: number) => utcDay(new Date(Date.now() - days * 86_400_000));

/** One LLM call. Ids and counts only, never content. */
export interface LlmUsageRecord extends Omit<UsageAttribution, 'routine'> {
  model: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  costUsd: number | null;
  costSource: CostSource;
}

export interface UsageStore {
  record(entry: LlmUsageRecord): Promise<void>;
  /** Estimated USD spent by the scope from `sinceDay` (YYYY-MM-DD, UTC) through today. */
  spent(scope: UsageScope, sinceDay: string): Promise<number>;
  /** The last `days` UTC days (today included) that have any usage, oldest first. */
  daily(scope: UsageScope, days: number): Promise<UsageDay[]>;
  /** Counts one Genie call for the user today unless they already made `cap`; false means refused. */
  claimGenieCall(userId: string, cap: number): Promise<boolean>;
}

export class MemoryUsageStore implements UsageStore {
  readonly entries: LlmUsageRecord[] = [];
  /** Keyed `day|kind|id`, like the usage_daily primary key. */
  readonly rollups = new Map<string, UsageDay & UsageScope>();

  private rollup(scope: UsageScope, day = utcDay()) {
    const key = `${day}|${scope.kind}|${scope.id}`;
    let row = this.rollups.get(key);
    if (!row) {
      row = {
        ...scope,
        day,
        costUsd: 0,
        promptTokens: 0,
        completionTokens: 0,
        llmCalls: 0,
        unpricedCalls: 0,
        genieCalls: 0,
      };
      this.rollups.set(key, row);
    }
    return row;
  }

  record(entry: LlmUsageRecord): Promise<void> {
    this.entries.push(entry);
    const scopes: UsageScope[] = [];
    if (entry.payerUserId) scopes.push({ kind: 'user', id: entry.payerUserId });
    if (entry.botId) scopes.push({ kind: 'bot', id: entry.botId });
    if (entry.routineId) scopes.push({ kind: 'routine', id: entry.routineId });
    for (const scope of scopes) {
      const row = this.rollup(scope);
      row.costUsd += entry.costUsd ?? 0;
      row.promptTokens += entry.promptTokens;
      row.completionTokens += entry.completionTokens;
      row.llmCalls += 1;
      if (entry.costUsd === null) row.unpricedCalls += 1;
    }
    return Promise.resolve();
  }

  daily(scope: UsageScope, days: number): Promise<UsageDay[]> {
    const since = daysAgo(days - 1);
    const rows = [...this.rollups.values()]
      .filter((row) => row.kind === scope.kind && row.id === scope.id && row.day >= since)
      .sort((a, b) => a.day.localeCompare(b.day))
      .map(({ kind: _kind, id: _id, ...day }) => day);
    return Promise.resolve(rows);
  }

  async spent(scope: UsageScope, sinceDay: string): Promise<number> {
    const rows = await this.daily(scope, 366);
    return rows.filter((row) => row.day >= sinceDay).reduce((sum, row) => sum + row.costUsd, 0);
  }

  claimGenieCall(userId: string, cap: number): Promise<boolean> {
    const row = this.rollup({ kind: 'user', id: userId });
    if (row.genieCalls >= cap) return Promise.resolve(false);
    row.genieCalls += 1;
    return Promise.resolve(true);
  }
}

/**
 * Appends to the audit schema (no foreign keys, so history outlives bots) and bumps the
 * per-day rollups for the payer, the bot and the routine, all in one statement.
 */
export class LakebaseUsageStore implements UsageStore {
  constructor(private readonly query: LakebaseQuery) {}

  async record(e: LlmUsageRecord): Promise<void> {
    await this.query(
      `WITH logged AS (
         INSERT INTO bricksbot_audit.llm_usage
           (id, kind, payer_user_id, bot_id, chat_id, run_id, routine_id, model, provider,
            prompt_tokens, completion_tokens, cached_tokens, reasoning_tokens, cost_usd, cost_source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       )
       INSERT INTO bricksbot.usage_daily
         (day, scope_kind, scope_id, cost_usd, prompt_tokens, completion_tokens, llm_calls, unpriced_calls)
       SELECT (NOW() AT TIME ZONE 'UTC')::date, scope.kind, scope.id, COALESCE($14::numeric, 0), $10::bigint, $11::bigint, 1,
         CASE WHEN $14::numeric IS NULL THEN 1 ELSE 0 END
       FROM (VALUES ('user', $3::text), ('bot', $4::text), ('routine', $7::text)) AS scope(kind, id)
       WHERE scope.id IS NOT NULL
       ON CONFLICT (day, scope_kind, scope_id) DO UPDATE SET
         cost_usd = bricksbot.usage_daily.cost_usd + EXCLUDED.cost_usd,
         prompt_tokens = bricksbot.usage_daily.prompt_tokens + EXCLUDED.prompt_tokens,
         completion_tokens = bricksbot.usage_daily.completion_tokens + EXCLUDED.completion_tokens,
         llm_calls = bricksbot.usage_daily.llm_calls + 1,
         unpriced_calls = bricksbot.usage_daily.unpriced_calls + EXCLUDED.unpriced_calls`,
      [
        randomUUID(),
        e.kind,
        e.payerUserId ?? null,
        e.botId ?? null,
        e.chatId ?? null,
        e.runId ?? null,
        e.routineId ?? null,
        e.model,
        e.provider,
        e.promptTokens,
        e.completionTokens,
        e.cachedTokens,
        e.reasoningTokens,
        e.costUsd,
        e.costSource,
      ]
    );
  }

  async daily(scope: UsageScope, days: number): Promise<UsageDay[]> {
    const { rows } = await this.query(
      `SELECT day::text AS day, cost_usd::float8 AS "costUsd", prompt_tokens::float8 AS "promptTokens",
              completion_tokens::float8 AS "completionTokens", llm_calls AS "llmCalls",
              unpriced_calls AS "unpricedCalls", genie_calls AS "genieCalls"
       FROM bricksbot.usage_daily
       WHERE scope_kind = $1 AND scope_id = $2 AND day >= $3::date
       ORDER BY day`,
      [scope.kind, scope.id, daysAgo(days - 1)]
    );
    return rows as unknown as UsageDay[];
  }

  async spent(scope: UsageScope, sinceDay: string): Promise<number> {
    const { rows } = await this.query(
      `SELECT COALESCE(SUM(cost_usd), 0)::float8 AS spent
       FROM bricksbot.usage_daily WHERE scope_kind = $1 AND scope_id = $2 AND day >= $3::date`,
      [scope.kind, scope.id, sinceDay]
    );
    return Number((rows[0] as { spent?: number } | undefined)?.spent ?? 0);
  }

  /** One atomic upsert: the WHERE stops the increment at the cap, so concurrent calls cannot slip past it. */
  async claimGenieCall(userId: string, cap: number): Promise<boolean> {
    const { rows } = await this.query(
      `INSERT INTO bricksbot.usage_daily (day, scope_kind, scope_id, genie_calls)
       SELECT (NOW() AT TIME ZONE 'UTC')::date, 'user', $1, 1 WHERE $2::int > 0
       ON CONFLICT (day, scope_kind, scope_id) DO UPDATE
         SET genie_calls = bricksbot.usage_daily.genie_calls + 1
         WHERE bricksbot.usage_daily.genie_calls < $2::int
       RETURNING genie_calls`,
      [userId, cap]
    );
    return rows.length > 0;
  }
}
