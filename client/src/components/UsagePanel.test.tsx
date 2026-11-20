import { afterEach, describe, expect, test, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { UsageView } from '../../../shared/usage/types';
import { COST_TOOLTIP, UsageDialog, UsageTable } from './UsagePanel';

const day = (date: string, costUsd: number, llmCalls: number, unpricedCalls = 0) => ({
  day: date,
  costUsd,
  promptTokens: 1500,
  completionTokens: 500,
  llmCalls,
  unpricedCalls,
  genieCalls: 0,
});

describe('UsagePanel', () => {
  afterEach(() => vi.useRealTimers());

  test('cost is labelled estimated, carries the DBU tooltip, and flags unpriced calls', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-19T12:00:00Z'));
    const view: UsageView = {
      days: [day('2026-11-19', 0.5, 3, 1), day('2026-11-15', 1.25, 2), day('2026-10-25', 4, 9)],
      totals: { costUsd: 5.75, promptTokens: 0, completionTokens: 0, llmCalls: 14, unpricedCalls: 1, genieCalls: 0 },
    };
    const html = renderToString(<UsageTable view={view} />);
    expect(html).toContain('Cost (estimated)');
    expect(html).toContain('DBU');
    expect(COST_TOOLTIP).toContain('system.billing.usage');
    // Today, last 7 days and last 30 days.
    expect(html).toContain('$0.500');
    expect(html).toContain('+ 1 unpriced');
    expect(html).toContain('$1.75');
    expect(html).toContain('$5.75');
  });

  test('the dialog renders nothing until opened', () => {
    expect(renderToString(<UsageDialog isOpen={false} onClose={() => {}} />)).toBe('');
  });
});
