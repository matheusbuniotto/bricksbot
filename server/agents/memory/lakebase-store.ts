import { randomUUID } from 'node:crypto';
import type { BotMemory, BotSkill, MemorySkillStore } from '../../../shared/agents/memory/types.js';
import type { LakebaseQuery } from '../../chat/lakebase-store.js';
import { normalizeMemory, normalizeSkill, requireBotId } from './input.js';

function asString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (value === null || value === undefined) return '';
  return String(value);
}

function mapMemory(row: Record<string, unknown>): BotMemory {
  return {
    id: asString(row.id),
    botId: asString(row.bot_id),
    userId: asString(row.user_id) || 'workspace-user',
    key: asString(row.key),
    content: asString(row.content),
    updatedAt: asString(row.updated_at),
  };
}

function mapSkill(row: Record<string, unknown>): BotSkill {
  return {
    id: asString(row.id),
    botId: asString(row.bot_id),
    name: asString(row.name),
    body: asString(row.body),
    createdAt: asString(row.created_at),
  };
}

export class LakebaseMemorySkillStore implements MemorySkillStore {
  private memoriesCache = new Map<string, BotMemory[]>();
  private skillsByBot = new Map<string, BotSkill[]>();
  private verifiedBots = new Set<string>();

  constructor(private readonly query: LakebaseQuery) {}

  private async requireBot(botId: string): Promise<void> {
    if (this.verifiedBots.has(botId)) return;
    const result = await this.query(`SELECT id FROM bricksbot.bots WHERE id = $1`, [botId]);
    if (!result.rows[0]) throw new Error('Bot not found');
    this.verifiedBots.add(botId);
  }

  async listMemories(botId: string, userId?: string): Promise<BotMemory[]> {
    const id = requireBotId(botId);
    const resolvedUserId = userId ?? 'workspace-user';
    const cacheKey = `${id}:${resolvedUserId}`;
    const cached = this.memoriesCache.get(cacheKey);
    if (cached) return [...cached];
    const result = await this.query(
      `SELECT id, bot_id, user_id, key, content, updated_at
       FROM bricksbot.bot_memories
       WHERE bot_id = $1 AND user_id = $2
       ORDER BY key ASC`,
      [id, resolvedUserId]
    );
    const memories = result.rows.map(mapMemory);
    this.memoriesCache.set(cacheKey, memories);
    return [...memories];
  }

  async upsertMemory(botId: string, key: string, content: string, userId?: string): Promise<BotMemory> {
    const id = requireBotId(botId);
    const normalized = normalizeMemory(key, content);
    const resolvedUserId = userId ?? 'workspace-user';
    await this.requireBot(id);
    const result = await this.query(
      `INSERT INTO bricksbot.bot_memories (id, bot_id, user_id, key, content)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (bot_id, user_id, key) DO UPDATE
       SET content = EXCLUDED.content, updated_at = NOW()
       RETURNING id, bot_id, user_id, key, content, updated_at`,
      [randomUUID(), id, resolvedUserId, normalized.key, normalized.content]
    );
    const row = result.rows[0];
    if (!row) throw new Error('Memory upsert failed');
    const memory = mapMemory(row);
    const cacheKey = `${id}:${resolvedUserId}`;
    const cached = this.memoriesCache.get(cacheKey);
    if (cached) {
      const idx = cached.findIndex((m) => m.key === memory.key);
      if (idx >= 0) {
        cached[idx] = memory;
      } else {
        cached.push(memory);
        cached.sort((a, b) => a.key.localeCompare(b.key));
      }
    }
    return memory;
  }

  async deleteMemory(botId: string, key: string, userId?: string): Promise<void> {
    const id = requireBotId(botId);
    const trimmedKey = key.trim();
    if (!trimmedKey) throw new Error('Memory key is required');
    const resolvedUserId = userId ?? 'workspace-user';
    const result = await this.query(
      `DELETE FROM bricksbot.bot_memories
       WHERE bot_id = $1 AND user_id = $2 AND key = $3
       RETURNING id`,
      [id, resolvedUserId, trimmedKey],
    );
    if (!result.rows[0]) throw new Error('Memory not found');
    const cacheKey = `${id}:${resolvedUserId}`;
    const cached = this.memoriesCache.get(cacheKey);
    if (cached) {
      const idx = cached.findIndex((m) => m.key === trimmedKey);
      if (idx >= 0) cached.splice(idx, 1);
    }
  }

