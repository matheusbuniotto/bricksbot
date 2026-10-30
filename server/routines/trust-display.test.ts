import { describe, expect, test } from 'vitest';
import {
  ROUTINE_WEBHOOK_HEADER,
  ROUTINE_WEBHOOK_PATH_TEMPLATE,
  describeCronExpression,
  routineWebhookPath,
  unixCronToQuartzHint,
} from './trust-display.js';

describe('routine trust display', () => {
  test('webhook path template and header match routes', () => {
    expect(ROUTINE_WEBHOOK_PATH_TEMPLATE).toBe('/api/webhooks/routines/:routineId');
    expect(routineWebhookPath('abc-123')).toBe('/api/webhooks/routines/abc-123');
    expect(ROUTINE_WEBHOOK_HEADER).toBe('x-bricksbot-webhook-key');
  });

  test('describeCronExpression handles daily and weekly patterns', () => {
    expect(describeCronExpression('0 9 * * *', 'en')).toBe('Daily at 09:00');
    expect(describeCronExpression('0 9 * * *', 'pt')).toBe('Diariamente às 09:00');
    expect(describeCronExpression('30 14 * * 1', 'en')).toBe('Every Monday at 14:30');
    expect(describeCronExpression('0 9 * * 1', 'pt')).toBe('segundas às 09:00');
    expect(describeCronExpression('not-a-cron')).toBe('not-a-cron');
  });

  test('unixCronToQuartzHint maps daily and weekly Unix cron', () => {
    expect(unixCronToQuartzHint('0 9 * * *')).toBe('0 0 9 * * ?');
    expect(unixCronToQuartzHint('30 14 * * 1')).toBe('0 30 14 ? * MON');
    expect(unixCronToQuartzHint('not-a-cron')).toBeNull();
  });
});
