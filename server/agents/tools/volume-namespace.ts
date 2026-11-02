import {
  DEFAULT_VOLUME_USER_QUOTA_BYTES,
  DEFAULT_VOLUME_WRITE_MAX_BYTES,
  type VolumeQuotaLimits,
} from '../../../shared/agents/volume-namespace.js';

export interface VolumeNamespace {
  root: string;
  userId: string;
  botId: string;
}

export type NamespacedVolumePath =
  | { ok: true; path: string; userSegment: string; botSegment: string; relativePath: string }
  | { ok: false; error: string };

function present(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === '__UNSET__') return undefined;
  return trimmed;
}

function parsePositiveBytes(raw: string | undefined, fallback: number): number {
  const clean = present(raw);
  if (!clean) return fallback;
  const parsed = Number.parseInt(clean, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

/** `BRICKSBOT_VOLUME_ROOT`, with `SANDBOX_ARTIFACT_VOLUME_PATH` as a one-release alias. */
export function resolveVolumeRoot(env: Record<string, string | undefined>): string | undefined {
  const raw = present(env.BRICKSBOT_VOLUME_ROOT) ?? present(env.SANDBOX_ARTIFACT_VOLUME_PATH);
  if (!raw) return undefined;
  const root = raw.replace(/\/+$/, '');
  if (!root.startsWith('/Volumes/') || root.includes('..') || root.includes('\0')) {
    throw new Error('BRICKSBOT_VOLUME_ROOT must be a Unity Catalog path starting with /Volumes/');
  }
  return root;
}

export function parseVolumeQuotaLimits(env: Record<string, string | undefined> = {}): VolumeQuotaLimits {
  const limits: VolumeQuotaLimits = {
    maxWriteBytes: parsePositiveBytes(env.BRICKSBOT_VOLUME_WRITE_MAX_BYTES, DEFAULT_VOLUME_WRITE_MAX_BYTES),
    userQuotaBytes: parsePositiveBytes(env.BRICKSBOT_VOLUME_USER_QUOTA_BYTES, DEFAULT_VOLUME_USER_QUOTA_BYTES),
  };
  const botRaw = present(env.BRICKSBOT_VOLUME_BOT_QUOTA_BYTES);
  if (botRaw) {
    const parsed = Number.parseInt(botRaw, 10);
    if (Number.isFinite(parsed) && parsed > 0) limits.botQuotaBytes = parsed;
  }
  return limits;
}

/**
 * Path segment for the signed-in caller. Lowercase, and path-unsafe characters
 * become `_`, so an email cannot introduce `/` or `..`.
 */
export function sanitizeVolumeUserId(userId: string): string | null {
  const lower = userId.trim().toLowerCase();
  if (!lower) return null;
  let segment = lower.replace(/[^a-z0-9@._+-]/g, '_');
  while (segment.includes('..')) segment = segment.replace(/\.\./g, '_');
  segment = segment.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  if (!segment || segment.includes('/') || segment.includes('..')) return null;
  return segment;
}

export function sanitizeVolumeBotId(botId: string): string | null {
  const segment = botId.trim().toLowerCase();
  if (!/^[a-z0-9-]+$/.test(segment)) return null;
  return segment;
}

function normalizeRelativePath(raw: string): { ok: true; path: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'volume_write requires relative_path' };
  }
  const trimmed = raw.trim().replace(/\\/g, '/');
  if (!trimmed) return { ok: false, error: 'volume_write requires relative_path' };
  if (trimmed.startsWith('/') || /^[a-zA-Z]:/.test(trimmed)) {
    return { ok: false, error: 'volume_write accepts a relative path under the bot folder' };
  }
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('volumes/') || lower.includes('/volumes/')) {
    return { ok: false, error: 'volume_write does not accept a /Volumes path' };
  }
  if (trimmed.includes('\0') || trimmed.includes('//') || trimmed.endsWith('/')) {
    return { ok: false, error: 'volume_write requires a file name' };
  }
  const segments = trimmed.split('/');
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..') {
      return { ok: false, error: 'volume_write does not allow path traversal' };
    }
    if (/%2e|%2f|%5c/i.test(segment)) {
      return { ok: false, error: 'volume_write does not allow encoded path traversal' };
    }
  }
  if (segments[0]?.toLowerCase() === 'users') {
    return { ok: false, error: 'volume_write cannot target another user folder' };
  }
  return { ok: true, path: segments.join('/') };
}

/**
 * Files land under the signed-in caller, not the bot owner.
 * Two people chatting with one shared bot get two trees.
 */
export function resolveNamespacedVolumePath(namespace: VolumeNamespace, relativePath: string): NamespacedVolumePath {
  const root = namespace.root.trim().replace(/\/+$/, '');
  if (!root.startsWith('/Volumes/') || root.includes('..')) {
    return { ok: false, error: 'volume_write requires a Unity Catalog volume root' };
  }
  const userSegment = sanitizeVolumeUserId(namespace.userId);
  if (!userSegment) {
    return { ok: false, error: 'volume_write requires a signed-in user' };
  }
  const botSegment = sanitizeVolumeBotId(namespace.botId);
  if (!botSegment) {
    return { ok: false, error: 'volume_write requires the active bot' };
  }
  const relative = normalizeRelativePath(relativePath);
  if (!relative.ok) return relative;

  const prefix = `${root}/users/${userSegment}/bots/${botSegment}/`;
  const path = `${prefix}${relative.path}`;
  if (!path.startsWith(prefix) || path.includes('..')) {
    return { ok: false, error: 'volume_write cannot leave the bot folder' };
  }
  return {
    ok: true,
    path,
    userSegment,
    botSegment,
    relativePath: relative.path,
  };
}

export function assessVolumeQuota(input: {
  userBytes: number;
  botBytes: number;
  incomingBytes: number;
  limits: VolumeQuotaLimits;
}): { ok: true; remainingUserBytes: number } | { ok: false; error: string } {
  const { userBytes, botBytes, incomingBytes, limits } = input;
  if (!Number.isFinite(incomingBytes) || incomingBytes < 0) {
    return { ok: false, error: 'volume_write rejected an invalid byte size' };
  }
  if (incomingBytes > limits.maxWriteBytes) {
    return {
      ok: false,
      error: `volume_write exceeds the per-write limit of ${limits.maxWriteBytes} bytes`,
    };
  }
  if (userBytes + incomingBytes > limits.userQuotaBytes) {
    return {
      ok: false,
      error: `volume_write exceeds the per-user quota of ${limits.userQuotaBytes} bytes`,
    };
  }
  if (limits.botQuotaBytes !== undefined && botBytes + incomingBytes > limits.botQuotaBytes) {
    return {
      ok: false,
      error: `volume_write exceeds the per-bot quota of ${limits.botQuotaBytes} bytes`,
    };
  }
  return { ok: true, remainingUserBytes: limits.userQuotaBytes - userBytes - incomingBytes };
}
