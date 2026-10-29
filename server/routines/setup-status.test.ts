import { describe, expect, test } from 'vitest';
import { buildSetupStatus } from './setup-status.js';

describe('buildSetupStatus', () => {
  test('flags stub provider as needing LLM setup and documents put-secret commands', () => {
    const status = buildSetupStatus({}, 'stub');
    expect(status.needsLlmSetup).toBe(true);
    expect(status.provider).toBe('stub');
    expect(status.lakebaseConfigured).toBe(false);
    expect(status.secretsScope).toBe('claw');
    expect(status.putSecretExamples[1]).toContain('put-secret claw openrouter-api-key');
  });

  test('clears needsLlmSetup when openrouter secret env is present', () => {
    const status = buildSetupStatus(
      {
        OPENROUTER_API_KEY: 'sk-test',
        LAKEBASE_ENDPOINT: 'projects/clawhouse/branches/bricksbot/endpoints/primary',
      },
      'openai',
    );
    expect(status.needsLlmSetup).toBe(false);
    expect(status.lakebaseConfigured).toBe(true);
  });
});
