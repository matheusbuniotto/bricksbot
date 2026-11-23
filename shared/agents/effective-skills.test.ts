import { describe, expect, test } from 'vitest';
import { mergeEffectiveSkills, resolveEffectiveSkill } from './effective-skills.js';
import { SEED_SKILLS } from './seed-skills.js';

describe('effective-skills', () => {
  test('merge includes all seeds when the bot has no skills', () => {
    const merged = mergeEffectiveSkills('bot-1', []);
    expect(merged.map((s) => s.name).sort()).toEqual([...SEED_SKILLS].map((s) => s.name).sort());
    expect(merged.every((s) => s.source === 'seed')).toBe(true);
  });

  test('bot skill overrides a seed with the same name (case-insensitive)', () => {
    const merged = mergeEffectiveSkills('bot-1', [
      {
        id: 'custom-1',
        botId: 'bot-1',
        name: 'SQL-Explore',
        body: 'Custom override body',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    const sql = merged.find((s) => s.name.toLowerCase() === 'sql-explore');
    expect(sql).toMatchObject({
      id: 'custom-1',
      name: 'SQL-Explore',
      body: 'Custom override body',
      source: 'bot',
    });
    expect(merged.filter((s) => s.source === 'seed')).toHaveLength(SEED_SKILLS.length - 1);
  });

  test('resolveEffectiveSkill prefers bot then seed', () => {
    const botSkills = [
      {
        id: 'b1',
        botId: 'bot-1',
        name: 'catalog-recon',
        body: 'Bot catalog',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ];
    expect(resolveEffectiveSkill('bot-1', botSkills, 'catalog-recon')?.body).toBe('Bot catalog');
    expect(resolveEffectiveSkill('bot-1', [], 'weekly-table-health')?.source).toBe('seed');
    expect(resolveEffectiveSkill('bot-1', [], 'metric-view-first')?.source).toBe('seed');
    expect(resolveEffectiveSkill('bot-1', [], 'missing')).toBeUndefined();
  });
});
