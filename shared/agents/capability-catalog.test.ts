import { describe, expect, test } from 'vitest';
import {
  buildCapabilityCatalog,
  formatCapabilityPrompt,
  skillDescriptionFromBody,
} from './capability-catalog.js';

describe('capability-catalog', () => {
  test('Primary includes handoff_to_bot and a teammate omits it', () => {
    const primary = buildCapabilityCatalog({
      toolNames: ['sql_query', 'handoff_to_bot', 'remember'],
      isPrimary: true,
      teammates: [{ id: 'b2', name: 'Analyst' }],
    });
    expect(primary.tools.map((t) => t.name)).toContain('handoff_to_bot');
    expect(primary.teammates).toEqual([{ id: 'b2', name: 'Analyst' }]);

    const teammate = buildCapabilityCatalog({
      toolNames: ['sql_query', 'remember'],
      isPrimary: false,
      teammates: [{ id: 'b2', name: 'Analyst' }],
    });
    expect(teammate.tools.map((t) => t.name)).not.toContain('handoff_to_bot');
    expect(teammate.teammates).toEqual([]);
  });

  test('soft limits reflect web_fetch registration and no computer', () => {
    const withFetch = buildCapabilityCatalog({ toolNames: ['web_fetch', 'sql_query'] });
    expect(withFetch.softLimits).toEqual({
      computer: false,
      sqlReadOnly: true,
      webFetchRegistered: true,
    });

    const withoutFetch = buildCapabilityCatalog({ toolNames: ['sql_query'] });
    expect(withoutFetch.softLimits.webFetchRegistered).toBe(false);
    expect(withoutFetch.softLimits.computer).toBe(false);
  });

  test('skills index uses name plus short description, not the full body', () => {
    const longBody = `${'step '.repeat(400)}\nDo the long workflow carefully.`;
    const catalog = buildCapabilityCatalog({
      toolNames: ['activate_skill'],
      skills: [{ name: 'Long skill', body: longBody }],
    });
    expect(catalog.skills).toEqual([
      {
        name: 'Long skill',
        description: skillDescriptionFromBody(longBody),
      },
    ]);

    const prompt = formatCapabilityPrompt(catalog);
    expect(prompt).toContain('## Capabilities');
    expect(prompt).toContain('## Skills');
    expect(prompt).toContain('Long skill');
    expect(prompt).not.toContain(longBody);
    expect(prompt.length).toBeLessThan(2_000);
  });

  test('catalog build stays under 5 ms', () => {
    const skills = Array.from({ length: 20 }, (_, i) => ({
      name: `Skill ${i}`,
      body: `Description for skill ${i}.\n${'x'.repeat(500)}`,
    }));
    const started = performance.now();
    for (let i = 0; i < 50; i++) {
      buildCapabilityCatalog({
        toolNames: ['sql_query', 'handoff_to_bot', 'remember', 'activate_skill'],
        isPrimary: true,
        teammates: [{ id: 't1', name: 'A' }],
        memoryKeys: Array.from({ length: 30 }, (_, k) => `key-${k}`),
        skills,
      });
    }
    expect(performance.now() - started).toBeLessThan(250);
  });
});
