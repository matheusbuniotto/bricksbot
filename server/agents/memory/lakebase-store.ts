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
  private memoriesByBot = new Map<string, BotMemory[]>();
  private skillsByBot = new Map<string, BotSkill[]>();
  private verifiedBots = new Set<string>();

  constructor(private readonly query: LakebaseQuery) {}

  private async requireBot(botId: string): Promise<void> {
    if (this.verifiedBots.has(botId)) return;
    const result = await this.query(`SELECT id FROM bricksbot.bots WHERE id = $1`, [botId]);
    if (!result.rows[0]) throw new Error('Bot not found');
    this.verifiedBots.add(botId);
  }

  async listMemories(botId: string): Promise<BotMemory[]> {
    const id = requireBotId(botId);
    const cached = this.memoriesByBot.get(id);
    if (cached) return [...cached];
    const result = await this.query(
      `SELECT id, bot_id, key, content, updated_at
       FROM bricksbot.bot_memories
       WHERE bot_id = $1
       ORDER BY key ASC`,
      [id]
    );
    const memories = result.rows.map(mapMemory);
    this.memoriesByBot.set(id, memories);
    return [...memories];
  }

  async upsertMemory(botId: string, key: string, content: string): Promise<BotMemory> {
    const id = requireBotId(botId);
    const normalized = normalizeMemory(key, content);
    await this.requireBot(id);
    const result = await this.query(
      `INSERT INTO bricksbot.bot_memories (id, bot_id, key, content)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (bot_id, key) DO UPDATE
       SET content = EXCLUDED.content, updated_at = NOW()
       RETURNING id, bot_id, key, content, updated_at`,
      [randomUUID(), id, normalized.key, normalized.content]
    );
    const row = result.rows[0];
    if (!row) throw new Error('Memory upsert failed');
    const memory = mapMemory(row);
    const cached = this.memoriesByBot.get(id);
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

  async deleteMemory(botId: string, key: string): Promise<void> {
    const id = requireBotId(botId);
    const trimmedKey = key.trim();
    if (!trimmedKey) throw new Error('Memory key is required');
    const result = await this.query(
      `DELETE FROM bricksbot.bot_memories
       WHERE bot_id = $1 AND key = $2
       RETURNING id`,
      [id, trimmedKey],
    );
    if (!result.rows[0]) throw new Error('Memory not found');
    const cached = this.memoriesByBot.get(id);
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
}
