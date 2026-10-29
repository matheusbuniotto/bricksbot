import type { ToolDefinition } from '../../../shared/agents/types.js';
import type { BotSkill, MemorySkillStore } from '../../../shared/agents/memory/types.js';
import type { HandoffTurnContext } from '../handoff.js';

type RegisteredTool = {
  definition: ToolDefinition;
  preflight?: (args: Record<string, unknown>, ctx: HandoffTurnContext) => string | null | Promise<string | null>;
  execute(args: Record<string, unknown>, ctx: HandoffTurnContext): Promise<string>;
};

/** Primary markdown body path (Agent Skills SKILL.md equivalent for Lakebase skills). */
export const SKILL_BODY_PATH = 'SKILL.md';

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function findSkill(skills: BotSkill[], name: string): BotSkill | undefined {
  const needle = name.trim().toLowerCase();
  if (!needle) return undefined;
  return skills.find((skill) => skill.name.trim().toLowerCase() === needle);
}

function parseSkillResourceRef(args: Record<string, unknown>): { name: string; path: string } | null {
  const name = readText(args.name) || readText(args.skill);
  const path = readText(args.path);
  if (name && path) return { name, path };

  const combined = readText(args.resource) || readText(args.ref);
  if (!combined) return name ? { name, path: SKILL_BODY_PATH } : null;

  const slash = combined.indexOf('/');
  if (slash <= 0) {
    return { name: combined, path: SKILL_BODY_PATH };
  }
  return { name: combined.slice(0, slash).trim(), path: combined.slice(slash + 1).trim() };
}

function normalizeSkillPath(path: string): string {
  return path.replace(/^\.?\//, '').replace(/\\/g, '/');
}

function isSkillBodyPath(path: string): boolean {
  const normalized = normalizeSkillPath(path).toLowerCase();
  return (
    normalized === '' ||
    normalized === SKILL_BODY_PATH.toLowerCase() ||
    normalized === 'skill.md' ||
    normalized === 'body' ||
    normalized === 'body.md'
  );
}

/**
 * Pi / Agent Skills tools: activate_skill + read_skill_resource.
 * run_skill_script is intentionally omitted (no sandbox until Phase 5).
 */
export function createActivateSkillTool(memory: MemorySkillStore): RegisteredTool {
  return {
    definition: {
      name: 'activate_skill',
      description:
        'Load a saved skill’s full instructions and bundled resource list for this bot. Use when a Skills index entry matches the user task.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Skill name from the Skills index' },
        },
        required: ['name'],
      },
    },
    preflight(_args, ctx) {
      return ctx.bot ? null : 'activate_skill requires an active Bot';
    },
    async execute(args, ctx) {
      const name = readText(args.name) || readText(args.skill);
      if (!name) {
        return JSON.stringify({ ok: false, error: 'Skill name is required' });
      }
      const skills = await memory.listSkills(ctx.bot!.id);
      const skill = findSkill(skills, name);
      if (!skill) {
        return JSON.stringify({
          ok: false,
          error: `Skill not found: ${name}`,
          available: skills.map((row) => row.name),
        });
      }
      return JSON.stringify({
        ok: true,
        name: skill.name,
        instructions: skill.body,
        resources: [SKILL_BODY_PATH],
        note: 'Markdown-only Lakebase skill. Call read_skill_resource with path SKILL.md for the body. Bundled Volume packs are not available yet.',
      });
    },
  };
}

export function createReadSkillResourceTool(memory: MemorySkillStore): RegisteredTool {
  return {
    definition: {
      name: 'read_skill_resource',
      description:
        'Read a bundled skill resource by name + path (or skill-name/path). For Lakebase markdown skills, SKILL.md is the skill body.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Skill name' },
          path: { type: 'string', description: 'Resource path within the skill, e.g. SKILL.md' },
          resource: {
            type: 'string',
            description: 'Optional combined ref skill-name/path',
          },
        },
        required: [],
      },
    },
    preflight(_args, ctx) {
      return ctx.bot ? null : 'read_skill_resource requires an active Bot';
    },
    async execute(args, ctx) {
      const ref = parseSkillResourceRef(args);
      if (!ref?.name) {
        return JSON.stringify({
          ok: false,
          error: 'Provide name + path, or resource as skill-name/path',
        });
      }
      const skills = await memory.listSkills(ctx.bot!.id);
      const skill = findSkill(skills, ref.name);
      if (!skill) {
        return JSON.stringify({
          ok: false,
          error: `Skill not found: ${ref.name}`,
          available: skills.map((row) => row.name),
        });
      }
      if (!isSkillBodyPath(ref.path)) {
        return JSON.stringify({
          ok: false,
          error: `Resource not found: ${ref.path}`,
          available: [SKILL_BODY_PATH],
          note: 'Only SKILL.md (skill body) is available until UC Volume skill packs land.',
        });
      }
      return JSON.stringify({
        ok: true,
        name: skill.name,
        path: SKILL_BODY_PATH,
        content: skill.body,
      });
    },
  };
}

/**
 * List durable memory keys (and optional content) when keys fall outside the prompt window.
 * Pi Durable core has no Lakebase memory list tool — keep this thin adapter.
 */
export function createListMemoriesTool(memory: MemorySkillStore): RegisteredTool {
  return {
    definition: {
      name: 'list_memories',
      description:
        'List this bot’s durable memory keys (and content). Use when a needed key may be outside the system prompt window.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Optional substring filter on key or content',
          },
          include_content: {
            type: 'boolean',
            description: 'When true, include memory content (default true)',
          },
        },
        required: [],
      },
    },
    preflight(_args, ctx) {
      return ctx.bot ? null : 'list_memories requires an active Bot';
    },
    async execute(args, ctx) {
      const query = readText(args.query).toLowerCase();
      const includeContent = args.include_content !== false;
      const memories = await memory.listMemories(ctx.bot!.id);
      const filtered = query
        ? memories.filter(
            (row) =>
              row.key.toLowerCase().includes(query) || row.content.toLowerCase().includes(query),
          )
        : memories;
      return JSON.stringify({
        ok: true,
        count: filtered.length,
        memories: filtered.map((row) =>
          includeContent
            ? { key: row.key, content: row.content, updatedAt: row.updatedAt }
            : { key: row.key, updatedAt: row.updatedAt },
        ),
      });
    },
  };
}

export function createPiSkillTools(memory: MemorySkillStore): RegisteredTool[] {
  return [
    createActivateSkillTool(memory),
    createReadSkillResourceTool(memory),
    createListMemoriesTool(memory),
  ];
}
