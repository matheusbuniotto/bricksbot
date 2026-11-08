/** Placeholder injected when a Databricks secret resource must exist but is not configured yet. */
const UNSET = '__UNSET__';

/** Trimmed env value, or undefined when blank or the `__UNSET__` placeholder. */
export function presentEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === UNSET) return undefined;
  return trimmed;
}
