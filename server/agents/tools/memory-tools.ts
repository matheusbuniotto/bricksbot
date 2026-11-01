import type { ToolDefinition } from '../../../shared/agents/types.js';
import type { MemorySkillStore } from '../../../shared/agents/memory/types.js';
import type { HandoffTurnContext } from '../handoff.js';

type RegisteredTool = {
  definition: ToolDefinition;
  preflight?: (args: Record<string, unknown>, ctx: HandoffTurnContext) => string | null | Promise<string | null>;
  execute(args: Record<string, unknown>, ctx: HandoffTurnContext): Promise<string>;
};

export function createRememberTool(memory: MemorySkillStore): RegisteredTool {
  return {
    definition: {
      name: 'remember',
      description:
        'Save a lasting fact or preference about the user/work into this Bot’s durable memory. Use for rules that should shape future turns, not one-off task notes.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Short stable label, e.g. timezone or approval_rule' },
          content: { type: 'string', description: 'The durable fact to remember' },
        },
        required: ['key', 'content'],
      },
    },
    preflight(_args, ctx) {
      return ctx.bot ? null : 'remember requires an active Bot';
    },
    async execute(args, ctx) {
      const key = typeof args.key === 'string' ? args.key : '';
      const content = typeof args.content === 'string' ? args.content : '';
      const entry = await memory.upsertMemory(ctx.bot!.id, key, content, ctx.userId);
      return JSON.stringify({ ok: true, key: entry.key, content: entry.content });
    },
  };
}

export function createForgetTool(memory: MemorySkillStore): RegisteredTool {
  return {
    definition: {
      name: 'forget',
      description: 'Remove a durable memory fact by key when it is wrong or no longer needed.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Memory key to delete' },
        },
        required: ['key'],
      },
    },
    preflight(_args, ctx) {
      return ctx.bot ? null : 'forget requires an active Bot';
    },
    async execute(args, ctx) {
      const key = typeof args.key === 'string' ? args.key : '';
      await memory.deleteMemory(ctx.bot!.id, key, ctx.userId);
      return JSON.stringify({ ok: true, deleted: key });
    },
  };
}

export function createSaveSkillTool(memory: MemorySkillStore): RegisteredTool {
  return {
    definition: {
      name: 'save_skill',
      description:
        'Capture a reusable workflow as a skill (auto-improvement). Prefer after a successful multi-step run. Body must cover: (1) when to use, (2) inputs/access, (3) steps, (4) how to validate, (5) what to return, (6) what requires approval.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Skill title, e.g. weekly-table-health or Weekly account health' },
          body: {
            type: 'string',
            description:
              'Markdown skill: When to use; Required inputs and access; Sequence of work; How to validate; What to return; What requires approval',
          },
        },
        required: ['name', 'body'],
      },
    },
    preflight(_args, ctx) {
      return ctx.bot ? null : 'save_skill requires an active Bot';
    },
    async execute(args, ctx) {
      const name = typeof args.name === 'string' ? args.name : '';
      const body = typeof args.body === 'string' ? args.body : '';
      const skill = await memory.upsertSkill(ctx.bot!.id, name, body);
      return JSON.stringify({ ok: true, name: skill.name, id: skill.id });
    },
  };
}

export function createMemorySkillTools(memory: MemorySkillStore): RegisteredTool[] {
  return [createRememberTool(memory), createForgetTool(memory), createSaveSkillTool(memory)];
}
