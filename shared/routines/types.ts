/** Domain types for scheduled routines (Lakeflow Job → App webhook). */

/**
 * Whose Databricks identity a routine's data tools use. `owner_approval` (default) gates
 * them on the owner's approval, which supplies their OBO token. `app` runs as the App
 * service principal and needs `BRICKSBOT_ROUTINE_APP_IDENTITY=allow`. Agents never set it.
 */
export type RoutineRunAs = 'owner_approval' | 'app';

export interface Routine {
  id: string;
  botId: string;
  ownerId: string;
  name: string;
  /** Cron or schedule expression (stored as opaque string for Phase 4). */
  cron: string;
  /** Prompt enqueued into the bot chat on each run. */
  prompt: string;
  enabled: boolean;
  runAs: RoutineRunAs;
  /** Catalog model id overriding the bot's; null means the bot's own (or the default). */
  model: string | null;
  lastRunAt: string | null;
  createdAt: string;
}

export interface CreateRoutineInput {
  botId: string;
  ownerId: string;
  name: string;
  cron: string;
  prompt?: string;
  enabled?: boolean;
  runAs?: RoutineRunAs;
  model?: string | null;
}

export interface CreateRoutineResult {
  routine: Routine;
  /** Plaintext webhook secret returned once at create time. */
  webhookSecret: string;
}

export interface UpdateRoutineInput {
  enabled?: boolean;
  name?: string;
  cron?: string;
  prompt?: string;
  runAs?: RoutineRunAs;
  model?: string | null;
}

export interface RoutineStore {
  listRoutines(ownerId: string): Promise<Routine[]>;
  getRoutine(routineId: string): Promise<Routine | null>;
  /** Internal row including webhook key hash (never expose over HTTP). */
  getRoutineAuth(routineId: string): Promise<{ routine: Routine; webhookKeyHash: string } | null>;
  createRoutine(input: CreateRoutineInput): Promise<CreateRoutineResult>;
  updateRoutine(routineId: string, ownerId: string, patch: UpdateRoutineInput): Promise<Routine>;
  deleteRoutine(routineId: string, ownerId: string): Promise<void>;
  markRoutineRun(routineId: string, ranAt?: string): Promise<Routine>;
}

/** POST path for Lakeflow Job / external cron (replace `:routineId`). */
export const ROUTINE_WEBHOOK_PATH_TEMPLATE = '/api/webhooks/routines/:routineId';

/** Header read by `extractWebhookSecret` (case-insensitive). Bearer token also accepted. */
export const ROUTINE_WEBHOOK_HEADER = 'x-bricksbot-webhook-key';

export function routineWebhookPath(routineId: string): string {
  return `/api/webhooks/routines/${routineId}`;
}

export type CronDescribeLocale = 'en' | 'pt';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatClock(hour: number, minute: number): string {
  return `${pad2(hour)}:${pad2(minute)}`;
}

const DOW_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DOW_PT = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

function parseCronField(value: string): number | '*' | null {
  if (value === '*') return '*';
  if (/^\d+$/.test(value)) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Short human label for common 5-field cron strings; falls back to the raw expression. */
export function describeCronExpression(cron: string, locale: CronDescribeLocale = 'en'): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;

  const [partMinute, partHour, dom, month, dow] = parts;
  if (!partMinute || !partHour || dom === undefined || month === undefined || dow === undefined) {
    return cron;
  }

  const minute = parseCronField(partMinute);
  const hour = parseCronField(partHour);

  if (minute === null || hour === null) {
    return cron;
  }

  if (typeof minute === 'number' && typeof hour === 'number' && dom === '*' && month === '*') {
    const time = formatClock(hour, minute);
    if (dow === '*') {
      return locale === 'pt' ? `Diariamente às ${time}` : `Daily at ${time}`;
    }
    const dowNum = parseCronField(dow);
    if (typeof dowNum === 'number' && dowNum >= 0 && dowNum <= 6) {
      const dayName = locale === 'pt' ? DOW_PT[dowNum] : DOW_EN[dowNum];
      return locale === 'pt' ? `${dayName}s às ${time}` : `Every ${DOW_EN[dowNum]} at ${time}`;
    }
  }

  if (minute === 0 && typeof hour === 'number' && dom === '*' && month === '*' && dow === '*') {
    const time = formatClock(hour, 0);
    return locale === 'pt' ? `Diariamente às ${time}` : `Daily at ${time}`;
  }

  return cron;
}

const QUARTZ_DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;

/**
 * Quartz schedule hint for v1 Unix cron shapes handled by `describeCronExpression`.
 * Operators set `routine_webhook_quartz_cron` to match manually.
 */
export function unixCronToQuartzHint(cron: string): string | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const [partMinute, partHour, dom, month, dow] = parts;
  if (!partMinute || !partHour || dom === undefined || month === undefined || dow === undefined) {
    return null;
  }

  const minute = parseCronField(partMinute);
  const hour = parseCronField(partHour);

  if (minute === null || hour === null) {
    return null;
  }
  if (typeof minute !== 'number' || typeof hour !== 'number') return null;
  if (dom !== '*' || month !== '*') return null;

  if (dow === '*') {
    return `0 ${minute} ${hour} * * ?`;
  }

  const dowNum = parseCronField(dow);
  if (typeof dowNum === 'number' && dowNum >= 0 && dowNum <= 6) {
    return `0 ${minute} ${hour} ? * ${QUARTZ_DOW[dowNum]}`;
  }

  return null;
}

/** Prefer Portuguese copy when the browser locale is pt*. */
export function defaultCronDescribeLocale(): CronDescribeLocale {
  if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('pt')) {
    return 'pt';
  }
  return 'en';
}
