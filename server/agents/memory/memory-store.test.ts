import { describe, expect, test } from 'vitest';
import { MemoryMemorySkillStore } from './memory-store.js';

describe('MemoryMemorySkillStore', () => {
  test('upserts memory by key and keeps skills scoped to one bot', async () => {
    const store = new MemoryMemorySkillStore();

    const first = await store.upsertMemory('bot-a', ' warehouse ', ' us-east ');
    const second = await store.upsertMemory('bot-a', 'warehouse', 'us-west');
    await store.upsertMemory('bot-b', 'warehouse', 'eu-central');

    expect(second.id).toBe(first.id);
    expect(second.content).toBe('us-west');
    const listed = await store.listMemories('bot-a');
    expect(listed).toEqual([expect.objectContaining({ id: first.id, key: 'warehouse', content: 'us-west' })]);

    const skill = await store.createSkill('bot-a', 'SQL style', 'Prefer concise SQL.');
    expect(await store.listSkills('bot-a')).toEqual([skill]);
    expect(await store.listSkills('bot-b')).toEqual([]);

    await expect(store.createSkill('bot-a', 'SQL style', 'other')).rejects.toThrow(/already exists/i);

    await store.deleteSkill('bot-a', skill.id);
    expect(await store.listSkills('bot-a')).toEqual([]);
    await expect(store.deleteSkill('bot-a', skill.id)).rejects.toThrow(/not found/i);
  });
});
