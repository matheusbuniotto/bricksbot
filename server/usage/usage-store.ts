import { randomUUID } from 'node:crypto';
import type { UsageAttribution } from '../../shared/agents/types.js';
import type { LakebaseQuery } from '../chat/lakebase-store.js';
import type { CostSource } from './pricing.js';

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
}

export class MemoryUsageStore implements UsageStore {
  readonly entries: LlmUsageRecord[] = [];

  record(entry: LlmUsageRecord): Promise<void> {
    this.entries.push(entry);
    return Promise.resolve();
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
         (day, scope_kind, scope_id, cost_usd, prompt_tokens, completion_tokens, llm_calls)
       SELECT (NOW() AT TIME ZONE 'UTC')::date, scope.kind, scope.id, COALESCE($14::numeric, 0), $10::bigint, $11::bigint, 1
       FROM (VALUES ('user', $3::text), ('bot', $4::text), ('routine', $7::text)) AS scope(kind, id)
       WHERE scope.id IS NOT NULL
       ON CONFLICT (day, scope_kind, scope_id) DO UPDATE SET
         cost_usd = bricksbot.usage_daily.cost_usd + EXCLUDED.cost_usd,
         prompt_tokens = bricksbot.usage_daily.prompt_tokens + EXCLUDED.prompt_tokens,
         completion_tokens = bricksbot.usage_daily.completion_tokens + EXCLUDED.completion_tokens,
         llm_calls = bricksbot.usage_daily.llm_calls + 1`,
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
}
