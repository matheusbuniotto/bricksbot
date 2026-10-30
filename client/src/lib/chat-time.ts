/** Gap that triggers a centered time separator between consecutive chat messages. */
export const CHAT_TIME_GAP_MS = 2 * 60 * 60 * 1000;

function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function formatClock(date: Date, locale?: string): string {
  return date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
}

/** True when `nextIso` is more than 2 hours after `prevIso`. */
export function shouldShowChatTimeSeparator(
  prevIso: string | undefined,
  nextIso: string | undefined,
  gapMs = CHAT_TIME_GAP_MS,
): boolean {
  if (!prevIso || !nextIso) return false;
  const prev = Date.parse(prevIso);
  const next = Date.parse(nextIso);
  if (Number.isNaN(prev) || Number.isNaN(next)) return false;
  return next - prev > gapMs;
}

/**
 * Locale-aware label for a chat time separator (uses the runtime locale / timezone).
 * - Today → `14:30`
 * - Yesterday → `Yesterday 14:30` (localized)
 * - Older → `Mon, Oct 26, 23:01` / `seg., 26 de out. 23:01`
 */
export function formatChatTimeSeparator(
  iso: string,
  now: Date = new Date(),
  locale?: string,
): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  const dayMs = 24 * 60 * 60 * 1000;
  const dayDiff = (startOfLocalDay(now) - startOfLocalDay(date)) / dayMs;
  const clock = formatClock(date, locale);

  if (dayDiff === 0) return clock;

  if (dayDiff === 1) {
    const yesterday = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-1, 'day');
    // Capitalize first letter for title-like separators (e.g. "Yesterday", "Ontem").
    const label = yesterday.charAt(0).toLocaleUpperCase(locale) + yesterday.slice(1);
    return `${label} ${clock}`;
  }

  return date.toLocaleString(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}
