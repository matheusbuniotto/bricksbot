import type { Response } from 'express';

/** `[status, pattern]`: an error whose message matches `pattern` is answered with `status`. */
export type ErrorStatusRule = readonly [status: number, pattern: RegExp];

const COMMON_RULES: readonly ErrorStatusRule[] = [
  [401, /authentication required/i],
  [404, /not found/i],
];

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Unexpected error';
}

/**
 * Build `sendError(res, err, fallback?)` for a route module. Stores and services throw
 * plain Errors; the common 401/404 rules run first, then `rules` in order, else `fallback`.
 */
export function createErrorResponder(rules: readonly ErrorStatusRule[] = []) {
  const ordered = [...COMMON_RULES, ...rules];
  return (res: Response, err: unknown, fallback = 500): void => {
    const message = errorMessage(err);
    const status = ordered.find(([, pattern]) => pattern.test(message))?.[0] ?? fallback;
    res.status(status).json({ error: message });
  };
}
