import { handoffBriefUserLine, serializeHandoffNotice } from '../../shared/chat/handoff-notice.js';
import type { Bot, ChatStore } from '../../shared/chat/types.js';
import type { ToolDefinition } from '../../shared/agents/types.js';

export const HANDOFF_TOOL_NAME = 'handoff_to_bot';

export const handoffToolDefinition: ToolDefinition = {
  name: HANDOFF_TOOL_NAME,
  description:
    'Hand one brief to another bot in this Space. Primary bot only. Requires user approval. The teammate runs one turn and their reply is returned to you — summarize it for the user.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      bot_id: { type: 'string', description: 'Target bot id from the teammate list' },
      bot_name: {
        type: 'string',
        description: 'Target bot name in this Space. Omit when bot_id is set.',
      },
      brief: { type: 'string', description: 'What the other bot should take on' },
    },
    required: ['brief'],
  },
};

export interface HandoffTurnContext {
  chatId: string;
  bot: Bot | null;
  /** Signed-in caller. Volume paths use this, never the bot owner. */
  userId?: string;
  /** Set on routine-started turns so volume_write can refuse them. */
  routine?: boolean;
}

export interface HandoffPlan {
  sender: Bot;
  target: Bot;
  brief: string;
}

type Planned = { ok: true; plan: HandoffPlan } | { ok: false; error: string };

export function primaryRouterPrompt(teammates: Array<{ id: string; name: string }>): string {
  const list = teammates.length ? teammates.map((bot) => `${bot.name} (${bot.id})`).join(', ') : 'none';
  return (
    'You are the Primary bot. Use handoff_to_bot to hand one brief to a teammate in this Space. ' +
    'After they reply, summarize their answer for the user with sources when present. ' +
    'Use create_bot only when a job needs a durable owner and no teammate fits — it always needs approval. ' +
    `Teammates: ${list}. Only you may hand off or create bots, and only within this Space.`
  );
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export async function planHandoff(
  store: ChatStore,
  sender: Bot | null,
  args: Record<string, unknown>
): Promise<Planned> {
  if (!sender?.isPrimary) {
    return { ok: false, error: 'Only the Primary bot can hand off to another bot' };
  }

  const brief = readText(args.brief);
  if (!brief) {
    return { ok: false, error: 'handoff_to_bot requires a brief' };
  }

  const botId = readText(args.bot_id);
  const botName = readText(args.bot_name);
  if (!botId && !botName) {
    return { ok: false, error: 'handoff_to_bot requires bot_id or bot_name' };
  }
  if (botId && botName) {
    return { ok: false, error: 'handoff_to_bot accepts bot_id or bot_name, not both' };
  }

  if (!sender.spaceId) {
    return { ok: false, error: 'handoff_to_bot only reaches bots in your Space' };
  }

  const space = await store.getSpace(sender.spaceId);
  if (!space) {
    return { ok: false, error: 'handoff_to_bot only reaches bots in your Space' };
  }

  const members = await store.listSpaceMembers(sender.spaceId);
  const membership = members.find((member) => member.userId === sender.ownerId);
  const canHandOff = space.ownerId === sender.ownerId || membership?.role === 'admin' || membership?.role === 'member';
  if (!canHandOff) {
    return { ok: false, error: 'handoff_to_bot requires Space membership' };
  }

  const target = botId ? await store.getBot(botId) : await findTeammateByName(store, sender, botName);
  if (!target) {
    return {
      ok: false,
      error: botId
        ? `handoff_to_bot could not find bot ${botId}`
        : `handoff_to_bot could not find a bot named ${botName} in your Space`,
    };
  }
  if (target === 'ambiguous') {
    return { ok: false, error: `handoff_to_bot found more than one bot named ${botName}` };
  }
  if (target.id === sender.id) {
    return { ok: false, error: 'handoff_to_bot cannot target the Primary bot itself' };
  }
  if (target.spaceId !== sender.spaceId) {
    return { ok: false, error: 'handoff_to_bot only reaches bots in your Space' };
  }

  return { ok: true, plan: { sender, target, brief } };
}

async function findTeammateByName(store: ChatStore, sender: Bot, botName: string): Promise<Bot | 'ambiguous' | null> {
  const roster = await store.listBots({ spaceId: sender.spaceId, ownerId: sender.ownerId });
  const needle = botName.toLowerCase();
  const matches = roster.filter((bot) => bot.name.toLowerCase() === needle);
  if (matches.length > 1) return 'ambiguous';
  return matches[0] ?? null;
}

/**
 * Records the brief on the target bot and a notice on the source chat.
 * Does not start a model turn for the target.
 */
export async function deliverHandoff(
  store: ChatStore,
  sender: Bot | null,
  sourceChatId: string,
  args: Record<string, unknown>
): Promise<string> {
  const planned = await planHandoff(store, sender, args);
  if (!planned.ok) return planned.error;

  const { target, brief } = planned.plan;
  const from = planned.plan.sender;
  const targetChat = await store.getOrCreateChatForBot(target.id, from.ownerId);
  await store.addMessage(targetChat.id, 'user', handoffBriefUserLine(from.name, brief));

  const notice = serializeHandoffNotice({
    kind: 'handoff',
    direction: 'sent',
    targetBotId: target.id,
    targetName: target.name,
    targetChatId: targetChat.id,
    senderBotId: from.id,
    senderName: from.name,
    brief,
    threadBotId: target.id,
  });
  await store.addMessage(sourceChatId, 'system', notice);
  // Short result for the model; UI renders the structured system notice.
  return `Handed off to ${target.name}.`;
}

export function createHandoffTool(store: ChatStore) {
  return {
    definition: handoffToolDefinition,
    preflight(args: Record<string, unknown>, ctx: HandoffTurnContext): Promise<string | null> {
      return planHandoff(store, ctx.bot, args).then((planned) => (planned.ok ? null : planned.error));
    },
    execute(args: Record<string, unknown>, ctx: HandoffTurnContext): Promise<string> {
      return deliverHandoff(store, ctx.bot, ctx.chatId, args);
    },
  };
}
