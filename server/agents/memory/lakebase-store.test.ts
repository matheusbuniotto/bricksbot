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
      const [id, botId, userId, key, content] = params.map(String);
      const existing = memories.find((row) => row.bot_id === botId && row.user_id === userId && row.key === key);
      if (existing) {
        existing.content = content;
        existing.updated_at = new Date().toISOString();
        return { rows: [{ ...existing }] };
      }
      const row = {
        id,
        bot_id: botId,
        user_id: userId,
        key,
        content,
        updated_at: new Date().toISOString(),
      };
      memories.push(row);
      return { rows: [{ ...row }] };
    }

    if (normalized.startsWith('DELETE FROM bricksbot.bot_memories')) {
      const [botId, userId, key] = params.map(String);
      const index = memories.findIndex((row) => row.bot_id === botId && row.user_id === userId && row.key === key);
      if (index < 0) return { rows: [] };
      const [removed] = memories.splice(index, 1);
      return { rows: [{ id: removed?.id }] };
    }

    if (normalized.includes('FROM bricksbot.bot_memories')) {
      const botId = String(params[0]);
      const userId = params[1] ? String(params[1]) : undefined;
      return {
        rows: memories
          .filter((row) => row.bot_id === botId && (!userId || row.user_id === userId))
          .sort((a, b) => String(a.key).localeCompare(String(b.key))),
      };
    }

    if (normalized.startsWith('DELETE FROM bricksbot.bot_skills')) {
      const [skillId, botId] = params.map(String);
      const index = skills.findIndex((row) => row.id === skillId && row.bot_id === botId);
      if (index < 0) return { rows: [] };
      const [removed] = skills.splice(index, 1);
      return { rows: [{ id: removed?.id }] };
    }

    if (normalized.startsWith('INSERT INTO bricksbot.bot_skills') && normalized.includes('SELECT')) {
      const [src, tgt] = params.map(String);
      const toClone = skills.filter((s) => s.bot_id === src);
      for (const s of toClone) {
        if (!skills.some((existing) => existing.bot_id === tgt && existing.name === s.name)) {
          skills.push({
            id: `cloned-${s.id}`,
            bot_id: tgt,
            name: s.name,
            body: s.body,
            created_at: new Date().toISOString(),
          });
        }
      }
      return { rows: [] };
    }

    if (normalized.startsWith('INSERT INTO bricksbot.bot_skills')) {
      const [id, botId, name, body] = params.map(String);
      const existing = skills.find((row) => row.bot_id === botId && row.name === name);
      if (existing) {
        existing.body = body;
        return { rows: [{ ...existing }] };
      }
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

    if (normalized.includes('FROM bricksbot.bot_skills') && normalized.includes('ANY($1)')) {
      const botIds = (params[0] as string[]) ?? [];
      const set = new Set(botIds);
      return {
        rows: skills
          .filter((s) => set.has(String(s.bot_id)))
          .map((s) => ({ bot_id: s.bot_id, name: s.name })),
      };
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

  test('caches listMemories and listSkills and updates caches in-place on mutations', async () => {
    const fake = createFakeLakebase();
    fake.bots.add('bot-a');
    const queries: string[] = [];
    const countingQuery: LakebaseQuery = async (sql, params) => {
      queries.push(sql.replace(/\s+/g, ' ').trim());
      return fake.query(sql, params);
    };
    const store = new LakebaseMemorySkillStore(countingQuery);

    expect(await store.listMemories('bot-a')).toEqual([]);
    expect(await store.listSkills('bot-a')).toEqual([]);

    queries.length = 0;
    expect(await store.listMemories('bot-a')).toEqual([]);
    expect(await store.listSkills('bot-a')).toEqual([]);
    expect(queries).toHaveLength(0);

    await store.upsertMemory('bot-a', 'b-key', 'two');
    await store.upsertMemory('bot-a', 'a-key', 'one');
    await store.createSkill('bot-a', 'z-skill', 'body z');
    await store.upsertSkill('bot-a', 'a-skill', 'body a');

    queries.length = 0;
    expect((await store.listMemories('bot-a')).map((m) => m.key)).toEqual(['a-key', 'b-key']);
    expect((await store.listSkills('bot-a')).map((s) => s.name)).toEqual(['a-skill', 'z-skill']);
    expect(queries).toHaveLength(0);

    await store.deleteMemory('bot-a', 'a-key');
    const zSkill = (await store.listSkills('bot-a')).find((s) => s.name === 'z-skill')!;
    await store.deleteSkill('bot-a', zSkill.id);

    queries.length = 0;
    expect((await store.listMemories('bot-a')).map((m) => m.key)).toEqual(['b-key']);
    expect((await store.listSkills('bot-a')).map((s) => s.name)).toEqual(['a-skill']);
    expect(queries).toHaveLength(0);
  });

  test('isolates memories per user on the same bot', async () => {
    const fake = createFakeLakebase();
    fake.bots.add('shared-bot');
    const store = new LakebaseMemorySkillStore(fake.query);

    await store.upsertMemory('shared-bot', 'pref', 'user1-pref', 'user-1');
    await store.upsertMemory('shared-bot', 'pref', 'user2-pref', 'user-2');

    const u1Memories = await store.listMemories('shared-bot', 'user-1');
    const u2Memories = await store.listMemories('shared-bot', 'user-2');

    expect(u1Memories).toEqual([expect.objectContaining({ key: 'pref', content: 'user1-pref', userId: 'user-1' })]);
    expect(u2Memories).toEqual([expect.objectContaining({ key: 'pref', content: 'user2-pref', userId: 'user-2' })]);

    await store.deleteMemory('shared-bot', 'pref', 'user-1');
    expect(await store.listMemories('shared-bot', 'user-1')).toEqual([]);
    expect(await store.listMemories('shared-bot', 'user-2')).toHaveLength(1);
  });

  test('batches skill names, clones skills across bots, and evicts bot cache', async () => {
    const fake = createFakeLakebase();
    fake.bots.add('source-bot');
    fake.bots.add('target-bot');
    const store = new LakebaseMemorySkillStore(fake.query);

    await store.createSkill('source-bot', 'skill-1', 'body 1');
    await store.createSkill('source-bot', 'skill-2', 'body 2');

    const skillMap = await store.listSkillNamesForBots(['source-bot', 'target-bot']);
    expect(skillMap.get('source-bot')).toEqual(['skill-1', 'skill-2']);
    expect(skillMap.get('target-bot')).toEqual([]);

    await store.cloneSkills('source-bot', 'target-bot');
    const targetSkills = await store.listSkills('target-bot');
    expect(targetSkills.map((s) => s.name)).toEqual(['skill-1', 'skill-2']);

    await store.upsertMemory('source-bot', 'k', 'v', 'user-1');
    expect(await store.listMemories('source-bot', 'user-1')).toHaveLength(1);

    store.evictBot('source-bot');
    // After eviction, verifiedBots and cached entries are cleared
    fake.bots.delete('source-bot');
    await expect(store.upsertMemory('source-bot', 'k', 'v2', 'user-1')).rejects.toThrow(/not found/i);
  });
});
