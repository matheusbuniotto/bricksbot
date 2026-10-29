import { randomUUID } from 'node:crypto';
import type { BotMemory, BotSkill, MemorySkillStore } from '../../shared/memory/types.js';
import { normalizeMemory, normalizeSkill, requireBotId } from './input.js';

function nowIso(): string {
  return new Date().toISOString();
}

/** In-memory MemorySkillStore for tests and local runs without Lakebase. */
export class MemoryMemorySkillStore implements MemorySkillStore {
  private memories = new Map<string, BotMemory>();
  private skills = new Map<string, BotSkill>();

  async listMemories(botId: string): Promise<BotMemory[]> {
    const id = requireBotId(botId);
    return [...this.memories.values()]
      .filter((memory) => memory.botId === id)
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  async upsertMemory(botId: string, key: string, content: string): Promise<BotMemory> {
    const id = requireBotId(botId);
    const normalized = normalizeMemory(key, content);
    const existing = [...this.memories.values()].find((memory) => memory.botId === id && memory.key === normalized.key);
    const memory: BotMemory = {
      id: existing?.id ?? randomUUID(),
      botId: id,
      key: normalized.key,
      content: normalized.content,
      updatedAt: nowIso(),
    };
    this.memories.set(memory.id, memory);
    return memory;
  }

  async listSkills(botId: string): Promise<BotSkill[]> {
    const id = requireBotId(botId);
    return [...this.skills.values()].filter((skill) => skill.botId === id).sort((a, b) => a.name.localeCompare(b.name));
  }

  async createSkill(botId: string, name: string, body: string): Promise<BotSkill> {
    const id = requireBotId(botId);
    const normalized = normalizeSkill(name, body);
    const duplicate = [...this.skills.values()].some((skill) => skill.botId === id && skill.name === normalized.name);
    if (duplicate) throw new Error('Skill already exists');

    const skill: BotSkill = {
      id: randomUUID(),
      botId: id,
      name: normalized.name,
      body: normalized.body,
      createdAt: nowIso(),
    };
    this.skills.set(skill.id, skill);
    return skill;
  }

  async deleteSkill(botId: string, skillId: string): Promise<void> {
    const id = requireBotId(botId);
    const skill = this.skills.get(skillId);
    if (!skill || skill.botId !== id) throw new Error('Skill not found');
    this.skills.delete(skillId);
  }
}