  async listSkills(botId: string): Promise<BotSkill[]> {
    const id = requireBotId(botId);
    const cached = this.skillsByBot.get(id);
    if (cached) return [...cached];
    const result = await this.query(
      `SELECT id, bot_id, name, body, created_at
       FROM bricksbot.bot_skills
       WHERE bot_id = $1
       ORDER BY name ASC`,
      [id]
    );
    const skills = result.rows.map(mapSkill);
    this.skillsByBot.set(id, skills);
    return [...skills];
  }

  async createSkill(botId: string, name: string, body: string): Promise<BotSkill> {
    const id = requireBotId(botId);
    const normalized = normalizeSkill(name, body);
    await this.requireBot(id);
    const existing = await this.query(`SELECT id FROM bricksbot.bot_skills WHERE bot_id = $1 AND name = $2`, [
      id,
      normalized.name,
    ]);
    if (existing.rows[0]) throw new Error('Skill already exists');

    const result = await this.query(
      `INSERT INTO bricksbot.bot_skills (id, bot_id, name, body)
       VALUES ($1, $2, $3, $4)
       RETURNING id, bot_id, name, body, created_at`,
      [randomUUID(), id, normalized.name, normalized.body]
    );
    const row = result.rows[0];
    if (!row) throw new Error('Skill create failed');
    const skill = mapSkill(row);
    const cached = this.skillsByBot.get(id);
    if (cached) {
      cached.push(skill);
      cached.sort((a, b) => a.name.localeCompare(b.name));
    }
    return skill;
  }

  async upsertSkill(botId: string, name: string, body: string): Promise<BotSkill> {
    const id = requireBotId(botId);
    const normalized = normalizeSkill(name, body);
    await this.requireBot(id);
    const result = await this.query(
      `INSERT INTO bricksbot.bot_skills (id, bot_id, name, body)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (bot_id, name) DO UPDATE
       SET body = EXCLUDED.body
       RETURNING id, bot_id, name, body, created_at`,
      [randomUUID(), id, normalized.name, normalized.body],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Skill upsert failed');
    const skill = mapSkill(row);
    const cached = this.skillsByBot.get(id);
    if (cached) {
      const idx = cached.findIndex((s) => s.name === skill.name);
      if (idx >= 0) {
        cached[idx] = skill;
      } else {
        cached.push(skill);
        cached.sort((a, b) => a.name.localeCompare(b.name));
      }
    }
    return skill;
  }

  async deleteSkill(botId: string, skillId: string): Promise<void> {
    const id = requireBotId(botId);
    const result = await this.query(
      `DELETE FROM bricksbot.bot_skills
       WHERE id = $1 AND bot_id = $2
       RETURNING id`,
      [skillId, id]
    );
    if (!result.rows[0]) throw new Error('Skill not found');
    const cached = this.skillsByBot.get(id);
    if (cached) {
      const idx = cached.findIndex((s) => s.id === skillId);
      if (idx >= 0) cached.splice(idx, 1);
    }
  }

  async listSkillNamesForBots(botIds: string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    for (const botId of botIds) map.set(botId, []);
    if (botIds.length === 0) return map;
    const result = await this.query(
      `SELECT bot_id, name
       FROM bricksbot.bot_skills
       WHERE bot_id = ANY($1)
       ORDER BY name ASC`,
      [botIds]
    );
    for (const row of result.rows) {
      const bId = asString(row.bot_id);
      const name = asString(row.name);
      if (map.has(bId)) {
        map.get(bId)!.push(name);
      }
    }
    return map;
  }

  async cloneSkills(sourceBotId: string, targetBotId: string): Promise<void> {
    const src = requireBotId(sourceBotId);
    const tgt = requireBotId(targetBotId);
    await this.requireBot(tgt);
    await this.query(
      `INSERT INTO bricksbot.bot_skills (id, bot_id, name, body)
       SELECT gen_random_uuid(), $2, name, body
       FROM bricksbot.bot_skills
       WHERE bot_id = $1
       ON CONFLICT (bot_id, name) DO NOTHING`,
      [src, tgt]
    );
    this.skillsByBot.delete(tgt);
  }

  evictBot(botId: string): void {
    this.verifiedBots.delete(botId);
    this.skillsByBot.delete(botId);
    for (const key of this.memoriesCache.keys()) {
      if (key.startsWith(`${botId}:`)) {
        this.memoriesCache.delete(key);
      }
    }
  }
}

