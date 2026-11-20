import type { VolumeUsageSnapshot, VolumeUsageStore } from '../../shared/agents/volume-namespace.js';
import type { LakebaseQuery } from '../chat/lakebase-store.js';

function asBytes(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

/** In-memory quota counters. Keyed so one user id cannot read another user's bytes. */
export class MemoryVolumeUsageStore implements VolumeUsageStore {
  private readonly bytes = new Map<string, number>();

  private key(userId: string, botId: string): string {
    return `${userId}\0${botId}`;
  }

  async getUsage(userId: string, botId: string): Promise<VolumeUsageSnapshot> {
    let userBytes = 0;
    let botBytes = 0;
    const prefix = `${userId}\0`;
    for (const [key, value] of this.bytes) {
      if (!key.startsWith(prefix)) continue;
      userBytes += value;
      if (key === this.key(userId, botId)) botBytes = value;
    }
    return { userBytes, botBytes };
  }

  async addBytes(userId: string, botId: string, bytes: number): Promise<void> {
    if (bytes <= 0) return;
    const key = this.key(userId, botId);
    this.bytes.set(key, (this.bytes.get(key) ?? 0) + bytes);
  }

  releaseBytes(userId: string, botId: string, bytes: number): Promise<void> {
    const key = this.key(userId, botId);
    this.bytes.set(key, Math.max(0, (this.bytes.get(key) ?? 0) - bytes));
    return Promise.resolve();
  }
}

export class LakebaseVolumeUsageStore implements VolumeUsageStore {
  constructor(private readonly query: LakebaseQuery) {}

  async getUsage(userId: string, botId: string): Promise<VolumeUsageSnapshot> {
    const [userResult, botResult] = await Promise.all([
      this.query(
        `SELECT COALESCE(SUM(bytes_used), 0) AS bytes
         FROM bricksbot.volume_usage
         WHERE user_id = $1`,
        [userId]
      ),
      this.query(
        `SELECT COALESCE(bytes_used, 0) AS bytes
         FROM bricksbot.volume_usage
         WHERE user_id = $1 AND bot_id = $2`,
        [userId, botId]
      ),
    ]);
    return {
      userBytes: asBytes(userResult.rows[0]?.bytes),
      botBytes: asBytes(botResult.rows[0]?.bytes),
    };
  }

  async addBytes(userId: string, botId: string, bytes: number): Promise<void> {
    if (bytes <= 0) return;
    await this.query(
      `INSERT INTO bricksbot.volume_usage (user_id, bot_id, bytes_used)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, bot_id) DO UPDATE
       SET bytes_used = bricksbot.volume_usage.bytes_used + EXCLUDED.bytes_used,
           updated_at = NOW()`,
      [userId, botId, bytes]
    );
  }

  async releaseBytes(userId: string, botId: string, bytes: number): Promise<void> {
    if (bytes <= 0) return;
    await this.query(
      `UPDATE bricksbot.volume_usage
       SET bytes_used = GREATEST(bytes_used - $3, 0), updated_at = NOW()
       WHERE user_id = $1 AND bot_id = $2`,
      [userId, botId, bytes]
    );
  }
}
