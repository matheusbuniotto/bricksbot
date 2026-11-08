/** Narrow `unknown` values from Lakebase rows and LLM tool arguments. */

export function asString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (value === null || value === undefined) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value as string | number | boolean | bigint);
}

export function asBool(value: unknown): boolean {
  return value === true || value === 't' || value === 'true';
}

/** A JSON object column: pg returns parsed jsonb or raw text depending on the driver. */
export function asJsonObject(value: unknown): Record<string, unknown> {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return {};
    }
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return { ...(parsed as Record<string, unknown>) };
  }
  return {};
}

/** Trimmed string argument, or '' when missing or not a string. */
export function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function clip(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n…[truncated]` : text;
}

export function nowIso(): string {
  return new Date().toISOString();
}
