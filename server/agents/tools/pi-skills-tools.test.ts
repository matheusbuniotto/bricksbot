import { describe, expect, test } from 'vitest';
import { MemoryChatStore } from '../../chat/memory-store.js';
import { MemoryMemorySkillStore } from '../memory/memory-store.js';
import {
  createActivateSkillTool,
  createListMemoriesTool,
  createPiSkillTools,
  createReadSkillResourceTool,
  SKILL_BODY_PATH,
} from './pi-skills-tools.js';

describe('pi-skills-tools', () => {
  test('createPiSkillTools registers activate_skill, read_skill_resource, list_memories', () => {
    const memory = new MemoryMemorySkillStore();
    const names = createPiSkillTools(memory).map((tool) => tool.definition.name);
    expect(names).toEqual(['activate_skill', 'read_skill_resource', 'list_memories']);
  });

  test('activate_skill loads body and activate_skill miss lists available names', async () => {
    const store = new MemoryChatStore();
    const bot = await store.ensurePrimaryBot();
    const memory = new MemoryMemorySkillStore();
    await memory.createSkill(bot.id, 'SQL style', 'Prefer concise SQL.\nQualify tables.');
    const tool = createActivateSkillTool(memory);
    const ctx = { chatId: 'c1', bot };

    const hit = JSON.parse(await tool.execute({ name: 'SQL style' }, ctx));
    expect(hit.ok).toBe(true);
    expect(hit.instructions).toContain('Prefer concise SQL.');
    expect(hit.resources).toEqual([SKILL_BODY_PATH]);

    const miss = JSON.parse(await tool.execute({ name: 'Missing' }, ctx));
    expect(miss.ok).toBe(false);
    expect(miss.available).toContain('SQL style');
  });

  test('read_skill_resource returns SKILL.md body and clear miss for other paths', async () => {
    const store = new MemoryChatStore();
    const bot = await store.ensurePrimaryBot();
    const memory = new MemoryMemorySkillStore();
    await memory.createSkill(bot.id, 'SQL style', 'Prefer concise SQL.');
    const tool = createReadSkillResourceTool(memory);
    const ctx = { chatId: 'c1', bot };

    const body = JSON.parse(
      await tool.execute({ name: 'SQL style', path: 'SKILL.md' }, ctx),
    );
    expect(body).toMatchObject({ ok: true, content: 'Prefer concise SQL.', path: SKILL_BODY_PATH });

    const combined = JSON.parse(await tool.execute({ resource: 'SQL style/SKILL.md' }, ctx));
    expect(combined.ok).toBe(true);

    const miss = JSON.parse(
      await tool.execute({ name: 'SQL style', path: 'references/other.md' }, ctx),
    );
    expect(miss.ok).toBe(false);
    expect(miss.available).toEqual([SKILL_BODY_PATH]);
  });

  test('list_memories returns overflow keys outside a small window', async () => {
    const store = new MemoryChatStore();
    const bot = await store.ensurePrimaryBot();
    const memory = new MemoryMemorySkillStore();
    for (let i = 0; i < 25; i++) {
      await memory.upsertMemory(bot.id, `key-${String(i).padStart(2, '0')}`, `value-${i}`);
    }
    const tool = createListMemoriesTool(memory);
    const result = JSON.parse(await tool.execute({ query: 'key-24' }, { chatId: 'c1', bot }));
    expect(result.ok).toBe(true);
    expect(result.memories).toEqual([
      expect.objectContaining({ key: 'key-24', content: 'value-24' }),
    ]);
  });
});
