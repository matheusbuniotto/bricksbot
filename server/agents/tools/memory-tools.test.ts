import { describe, expect, test } from 'vitest';
import { MemoryMemorySkillStore } from '../memory/memory-store.js';
import { createMemorySkillTools } from './memory-tools.js';

describe('memory skill tools', () => {
  test('remember, forget, and save_skill round-trip', async () => {
    const memory = new MemoryMemorySkillStore();
    const [remember, forget, saveSkill] = createMemorySkillTools(memory);
    const ctx = {
      chatId: 'chat-1',
      bot: {
        id: 'bot-1',
        name: 'Analyst',
        avatarLabel: 'A',
        presence: 'online' as const,
        spaceId: null,
        isPrimary: false,
        ownerId: 'user-1',
        sortOrder: 0,
        archivedAt: null,
        createdAt: new Date().toISOString(),
      },
    };

    await remember.execute({ key: 'timezone', content: 'America/Sao_Paulo' }, ctx);
    expect(await memory.listMemories('bot-1')).toEqual([
      expect.objectContaining({ key: 'timezone', content: 'America/Sao_Paulo' }),
    ]);

    await forget.execute({ key: 'timezone' }, ctx);
    expect(await memory.listMemories('bot-1')).toEqual([]);

    await saveSkill.execute(
      {
        name: 'Weekly health',
        body: '## When\nMondays\n## Steps\n1. Query\n2. Summarize',
      },
      ctx
    );
    expect(await memory.listSkills('bot-1')).toEqual([expect.objectContaining({ name: 'Weekly health' })]);
  });
});
