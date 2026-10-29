import { describe, expect, test } from 'vitest';
import {
  extractWebhookSecret,
  generateWebhookSecret,
  hashWebhookSecret,
  verifyWebhookSecret,
  WEBHOOK_HEADER,
} from './webhook-auth.js';

describe('webhook auth', () => {
  test('hashes secrets and verifies matching plaintext', () => {
    const secret = generateWebhookSecret();
    const hash = hashWebhookSecret(secret);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyWebhookSecret(secret, hash)).toBe(true);
    expect(verifyWebhookSecret('wrong-secret', hash)).toBe(false);
    expect(verifyWebhookSecret(secret, hashWebhookSecret('other'))).toBe(false);
  });

  test('extracts shared secret from header or Bearer token', () => {
    expect(extractWebhookSecret({ [WEBHOOK_HEADER]: 'abc' })).toBe('abc');
    expect(extractWebhookSecret({ authorization: 'Bearer tok_1' })).toBe('tok_1');
    expect(extractWebhookSecret({})).toBeNull();
  });
});
