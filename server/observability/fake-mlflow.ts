import { AsyncLocalStorage } from 'node:async_hooks';

/** Stand-in for `@mlflow/core` that records spans, nesting included. Tests only. */
export interface RecordedSpan {
  name: string;
  spanType?: string;
  parent?: string;
  attributes: Record<string, unknown>;
  outputs?: unknown;
  status: 'OK' | 'ERROR';
}

export const recorded: RecordedSpan[] = [];
export const sdk = { initCalls: [] as unknown[], failWithSpan: false };

const active = new AsyncLocalStorage<RecordedSpan>();

export function resetFakeMlflow(): void {
  recorded.length = 0;
  sdk.initCalls.length = 0;
  sdk.failWithSpan = false;
}

export const fakeMlflow = {
  SpanType: { AGENT: 'AGENT', CHAIN: 'CHAIN', LLM: 'LLM', TOOL: 'TOOL' },
  init: (config: unknown) => void sdk.initCalls.push(config),
  getCurrentActiveSpan: () => {
    const span = active.getStore();
    return span ? { setAttribute: (key: string, value: unknown) => void (span.attributes[key] = value) } : null;
  },
  withSpan: async (
    callback: (span: {
      setAttribute(key: string, value: unknown): void;
      setOutputs(value: unknown): void;
    }) => Promise<unknown>,
    options: { name: string; spanType?: string }
  ) => {
    if (sdk.failWithSpan) throw new Error('exporter exploded');
    const span: RecordedSpan = {
      name: options.name,
      spanType: options.spanType,
      parent: active.getStore()?.name,
      attributes: {},
      status: 'OK',
    };
    recorded.push(span);
    try {
      // Like the real SDK: the return value becomes the span output unless the callback set one.
      const value = await active.run(span, () =>
        callback({
          setAttribute: (key, val) => void (span.attributes[key] = val),
          setOutputs: (val) => void (span.outputs = val),
        })
      );
      span.outputs ??= value;
      return value;
    } catch (error) {
      span.status = 'ERROR';
      throw error;
    }
  },
};
