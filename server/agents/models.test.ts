import { describe, expect, test } from 'vitest';
import { modelCatalogFromEnv } from './models.js';

describe('modelCatalogFromEnv', () => {
  test('defaults to the client model alone', () => {
    const catalog = modelCatalogFromEnv({}, 'openai/gpt-6-luna');
    expect(catalog.options()).toEqual([{ id: 'openai/gpt-6-luna', label: 'openai/gpt-6-luna' }]);
    expect(catalog.defaultId).toBe('openai/gpt-6-luna');
  });

  test('reads ids and objects, with labels, windows and prices kept server-side', () => {
    const catalog = modelCatalogFromEnv(
      {
        BRICKSBOT_MODELS: JSON.stringify([
          'a/one',
          { id: 'b/two', label: 'Two', contextWindow: 32000, inputUsdPerMTok: 1, outputUsdPerMTok: 2 },
        ]),
      },
      'a/one'
    );
    expect(catalog.options()).toEqual([
      { id: 'a/one', label: 'a/one' },
      { id: 'b/two', label: 'Two', contextWindow: 32000 },
    ]);
    expect(catalog.get('b/two')?.inputUsdPerMTok).toBe(1);
  });

  test('drops ids containing fast, with a warning', () => {
    const warnings: string[] = [];
    const catalog = modelCatalogFromEnv(
      { BRICKSBOT_MODELS: '["a/one","vendor/Model-FAST","b/fastest-v2"]' },
      undefined,
      (message) => warnings.push(message)
    );
    expect(catalog.models.map((m) => m.id)).toEqual(['a/one']);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('vendor/Model-FAST');
  });

  test('a malformed list falls back to the default with a warning', () => {
    const warnings: string[] = [];
    const catalog = modelCatalogFromEnv({ BRICKSBOT_MODELS: '{nope' }, 'a/one', (m) => warnings.push(m));
    expect(catalog.models.map((m) => m.id)).toEqual(['a/one']);
    expect(warnings).toHaveLength(1);
  });

  test('resolve takes the first candidate still in the catalog', () => {
    const catalog = modelCatalogFromEnv({ BRICKSBOT_MODELS: '["a/one","b/two"]' });
    expect(catalog.resolve('b/two', 'a/one')?.id).toBe('b/two');
    expect(catalog.resolve(null, 'a/one')?.id).toBe('a/one');
    expect(catalog.resolve('removed/model', undefined)).toBeUndefined();
  });
});
