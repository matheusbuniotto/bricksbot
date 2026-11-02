import { randomUUID } from 'node:crypto';
import type { BotMemory, BotSkill, MemorySkillStore } from '../../../shared/agents/memory/types.js';
import { normalizeMemory, normalizeSkill, requireBotId } from './input.js';

function nowIso(): string {
  return new Date().toISOString();
}

/** In-memory MemorySkillStore for tests and local runs without Lakebase. */
export class MemoryMemorySkillStore implements MemorySkillStore {
  private memories = new Map<string, BotMemory>();
  private skills = new Map<string, BotSkill>();

  async listMemories(botId: string, userId?: string): Promise<BotMemory[]> {
    const id = requireBotId(botId);
    return [...this.memories.values()]
      .filter(
        (memory) =>
          memory.botId === id &&
          (!userId || memory.userId === userId || (!memory.userId && userId === 'workspace-user'))
      )
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  async upsertMemory(botId: string, key: string, content: string, userId?: string): Promise<BotMemory> {
    const id = requireBotId(botId);
    const normalized = normalizeMemory(key, content);
    const resolvedUserId = userId ?? 'workspace-user';
    const existing = [...this.memories.values()].find(
      (memory) =>
        memory.botId === id && memory.key === normalized.key && (memory.userId ?? 'workspace-user') === resolvedUserId
    );
    const memory: BotMemory = {
      id: existing?.id ?? randomUUID(),
      botId: id,
      userId: resolvedUserId,
      key: normalized.key,
      content: normalized.content,
      updatedAt: nowIso(),
    };
    this.memories.set(memory.id, memory);
    return memory;
  }

  async deleteMemory(botId: string, key: string, userId?: string): Promise<void> {
    const id = requireBotId(botId);
    const trimmedKey = key.trim();
    if (!trimmedKey) throw new Error('Memory key is required');
    const resolvedUserId = userId ?? 'workspace-user';
    const existing = [...this.memories.values()].find(
      (memory) =>
        memory.botId === id && memory.key === trimmedKey && (memory.userId ?? 'workspace-user') === resolvedUserId
    );
    if (!existing) throw new Error('Memory not found');
    this.memories.delete(existing.id);
  }

  async listSkills(botId: string): Promise<BotSkill[]> {
    const id = requireBotId(botId);
    return [...this.skills.values()].filter((skill) => skill.botId === id).sort((a, b) => a.name.localeCompare(b.name));
  }

  async listSkillNamesForBots(botIds: string[]): Promise<Map<string, string[]>> {
    const idSet = new Set(botIds);
    const map = new Map<string, string[]>();
    for (const botId of botIds) map.set(botId, []);
    for (const skill of this.skills.values()) {
      if (idSet.has(skill.botId)) {
        map.get(skill.botId)!.push(skill.name);
      }
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.localeCompare(b));
    }
    return map;
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

  async upsertSkill(botId: string, name: string, body: string): Promise<BotSkill> {
    const id = requireBotId(botId);
    const normalized = normalizeSkill(name, body);
    const existing = [...this.skills.values()].find((skill) => skill.botId === id && skill.name === normalized.name);
    if (existing) {
      const updated: BotSkill = { ...existing, body: normalized.body };
      this.skills.set(existing.id, updated);
      return updated;
    }
    return this.createSkill(botId, name, body);
  }

  async deleteSkill(botId: string, skillId: string): Promise<void> {
    const id = requireBotId(botId);
    const skill = this.skills.get(skillId);
    if (!skill || skill.botId !== id) throw new Error('Skill not found');
    this.skills.delete(skillId);
  }

  async cloneSkills(sourceBotId: string, targetBotId: string): Promise<void> {
    const sourceSkills = [...this.skills.values()].filter((s) => s.botId === sourceBotId);
    for (const s of sourceSkills) {
      const cloned: BotSkill = {
        id: randomUUID(),
        botId: targetBotId,
        name: s.name,
        body: s.body,
        createdAt: nowIso(),
      };
      this.skills.set(cloned.id, cloned);
    }
  }

  evictBot(botId: string): void {
    for (const [id, m] of this.memories.entries()) {
      if (m.botId === botId) this.memories.delete(id);
    }
    for (const [id, s] of this.skills.entries()) {
      if (s.botId === botId) this.skills.delete(id);
    }
  }
}
