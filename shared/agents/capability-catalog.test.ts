import { describe, expect, test } from 'vitest';
import { buildCapabilityCatalog, formatCapabilityPrompt, skillDescriptionFromBody } from './capability-catalog.js';

describe('capability-catalog', () => {
  test('Primary includes handoff_to_bot and a teammate omits it', () => {
    const primary = buildCapabilityCatalog({
      toolNames: ['sql_query', 'handoff_to_bot', 'create_bot', 'remember'],
      isPrimary: true,
      teammates: [{ id: 'b2', name: 'Analyst' }],
    });
    expect(primary.tools.map((t) => t.name)).toContain('handoff_to_bot');
    expect(primary.tools.map((t) => t.name)).toContain('create_bot');
    expect(primary.teammates).toEqual([{ id: 'b2', name: 'Analyst' }]);
    const primaryPrompt = formatCapabilityPrompt(primary);
    expect(primaryPrompt).toContain('create_bot');

    const teammate = buildCapabilityCatalog({
      toolNames: ['sql_query', 'remember'],
      isPrimary: false,
      teammates: [{ id: 'b2', name: 'Analyst' }],
    });
    expect(teammate.tools.map((t) => t.name)).not.toContain('handoff_to_bot');
    expect(teammate.tools.map((t) => t.name)).not.toContain('create_bot');
    expect(teammate.teammates).toEqual([]);
    expect(formatCapabilityPrompt(teammate)).toContain('cannot create bots');
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
    expect(prompt.length).toBeLessThan(2_500);
  });

  test('capability prompt mentions pin_artifact and pin_chart when registered', () => {
    const catalog = buildCapabilityCatalog({
      toolNames: ['pin_artifact', 'pin_chart', 'remember', 'sql_query'],
      skills: [
        { name: 'pin-finding', body: '## When to use\nPin findings.' },
        { name: 'dataviz', body: '## When to use\nChart SQL results.' },
      ],
    });
    const prompt = formatCapabilityPrompt(catalog);
    expect(prompt).toContain('pin_artifact');
    expect(prompt).toContain('pin_chart');
    expect(prompt).toContain('dataviz');
    expect(prompt).toContain('remember for lasting rules');
    expect(prompt).toContain('pin-finding');
    expect(prompt).toContain('no secrets');
  });

  test('capability prompt encodes cite-fresh-data and save_skill habits', () => {
    const catalog = buildCapabilityCatalog({
      toolNames: ['activate_skill', 'save_skill', 'sql_query'],
      skills: [{ name: 'sql-explore', body: '## When to use\nExplore SQL safely.' }],
    });
    const prompt = formatCapabilityPrompt(catalog);
    expect(prompt).toContain('Memory is not a source of truth');
    expect(prompt).toContain('save_skill');
    expect(prompt).toContain('sql-explore');
    expect(prompt).toContain('seed skills');
  });

  test('capability prompt mentions schedule_routine when registered', () => {
    const catalog = buildCapabilityCatalog({
      toolNames: ['schedule_routine', 'remember'],
    });
    const prompt = formatCapabilityPrompt(catalog);
    expect(prompt).toContain('schedule_routine');
    expect(prompt).toContain('Routines CRUD');
    expect(prompt).toContain('You can create:');
    expect(prompt).toContain('routines (schedule_routine)');
    expect(prompt).toContain('memories (remember)');
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
