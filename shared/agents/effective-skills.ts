import type { BotSkill } from './memory/types.js';
import { SEED_SKILLS, seedSkillByName, type SeedSkill } from './seed-skills.js';

export type EffectiveSkillSource = 'bot' | 'seed';

/** Skill row used in prompts and activate_skill (seed or bot). */
export interface EffectiveSkill {
  id: string;
  botId: string;
  name: string;
  body: string;
  createdAt: string;
  source: EffectiveSkillSource;
}

const SEED_CREATED_AT = '1970-01-01T00:00:00.000Z';

function toSeedEffective(seed: SeedSkill, botId: string): EffectiveSkill {
  return {
    id: `seed:${seed.name}`,
    botId,
    name: seed.name,
    body: seed.body,
    createdAt: SEED_CREATED_AT,
    source: 'seed',
  };
}

/**
 * Merge built-in seed skills with per-bot saved skills.
 * Bot rows win on case-insensitive name; otherwise seeds fill the index.
 */
export function mergeEffectiveSkills(
  botId: string,
  botSkills: Array<Pick<BotSkill, 'id' | 'botId' | 'name' | 'body' | 'createdAt'>>,
  seeds: readonly SeedSkill[] = SEED_SKILLS,
): EffectiveSkill[] {
  const byName = new Map<string, EffectiveSkill>();

  for (const seed of seeds) {
    byName.set(seed.name.toLowerCase(), toSeedEffective(seed, botId));
  }

  for (const skill of botSkills) {
    byName.set(skill.name.toLowerCase(), {
      id: skill.id,
      botId: skill.botId,
      name: skill.name,
      body: skill.body,
      createdAt: skill.createdAt,
      source: 'bot',
    });
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Resolve one skill by name from bot store rows + seeds (bot wins). */
export function resolveEffectiveSkill(
  botId: string,
  botSkills: Array<Pick<BotSkill, 'id' | 'botId' | 'name' | 'body' | 'createdAt'>>,
  name: string,
  seeds: readonly SeedSkill[] = SEED_SKILLS,
): EffectiveSkill | undefined {
  const needle = name.trim().toLowerCase();
  if (!needle) return undefined;

  const botHit = botSkills.find((skill) => skill.name.trim().toLowerCase() === needle);
  if (botHit) {
    return {
      id: botHit.id,
      botId: botHit.botId,
      name: botHit.name,
      body: botHit.body,
      createdAt: botHit.createdAt,
      source: 'bot',
    };
  }

  const seed = seedSkillByName(name) ?? seeds.find((s) => s.name.toLowerCase() === needle);
  return seed ? toSeedEffective(seed, botId) : undefined;
}
