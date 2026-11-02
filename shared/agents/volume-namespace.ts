/** App-enforced Volume write quotas. Unity Catalog has no per-user byte cap. */

export const VOLUME_WRITE_TOOL_NAME = 'volume_write';

export const DEFAULT_VOLUME_WRITE_MAX_BYTES = 8 * 1024 * 1024;
export const DEFAULT_VOLUME_USER_QUOTA_BYTES = 256 * 1024 * 1024;

export interface VolumeQuotaLimits {
  maxWriteBytes: number;
  userQuotaBytes: number;
  /** Unset means no per-bot cap. */
  botQuotaBytes?: number;
}

export interface VolumeUsageSnapshot {
  userBytes: number;
  botBytes: number;
}

/** Counters keyed by sanitized user id and bot id. One user cannot read another's row. */
export interface VolumeUsageStore {
  getUsage(userId: string, botId: string): Promise<VolumeUsageSnapshot>;
  addBytes(userId: string, botId: string, bytes: number): Promise<void>;
}
