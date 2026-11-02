import { describe, expect, test } from 'vitest';
import { DEFAULT_VOLUME_USER_QUOTA_BYTES, DEFAULT_VOLUME_WRITE_MAX_BYTES } from '../../../shared/agents/volume-namespace.js';
import {
  assessVolumeQuota,
  parseVolumeQuotaLimits,
  resolveNamespacedVolumePath,
  resolveVolumeRoot,
  sanitizeVolumeUserId,
} from './volume-namespace.js';

const ROOT = '/Volumes/main/default/bricksbot_artifacts/bricksbot';
const BOT = '3f2a1111-2222-4333-8444-555566667777';

function resolve(userId: string, relativePath: string, botId = BOT) {
  return resolveNamespacedVolumePath({ root: ROOT, userId, botId }, relativePath);
}

describe('volume namespace paths', () => {
  test('sanitizes email and keeps a safe segment', () => {
    expect(sanitizeVolumeUserId('Alice@Co.com')).toBe('alice@co.com');
    expect(sanitizeVolumeUserId('alice/../../bob')).toBe('alice_bob');
    expect(sanitizeVolumeUserId('../evil')).toBe('evil');
    expect(sanitizeVolumeUserId('..')).toBeNull();
    expect(sanitizeVolumeUserId('   ')).toBeNull();
  });

  test('resolves a relative path under the caller and the active bot', () => {
    const resolved = resolve('Alice@Co.com', 'reports/q3.md');
    expect(resolved).toEqual({
      ok: true,
      path: `${ROOT}/users/alice@co.com/bots/${BOT}/reports/q3.md`,
      userSegment: 'alice@co.com',
      botSegment: BOT,
      relativePath: 'reports/q3.md',
    });
  });

  test('rejects absolute Volumes paths, traversal, encoded dots, and another user prefix', () => {
    expect(resolve('alice@co.com', '/Volumes/main/default/other/secret.txt').ok).toBe(false);
    expect(resolve('alice@co.com', 'Volumes/main/default/other/secret.txt').ok).toBe(false);
    expect(resolve('alice@co.com', '../users/bob@co.com/bots/x/secret.txt').ok).toBe(false);
    expect(resolve('alice@co.com', 'users/bob@co.com/bots/x/secret.txt').ok).toBe(false);
    expect(resolve('alice@co.com', 'notes/%2e%2e/secret.txt').ok).toBe(false);
    expect(resolve('alice@co.com', 'notes/%2fVolumes/secret.txt').ok).toBe(false);
    expect(resolve('alice@co.com', 'notes/').ok).toBe(false);
    expect(resolve('alice@co.com', '').ok).toBe(false);

    const escaped = resolve('alice/../../bob@co.com', 'notes/a.md');
    expect(escaped.ok).toBe(true);
    if (escaped.ok) {
      expect(escaped.path.startsWith(`${ROOT}/users/alice_bob@co.com/bots/${BOT}/`)).toBe(true);
      expect(escaped.path.includes('..')).toBe(false);
    }
  });

  test('ignores a bot id that is not the active bot by keeping the active segment', () => {
    const other = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const resolved = resolve('alice@co.com', 'notes/a.md', BOT);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.path).not.toContain(other);
    expect(resolve('alice@co.com', 'notes/a.md', '../not-the-bot').ok).toBe(false);
  });

  test('root alias and quota defaults', () => {
    expect(resolveVolumeRoot({ BRICKSBOT_VOLUME_ROOT: `${ROOT}/` })).toBe(ROOT);
    expect(resolveVolumeRoot({ SANDBOX_ARTIFACT_VOLUME_PATH: ROOT })).toBe(ROOT);
    expect(resolveVolumeRoot({ BRICKSBOT_VOLUME_ROOT: ROOT, SANDBOX_ARTIFACT_VOLUME_PATH: '/Volumes/other' })).toBe(
      ROOT
    );
    expect(resolveVolumeRoot({})).toBeUndefined();
    expect(() => resolveVolumeRoot({ BRICKSBOT_VOLUME_ROOT: '/Workspace/files' })).toThrow(/\/Volumes\//);

    expect(parseVolumeQuotaLimits({})).toEqual({
      maxWriteBytes: DEFAULT_VOLUME_WRITE_MAX_BYTES,
      userQuotaBytes: DEFAULT_VOLUME_USER_QUOTA_BYTES,
    });
    expect(parseVolumeQuotaLimits({ BRICKSBOT_VOLUME_BOT_QUOTA_BYTES: '1024' }).botQuotaBytes).toBe(1024);
  });

  test('quota rejects over-size and over-user writes and leaves other users untouched in the check', () => {
    const limits = parseVolumeQuotaLimits({});
    expect(
      assessVolumeQuota({ userBytes: 0, botBytes: 0, incomingBytes: limits.maxWriteBytes + 1, limits }).ok
    ).toBe(false);
    const atCap = assessVolumeQuota({
      userBytes: limits.userQuotaBytes - 10,
      botBytes: 0,
      incomingBytes: 10,
      limits,
    });
    expect(atCap).toEqual({ ok: true, remainingUserBytes: 0 });
    expect(
      assessVolumeQuota({
        userBytes: limits.userQuotaBytes - 9,
        botBytes: 0,
        incomingBytes: 10,
        limits,
      }).ok
    ).toBe(false);
    const botCapped = assessVolumeQuota({
      userBytes: 0,
      botBytes: 5,
      incomingBytes: 6,
      limits: { ...limits, botQuotaBytes: 10 },
    });
    expect(botCapped.ok).toBe(false);
  });
});
