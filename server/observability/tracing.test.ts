import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fakeMlflow, recorded, resetFakeMlflow, sdk } from './fake-mlflow.js';
import { annotate, initTracing, resetTracing, traced } from './tracing.js';

vi.mock('@mlflow/core', async () => (await import('./fake-mlflow.js')).fakeMlflow);

beforeEach(() => {
  resetTracing();
  resetFakeMlflow();
});
afterEach(() => vi.restoreAllMocks());

describe('tracing disabled', () => {
  test('without an experiment id nothing starts and fn still runs', async () => {
    expect(await initTracing({})).toBe(false);
    expect(await initTracing({ MLFLOW_EXPERIMENT_ID: '__UNSET__' })).toBe(false);
    expect(await traced('x', 'TOOL', { a: 1 }, () => Promise.resolve('ok'))).toBe('ok');
    annotate({ a: 1 });
    expect(sdk.initCalls).toEqual([]);
    expect(recorded).toEqual([]);
  });
});

describe('tracing enabled', () => {
  test('initialises against Databricks by default and honours MLFLOW_TRACKING_URI', async () => {
    expect(await initTracing({ MLFLOW_EXPERIMENT_ID: '123' })).toBe(true);
    await initTracing({ MLFLOW_EXPERIMENT_ID: '123', MLFLOW_TRACKING_URI: 'http://localhost:5000' });
    expect(sdk.initCalls).toEqual([
      { trackingUri: 'databricks', experimentId: '123' },
      { trackingUri: 'http://localhost:5000', experimentId: '123' },
    ]);
  });

  test('records nested spans with prefixed attributes and skips null ones', async () => {
    await initTracing({ MLFLOW_EXPERIMENT_ID: '1' });
    const result = await traced('chat_turn', 'AGENT', { chat_id: 'c1', bot_id: undefined }, () => {
      annotate({ bot_id: 'b1' });
      return traced('llm_call', 'LLM', { model: 'm' }, () => Promise.resolve(42));
    });
    expect(result).toBe(42);
    expect(recorded).toEqual([
      {
        name: 'chat_turn',
        spanType: 'AGENT',
        parent: undefined,
        attributes: { 'bricksbot.chat_id': 'c1', 'bricksbot.bot_id': 'b1' },
        outputs: {},
        status: 'OK',
      },
      {
        name: 'llm_call',
        spanType: 'LLM',
        parent: 'chat_turn',
        attributes: { 'bricksbot.model': 'm' },
        outputs: {},
        status: 'OK',
      },
    ]);
  });

  test("fn's own error propagates and marks the span", async () => {
    await initTracing({ MLFLOW_EXPERIMENT_ID: '1' });
    await expect(traced('tool', 'TOOL', {}, () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(recorded[0]?.status).toBe('ERROR');
  });

  test('an SDK failure runs fn once, warns once, and stops tracing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await initTracing({ MLFLOW_EXPERIMENT_ID: '1' });
    sdk.failWithSpan = true;
    const fn = vi.fn(() => Promise.resolve('still works'));
    expect(await traced('a', 'TOOL', {}, fn)).toBe('still works');
    expect(await traced('b', 'TOOL', {}, fn)).toBe('still works');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test('a failing init leaves tracing off', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(fakeMlflow, 'init').mockImplementation(() => {
      throw new Error('bad experiment');
    });
    expect(await initTracing({ MLFLOW_EXPERIMENT_ID: '1' })).toBe(false);
    expect(await traced('x', 'TOOL', {}, () => Promise.resolve(1))).toBe(1);
    expect(recorded).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
