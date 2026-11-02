import { toSkillIndexEntry } from '../../../shared/agents/capability-catalog.js';
import type { BotMemory, BotSkill } from '../../../shared/agents/memory/types.js';

/** Newest memories kept when a bot has more facts than the prompt can carry. */
export const BOT_CONTEXT_MEMORY_LIMIT = 20;

/** Hard cap on the memory and skills section appended to the system prompt. */
export const BOT_CONTEXT_CHAR_CAP = 4_000;

/**
 * System section for one bot. Empty when the bot has no memories or skills.
 * Keeps the newest memories. Skills render as a Pi-style index (name + description);
 * full bodies load on demand via activate_skill.
 */
export function formatBotContext(
  memories: Array<Pick<BotMemory, 'key' | 'content' | 'updatedAt'>>,
  skills: Array<Pick<BotSkill, 'name' | 'body'>>,
  options?: { memoryLimit?: number; charCap?: number }
): string {
  const memoryLimit = options?.memoryLimit ?? BOT_CONTEXT_MEMORY_LIMIT;
  const charCap = options?.charCap ?? BOT_CONTEXT_CHAR_CAP;

  const kept = [...memories]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.key.localeCompare(b.key))
    .slice(0, Math.max(0, memoryLimit))
    .sort((a, b) => a.key.localeCompare(b.key));

  const skillIndex = [...skills].map((skill) => toSkillIndexEntry(skill)).sort((a, b) => a.name.localeCompare(b.name));

  const blocks: string[] = [];
  if (kept.length > 0) {
    blocks.push(['Memories:', ...kept.map((memory) => `- ${memory.key}: ${memory.content}`)].join('\n'));
  }
  if (skillIndex.length > 0) {
    blocks.push(
      [
        'Skills (index — call activate_skill for full body):',
        ...skillIndex.map((skill) => `- ${skill.name}: ${skill.description}`),
      ].join('\n')
    );
  }

  const text = blocks.join('\n\n');
  if (text.length <= charCap) return text;
  return text.slice(0, charCap);
}
