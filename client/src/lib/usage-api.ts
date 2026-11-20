import type {
  BudgetAction,
  BudgetPeriod,
  BudgetStatus,
  BudgetedUsageView,
  UsageView,
} from '../../../shared/usage/types';
import { readJson } from './http';

export const fetchUsage = async <T extends UsageView = UsageView>(url: string): Promise<T> =>
  readJson<T>(await fetch(url));

export async function setMyBudget(input: {
  period: BudgetPeriod;
  limitUsd: number;
  action: BudgetAction;
}): Promise<BudgetStatus[]> {
  const data = await readJson<{ budgets: BudgetStatus[] }>(
    await fetch('/api/usage/me/budgets', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
  );
  return data.budgets;
}

export async function clearMyBudget(period: BudgetPeriod): Promise<BudgetStatus[]> {
  const data = await readJson<{ budgets: BudgetStatus[] }>(
    await fetch(`/api/usage/me/budgets/${period}`, { method: 'DELETE' })
  );
  return data.budgets;
}

export type { BudgetedUsageView };
