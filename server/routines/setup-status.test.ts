import { describe, expect, test } from 'vitest';
import { buildSetupStatus } from './setup-status.js';

describe('buildSetupStatus', () => {
  test('flags stub provider as needing LLM setup and documents put-secret commands', () => {
    const status = buildSetupStatus({}, 'stub');
    expect(status.needsLlmSetup).toBe(true);
    expect(status.provider).toBe('stub');
    expect(status.lakebaseConfigured).toBe(false);
    expect(status.secretsScope).toBe('bricksbot');
    expect(status.putSecretExamples[1]).toContain('put-secret bricksbot openrouter-api-key');
    expect(status.appPublicUrl).toBeNull();
    expect(status.routineWebhookSecretPutExample[1]).toContain('put-secret bricksbot routine-webhook-key');
  });

  test('clears needsLlmSetup when openrouter secret env is present', () => {
    const status = buildSetupStatus(
      {
        OPENROUTER_API_KEY: 'sk-test',
        LAKEBASE_ENDPOINT: 'projects/my-project/branches/bricksbot/endpoints/primary',
      },
      'openai'
    );
    expect(status.needsLlmSetup).toBe(false);
    expect(status.lakebaseConfigured).toBe(true);
  });

  test('asks for no secret when Model Serving is the provider', () => {
    const status = buildSetupStatus({}, 'databricks-serving');
    expect(status.needsLlmSetup).toBe(false);
    expect(status.secretKeys).toEqual([]);
    expect(status.putSecretExamples).toEqual([]);
  });

  test('surfaces optional public App URL and custom routine webhook scope', () => {
    const status = buildSetupStatus(
      {
        BRICKSBOT_PUBLIC_APP_URL: 'https://bricksbot-example.databricksapps.com',
        ROUTINE_WEBHOOK_SECRET_SCOPE: 'my-scope',
        ROUTINE_WEBHOOK_SECRET_KEY: 'my-key',
      },
      'stub'
    );
    expect(status.appPublicUrl).toBe('https://bricksbot-example.databricksapps.com');
    expect(status.routineWebhookSecretPutExample[1]).toContain('put-secret my-scope my-key');
  });
});
