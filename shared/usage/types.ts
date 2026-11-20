export type UsageScopeKind = 'user' | 'bot' | 'routine';
export type BudgetPeriod = 'day' | 'month';
export type BudgetAction = 'warn' | 'block';

/** One UTC day of spend for a user, bot or routine. Counts and money only, never content. */
export interface UsageDay {
  /** YYYY-MM-DD, UTC. */
  day: string;
  /** Estimated: the provider's figure or the operator's price list. Calls with no price count as 0 (see `unpricedCalls`). */
  costUsd: number;
  promptTokens: number;
  completionTokens: number;
  llmCalls: number;
  /** Calls with no known price (Model Serving and Genie bill in DBU). Their cost is missing from `costUsd`. */
  unpricedCalls: number;
  genieCalls: number;
}

export interface UsageView {
  days: UsageDay[];
  totals: Omit<UsageDay, 'day'>;
}

export interface BudgetStatus {
  scope: 'user' | 'bot';
  period: BudgetPeriod;
  limitUsd: number;
  action: BudgetAction;
  /** `app` is the operator's cap; `you` is one the person set on themselves. */
  source: 'app' | 'you';
  spentUsd: number;
  /** Calls this period with no known price: `spentUsd` is a floor, and a `block` limit cannot be enforced. */
  unpricedCalls: number;
  exceeded: boolean;
}

export interface BudgetedUsageView extends UsageView {
  /** Empty means nothing limits spend: the UI warns about it. */
  budgets: BudgetStatus[];
}
