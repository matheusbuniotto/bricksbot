import { describe, expect, it, vi } from 'vitest';
import { deriveSkillName, importSkillFromUrl, toRawSkillUrl } from './skill-import.js';

describe('skill-import', () => {
  it('converts github blob urls to raw', () => {
    expect(toRawSkillUrl('https://github.com/o/r/blob/main/a/SKILL.md')).toBe(
      'https://raw.githubusercontent.com/o/r/main/a/SKILL.md'
    );
  });

  it('rejects non-github and non-https urls', () => {
    expect(() => toRawSkillUrl('https://evil.com/SKILL.md')).toThrow(/GitHub/);
    expect(() => toRawSkillUrl('http://raw.githubusercontent.com/o/r/main/SKILL.md')).toThrow(/GitHub/);
  });

  it('derives name from frontmatter, else folder', () => {
    const url = 'https://raw.githubusercontent.com/o/r/main/my-skill/SKILL.md';
    expect(deriveSkillName('---\nname: Cool Skill\n---\nbody', url)).toBe('cool-skill');
    expect(deriveSkillName('# body', url)).toBe('my-skill');
  });

  it('fetches and returns the skill', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response('---\nname: x-skill\n---\nhello'))
    ) as unknown as typeof fetch;
    const out = await importSkillFromUrl('https://github.com/o/r/blob/main/x/SKILL.md', fetchImpl);
    expect(out.name).toBe('x-skill');
    expect(out.body).toContain('hello');
  });

  it('rejects oversized skills', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('a'.repeat(40_000)))) as unknown as typeof fetch;
    await expect(importSkillFromUrl('https://github.com/o/r/blob/main/x/SKILL.md', fetchImpl)).rejects.toThrow(
      /too large/
    );
  });
});
