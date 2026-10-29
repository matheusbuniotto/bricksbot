import { describe, expect, test } from 'vitest';
import type { LakebaseQuery } from '../../chat/lakebase-store.js';
import { LakebaseMemorySkillStore } from './lakebase-store.js';

type Row = Record<string, unknown>;

function createFakeLakebase(): { query: LakebaseQuery; bots: Set<string> } {
  const bots = new Set<string>();
  const memories: Row[] = [];
  const skills: Row[] = [];

  const query: LakebaseQuery = async (sql, params = []) => {
    const normalized = sql.replace(/\s+/g, ' ').trim();

    if (normalized.startsWith('SELECT id FROM bricksbot.bots')) {
      const id = String(params[0]);
      return { rows: bots.has(id) ? [{ id }] : [] };
    }

    if (normalized.startsWith('INSERT INTO bricksbot.bot_memories')) {
      const [id, botId, key, content] = params.map(String);
      const existing = memories.find((row) => row.bot_id === botId && row.key === key);
      if (existing) {
        existing.content = content;
        existing.updated_at = new Date().toISOString();
        return { rows: [{ ...existing }] };
      }
      const row = {
        id,
        bot_id: botId,
        key,
        content,
        updated_at: new Date().toISOString(),
      };
      memories.push(row);
      return { rows: [{ ...row }] };
    }

    if (normalized.includes('FROM bricksbot.bot_memories')) {
      const botId = String(params[0]);
      return {
        rows: memories.filter((row) => row.bot_id === botId).sort((a, b) => String(a.key).localeCompare(String(b.key))),
      };
    }

    if (normalized.startsWith('DELETE FROM bricksbot.bot_skills')) {
      const [skillId, botId] = params.map(String);
      const index = skills.findIndex((row) => row.id === skillId && row.bot_id === botId);
      if (index < 0) return { rows: [] };
      const [removed] = skills.splice(index, 1);
      return { rows: [{ id: removed?.id }] };
    }

    if (normalized.startsWith('INSERT INTO bricksbot.bot_skills')) {
      const [id, botId, name, body] = params.map(String);
      const row = {
        id,
        bot_id: botId,
        name,
        body,
        created_at: new Date().toISOString(),
      };
      skills.push(row);
      return { rows: [{ ...row }] };
    }

    if (normalized.includes('FROM bricksbot.bot_skills') && normalized.includes('AND name =')) {
      const [botId, name] = params.map(String);
      const row = skills.find((skill) => skill.bot_id === botId && skill.name === name);
      return { rows: row ? [{ id: row.id }] : [] };
    }

    if (normalized.includes('FROM bricksbot.bot_skills')) {
      const botId = String(params[0]);
      return {
        rows: skills.filter((row) => row.bot_id === botId).sort((a, b) => String(a.name).localeCompare(String(b.name))),
      };
    }

    throw new Error(`Unexpected SQL: ${normalized}`);
  };

  return { query, bots };
}

describe('LakebaseMemorySkillStore', () => {
  test('upserts memory by key and creates then deletes a skill', async () => {
    const fake = createFakeLakebase();
    fake.bots.add('bot-a');
    const store = new LakebaseMemorySkillStore(fake.query);

    const first = await store.upsertMemory('bot-a', 'warehouse', 'us-east');
    const second = await store.upsertMemory('bot-a', 'warehouse', 'us-west');
    expect(second.id).toBe(first.id);
    expect(await store.listMemories('bot-a')).toEqual([
      expect.objectContaining({ key: 'warehouse', content: 'us-west' }),
    ]);

    const skill = await store.createSkill('bot-a', 'SQL style', 'Prefer concise SQL.');
    await expect(store.createSkill('bot-a', 'SQL style', 'again')).rejects.toThrow(/already exists/i);
    expect(await store.listSkills('bot-a')).toEqual([expect.objectContaining({ id: skill.id, name: 'SQL style' })]);

    await store.deleteSkill('bot-a', skill.id);
    expect(await store.listSkills('bot-a')).toEqual([]);
    await expect(store.upsertMemory('missing-bot', 'warehouse', 'us-west')).rejects.toThrow(/not found/i);
  });
});
