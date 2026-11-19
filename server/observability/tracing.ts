import { presentEnv } from '../lib/env.js';

/**
 * Optional MLflow tracing. Off unless MLFLOW_EXPERIMENT_ID is set; then `traced` records a span and
 * nests under whichever span is active, so a handoff's teammate turn lands inside the handoff span.
 *
 * Spans carry ids, names, counts and outcomes only. Prompts, tool arguments and results never
 * leave the app, because experiment ACLs are not Space ACLs.
 */
type Mlflow = typeof import('@mlflow/core');
export type SpanKind = 'AGENT' | 'CHAIN' | 'LLM' | 'TOOL';
export type SpanAttributes = Record<string, string | number | boolean | null | undefined>;

let mlflow: Mlflow | null = null;
let warned = false;

/** Tracing must never break a chat: log the first failure, stay quiet after. */
function ignore(err: unknown): void {
  if (warned) return;
  warned = true;
  console.warn(`[bricksbot] MLflow tracing error (further errors suppressed): ${(err as Error)?.message ?? err}`);
}

/** Turn tracing on when an experiment is configured. Returns whether it is on. */
export async function initTracing(env: Record<string, string | undefined> = process.env): Promise<boolean> {
  const experimentId = presentEnv(env.MLFLOW_EXPERIMENT_ID);
  if (!experimentId) return false;
  try {
    const sdk = await import('@mlflow/core');
    sdk.init({ trackingUri: presentEnv(env.MLFLOW_TRACKING_URI) ?? 'databricks', experimentId });
    mlflow = sdk;
    console.info(`[bricksbot] MLflow tracing on (experiment ${experimentId})`);
  } catch (err) {
    mlflow = null;
    ignore(err);
  }
  return mlflow !== null;
}

/** Add attributes to the span that is active right now (no-op when tracing is off). */
export function annotate(attributes: SpanAttributes): void {
  try {
    const span = mlflow?.getCurrentActiveSpan();
    for (const [key, value] of Object.entries(attributes)) {
      if (value != null) span?.setAttribute(`bricksbot.${key}`, value);
    }
  } catch (err) {
    ignore(err);
  }
}

/** Run `fn` inside a span. Errors from `fn` propagate untouched; tracing errors never do. */
export async function traced<T>(
  name: string,
  kind: SpanKind,
  attributes: SpanAttributes,
  fn: () => Promise<T>
): Promise<T> {
  const sdk = mlflow;
  if (!sdk) return fn();

  const ran: { outcome?: { value: T } | { error: unknown } } = {};
  try {
    return await sdk.withSpan(
      async (span) => {
        // withSpan records the return value as the span output unless one is set. Ours would be message text.
        span.setOutputs({});
        for (const [key, value] of Object.entries(attributes)) {
          if (value != null) span.setAttribute(`bricksbot.${key}`, value);
        }
        try {
          const value = await fn();
          ran.outcome = { value };
          return value;
        } catch (error) {
          ran.outcome = { error };
          throw error;
        }
      },
      { name, spanType: sdk.SpanType[kind] }
    );
  } catch (err) {
    const { outcome } = ran;
    if (!outcome) {
      // The SDK failed before running `fn`: stop tracing and run it plain.
      mlflow = null;
      ignore(err);
      return fn();
    }
    // `fn` ran. Its own error is the caller's; anything the SDK threw afterwards is not.
    if ('error' in outcome) throw outcome.error;
    ignore(err);
    return outcome.value;
  }
}

/** Test seam: drop tracing state. */
export function resetTracing(): void {
  mlflow = null;
  warned = false;
}
