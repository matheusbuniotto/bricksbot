import { serializeBotCreatedNotice } from '../../../shared/chat/bot-created-notice.js';
import type { Bot, ChatStore } from '../../../shared/chat/types.js';
import type { MemorySkillStore } from '../../../shared/agents/memory/types.js';
import type { ToolDefinition } from '../../../shared/agents/types.js';
import type { HandoffTurnContext } from '../handoff.js';

export const CREATE_BOT_TOOL_NAME = 'create_bot';

/** Soft roster cap — mirrors Grok’s practical ~50 Bots guidance. */
export const MAX_ACTIVE_BOTS_PER_OWNER = 50;

export const createBotToolDefinition: ToolDefinition = {
  name: CREATE_BOT_TOOL_NAME,
  description:
    'Create a new teammate bot in this Space. Primary bot only. Always requires user approval (never auto-approved). ' +
    'Use when a job needs a long-lived owner and no existing teammate fits. Prefer handoff_to_bot otherwise. ' +
    'Ask the user before creating several bots.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      name: { type: 'string', description: 'Short display name for the new bot' },
      job: {
        type: 'string',
        description:
          'Operational job remembered on the new bot. Include: goal/ownership, sources/tools, working style, and approval boundary (what never runs without the user). Avoid vague labels like “General Helper”.',
      },
      space_id: {
        type: 'string',
        description: 'Section/space id. Omit to place the bot in the Primary bot’s Space.',
      },
      section_name: {
        type: 'string',
        description: 'Section name to place the bot in. Ignored when space_id is set.',
      },
      avatar_label: {
        type: 'string',
        description:
          'Optional brick avatar encoding as shape.color.hat.glasses (e.g. "1.7.0.0"); omit for a name-derived look',
      },
    },
    required: ['name'],
  },
};

export interface CreateBotPlan {
  creator: Bot;
  name: string;
  job: string;
  spaceId: string | null;
  avatarLabel?: string;
}

type Planned = { ok: true; plan: CreateBotPlan } | { ok: false; error: string };

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export async function planCreateBot(
  store: ChatStore,
  creator: Bot | null,
  args: Record<string, unknown>,
): Promise<Planned> {
  if (!creator?.isPrimary) {
    return { ok: false, error: 'Only the Primary bot can create bots. Ask the user to have Primary create one.' };
  }

  const name = readText(args.name);
  if (!name) {
    return { ok: false, error: 'create_bot requires a name' };
  }

  const job = readText(args.job);
  const avatarLabel = readText(args.avatar_label) || undefined;
  const spaceIdArg = readText(args.space_id);
  const sectionName = readText(args.section_name);

  let spaceId: string | null = creator.spaceId;
  if (spaceIdArg) {
    const space = await store.getSpace(spaceIdArg);
    if (!space || space.ownerId !== creator.ownerId) {
      return { ok: false, error: `create_bot could not find section ${spaceIdArg}` };
    }
    spaceId = space.id;
  } else if (sectionName) {
    const spaces = await store.listSpaces(creator.ownerId);
    const needle = sectionName.toLowerCase();
    const matches = spaces.filter((space) => space.name.toLowerCase() === needle);
    if (matches.length === 0) {
      return { ok: false, error: `create_bot could not find a section named ${sectionName}` };
    }
    if (matches.length > 1) {
      return { ok: false, error: `create_bot found more than one section named ${sectionName}` };
    }
    spaceId = matches[0]!.id;
  }

  const active = await store.listBots({ ownerId: creator.ownerId, archived: 'active' });
  if (active.length >= MAX_ACTIVE_BOTS_PER_OWNER) {
    return {
      ok: false,
      error: `create_bot refused: roster already has ${active.length} active bots (max ${MAX_ACTIVE_BOTS_PER_OWNER})`,
    };
  }

  return {
    ok: true,
    plan: { creator, name, job, spaceId, avatarLabel },
  };
}

function greetingFor(name: string, job: string): string {
  if (job) {
    return `Hi — I'm ${name}. My job: ${job}. Ask me to remember more anytime, then give me a first task.`;
  }
  return `Hi — I'm ${name}. Tell me my job, sources, and approval boundaries, then give me a first task.`;
}

export async function executeCreateBot(
  store: ChatStore,
  memory: MemorySkillStore,
  creator: Bot | null,
  sourceChatId: string,
  args: Record<string, unknown>,
): Promise<string> {
  const planned = await planCreateBot(store, creator, args);
  if (!planned.ok) return planned.error;

  const { plan } = planned;
  const bot = await store.createBot({
    name: plan.name,
    ownerId: plan.creator.ownerId,
    spaceId: plan.spaceId,
    avatarLabel: plan.avatarLabel,
    description: plan.job || undefined,
  });

  const chat = await store.getOrCreateChatForBot(bot.id, plan.creator.ownerId);

  if (plan.job) {
    await memory.upsertMemory(bot.id, 'job', plan.job);
  }

  await store.addMessage(chat.id, 'assistant', greetingFor(bot.name, plan.job));

  await store.addMessage(
    sourceChatId,
    'system',
    serializeBotCreatedNotice({
      kind: 'bot_created',
      botId: bot.id,
      name: bot.name,
      chatId: chat.id,
      spaceId: bot.spaceId,
      job: plan.job || undefined,
      createdByBotId: plan.creator.id,
      createdByName: plan.creator.name,
    }),
  );

  return JSON.stringify({
    ok: true,
    tool: CREATE_BOT_TOOL_NAME,
    bot_id: bot.id,
    name: bot.name,
    chat_id: chat.id,
    space_id: bot.spaceId,
    job: plan.job || null,
    message: `Created bot ${bot.name}. It is on the roster; open it from the Created Bot chip when ready.`,
  });
}

export function createCreateBotTool(store: ChatStore, memory: MemorySkillStore) {
  return {
    definition: createBotToolDefinition,
    preflight(args: Record<string, unknown>, ctx: HandoffTurnContext): Promise<string | null> {
      return planCreateBot(store, ctx.bot, args).then((planned) => (planned.ok ? null : planned.error));
    },
    execute(args: Record<string, unknown>, ctx: HandoffTurnContext): Promise<string> {
      return executeCreateBot(store, memory, ctx.bot, ctx.chatId, args);
    },
  };
}
