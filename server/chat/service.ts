import {
  handoffBriefUserLine,
  parseHandoffNotice,
  serializeHandoffNotice,
} from '../../shared/chat/handoff-notice.js';
import type { Bot, ChatStore, Message } from '../../shared/chat/types.js';
import type { CompactionSettings, CompactionStore, IdempotencyStore } from '../../shared/durable/types.js';
import { DEFAULT_COMPACTION_SETTINGS } from '../../shared/durable/types.js';
import {
  buildCapabilityCatalog,
  formatCapabilityPrompt,
} from '../../shared/llm/capability-catalog.js';
import { isDefaultMetaTool } from '../../shared/llm/meta-tools.js';
import { toolLabel } from '../../shared/llm/tool-labels.js';
import type {
  ApprovalDecision,
  ApprovalRequest,
  ChatClient,
  LlmMessage,
  ToolCall,
  ToolDefinition,
} from '../../shared/llm/types.js';
import type { MemorySkillStore } from '../../shared/memory/types.js';
import {
  createHandoffTool,
  HANDOFF_TOOL_NAME,
  planHandoff,
  type HandoffTurnContext,
} from '../bots/handoff.js';
import { applyCompactionToHistory, runCompaction, shouldCompact } from '../durable/compaction.js';
import { createLakehouseCatalogTool } from '../llm/tools/lakehouse-catalog.js';
import { createMemorySkillTools } from '../llm/tools/memory-tools.js';
import { createPiSkillTools } from '../llm/tools/pi-skills-tools.js';
import { createSqlQueryTool, type SqlQueryToolOptions } from '../llm/tools/sql-query.js';
import { createVolumeReadTool, type VolumeReadToolOptions } from '../llm/tools/volume-read.js';
import { createWebFetchTool } from '../llm/tools/web-fetch.js';
import { formatBotContext } from '../memory/context.js';
import { MemoryMemorySkillStore } from '../memory/memory-store.js';
import { ApprovalStore } from './approvals.js';

export interface ChatServiceOptions {
  store: ChatStore;
  client: ChatClient;
  approvals?: ApprovalStore;
  webFetchAllowlist?: string[];
  sqlQuery?: SqlQueryToolOptions;
  lakehouseCatalog?: SqlQueryToolOptions;
  volumeRead?: VolumeReadToolOptions;
  /** Defaults to an in-memory store so meta tools stay on for every bot. */
  memory?: MemorySkillStore;
  compaction?: CompactionStore;
  compactionSettings?: CompactionSettings;
  idempotency?: IdempotencyStore;
}

type RegisteredTool = {
  definition: ToolDefinition;
  preflight?: (args: Record<string, unknown>, ctx: HandoffTurnContext) => string | null | Promise<string | null>;
  execute(args: Record<string, unknown>, ctx: HandoffTurnContext): Promise<string>;
};

/**
 * Build OpenAI-compatible history: every tool result must pair with a prior
 * assistant tool_calls entry. Drops orphan tool rows from older chats.
 */
function toLlmHistory(history: Message[]): LlmMessage[] {
  const declaredIds = new Set<string>();
  const out: LlmMessage[] = [];

  for (const message of history) {
    if (message.role === 'assistant' && message.toolCalls?.length) {
      for (const call of message.toolCalls) {
        declaredIds.add(call.id);
      }
      out.push({
        role: 'assistant',
        content: message.content,
        toolCalls: message.toolCalls,
      });
      continue;
    }

    if (message.role === 'tool') {
      if (!message.toolCallId || !declaredIds.has(message.toolCallId)) {
        continue;
      }
      out.push({
        role: 'tool',
        content: message.content,
        toolCallId: message.toolCallId,
      });
      continue;
    }

    // Handoff chips are UI-only; the tool result already carries the reply to the model.
    if (message.role === 'system' && parseHandoffNotice(message.content)) {
      continue;
    }

    out.push({ role: message.role as LlmMessage['role'], content: message.content });
  }

  return out;
}

type ContinueTurnOptions = {
  /** Nested teammate turns from handoff auto-run tools without extra approvals. */
  autoApproveAll?: boolean;
};

export interface SendMessageResult {
  user: Message;
  assistant: Message | null;
  pendingApprovals: ApprovalRequest[];
  autoApprovedTools?: string[];
  provider: ChatClient['provider'];
}

export class ChatService {
  private readonly approvals: ApprovalStore;
  private readonly tools: RegisteredTool[];
  private readonly compactionSettings: CompactionSettings;
  private readonly memory: MemorySkillStore;

  constructor(private readonly options: ChatServiceOptions) {
    this.approvals = options.approvals ?? new ApprovalStore();
    this.compactionSettings = options.compactionSettings ?? DEFAULT_COMPACTION_SETTINGS;
    // Meta tools (remember / skills / list_memories) are default for every bot.
    this.memory = options.memory ?? new MemoryMemorySkillStore();
    const allowlist = options.webFetchAllowlist ?? [];
    const tools: RegisteredTool[] = [];
    if (allowlist.length > 0) {
      tools.push(createWebFetchTool({ allowlist }));
    }
    const sqlOptions = options.sqlQuery ?? {};
    tools.push(createSqlQueryTool(sqlOptions));
    tools.push(createLakehouseCatalogTool(options.lakehouseCatalog ?? sqlOptions));
    tools.push(
      createVolumeReadTool(
        options.volumeRead ?? {
          host: sqlOptions.host,
          getToken: sqlOptions.getToken,
        },
      ),
    );
    tools.push(createHandoffTool(options.store));
    tools.push(...createMemorySkillTools(this.memory));
    tools.push(...createPiSkillTools(this.memory));
    this.tools = tools;
  }

  getApprovals(): ApprovalStore {
    return this.approvals;
  }

  async sendUserMessage(
    chatId: string,
    content: string,
    options?: { requestId?: string },
  ): Promise<SendMessageResult> {
    const trimmed = content.trim();
    if (!trimmed) {
      throw new Error('Message content is required');
    }

    const requestId = options?.requestId?.trim();
    if (requestId && this.options.idempotency) {
      const existing = await this.options.idempotency.get(requestId);
      if (existing) {
        return JSON.parse(existing.resultJson) as SendMessageResult;
      }
    }

    const user = await this.options.store.addMessage(chatId, 'user', trimmed);
    const result = await this.continueTurn(chatId, user);

    if (requestId && this.options.idempotency) {
      await this.options.idempotency.put(requestId, chatId, JSON.stringify(result));
    }
    return result;
  }

  async decideApproval(approvalId: string, decision: ApprovalDecision): Promise<SendMessageResult> {
    const isDenial = decision === 'denied' || decision === 'not_approved';
    const approval = await this.approvals.decide(approvalId, decision);
    const chatId = approval.chatId;

    if (isDenial) {
      await this.options.store.addMessage(
        chatId,
        'tool',
        JSON.stringify({ error: 'User denied tool call', tool: approval.toolCall.name }),
        { toolCallId: approval.toolCall.id },
      );
    } else {
      const botId = await this.options.store.findBotIdForChat(chatId);
      const bot = botId ? await this.options.store.getBot(botId) : null;
      const toolResult = await this.executeTool(approval.toolCall, { chatId, bot });
      await this.options.store.addMessage(chatId, 'tool', toolResult, {
        toolCallId: approval.toolCall.id,
      });
    }

    // OpenAI requires every tool_call id from the assistant turn to have a tool
    // result before the next completion — wait if siblings are still pending.
    const stillPending = await this.approvals.listPending(chatId);
    if (stillPending.length > 0) {
      const history = await this.options.store.listMessages(chatId);
      const lastAssistant = [...history].reverse().find((m) => m.role === 'assistant') ?? null;
      return {
        user: [...history].reverse().find((m) => m.role === 'user')!,
        assistant: lastAssistant,
        pendingApprovals: stillPending,
        autoApprovedTools: await this.approvals.listAutoApproved(chatId),
        provider: this.options.client.provider,
      };
    }

    return this.continueTurn(chatId);
  }

  private async continueTurn(
    chatId: string,
    user?: Message,
    depth: number = 0,
    opts: ContinueTurnOptions = {},
  ): Promise<SendMessageResult> {
    if (depth > 8) {
      const assistant = await this.options.store.addMessage(
        chatId,
        'assistant',
        'Reached maximum tool execution steps for this turn.',
      );
      const history = await this.options.store.listMessages(chatId);
      return {
        user: user ?? history.find((m) => m.role === 'user')!,
        assistant,
        pendingApprovals: await this.approvals.listPending(chatId),
        autoApprovedTools: await this.approvals.listAutoApproved(chatId),
        provider: this.options.client.provider,
      };
    }

    const botId = await this.options.store.findBotIdForChat(chatId);
    const bot = botId ? await this.options.store.getBot(botId) : null;
    if (botId) {
      await this.options.store.setBotPresence(botId, 'thinking');
    }

    try {
      let history = await this.options.store.listMessages(chatId);
      const systemPrompt = await this.systemPromptFor(bot);

      if (this.options.compaction && shouldCompact(history, systemPrompt, this.compactionSettings)) {
        await runCompaction({
          chatId,
          history,
          client: this.options.client,
          store: this.options.compaction,
          settings: this.compactionSettings,
        });
        history = await this.options.store.listMessages(chatId);
      }

      const compaction = this.options.compaction
        ? await this.options.compaction.getLatest(chatId)
        : null;
      const { messages: windowed, summarySystem } = applyCompactionToHistory(history, compaction);

      const llmMessages: LlmMessage[] = [
        { role: 'system', content: systemPrompt },
        ...(summarySystem ? [{ role: 'system' as const, content: summarySystem }] : []),
        ...toLlmHistory(windowed),
      ];

      const tools = this.toolsFor(bot);
      if (botId) {
        await this.options.store.setBotPresence(botId, 'working');
      }
      const completion = await this.options.client.complete({ messages: llmMessages, tools });

      if (completion.toolCalls.length > 0) {
        const needsApproval: ToolCall[] = [];
        const toAutoExecute: ToolCall[] = [];
        const refusals: Array<{ toolCall: ToolCall; reason: string }> = [];

        for (const toolCall of completion.toolCalls) {
          const refusal = await this.refusalFor(toolCall, { chatId, bot });
          if (refusal) {
            refusals.push({ toolCall, reason: refusal });
            continue;
          }
          // Default meta tools are local durable state — never Ask-first, every bot.
          if (
            opts.autoApproveAll ||
            isDefaultMetaTool(toolCall.name) ||
            (await this.approvals.isAutoApproved(chatId, toolCall.name))
          ) {
            toAutoExecute.push(toolCall);
          } else {
            needsApproval.push(toolCall);
          }
        }

        const assistantContent =
          completion.content?.trim() ||
          (needsApproval.length > 0
            ? `Waiting for your approval: ${needsApproval
                .map((call) => toolLabel(call.name))
                .join(', ')}.`
            : '');

        // Persist the assistant tool_calls before any tool results so replay is valid.
        const assistant = await this.options.store.addMessage(chatId, 'assistant', assistantContent, {
          toolCalls: completion.toolCalls,
        });

        for (const { toolCall, reason } of refusals) {
          await this.options.store.addMessage(
            chatId,
            'tool',
            JSON.stringify({ error: reason, tool: toolCall.name }),
            { toolCallId: toolCall.id },
          );
        }

        for (const toolCall of toAutoExecute) {
          const toolResult = await this.executeTool(toolCall, { chatId, bot });
          await this.options.store.addMessage(chatId, 'tool', toolResult, {
            toolCallId: toolCall.id,
          });
        }

        if (needsApproval.length > 0) {
          const pendingApprovals = await Promise.all(
            needsApproval.map((toolCall) => this.approvals.create(chatId, toolCall)),
          );
          return {
            user: user ?? history.find((m) => m.role === 'user')!,
            assistant,
            pendingApprovals,
            autoApprovedTools: await this.approvals.listAutoApproved(chatId),
            provider: this.options.client.provider,
          };
        }

        return this.continueTurn(chatId, user, depth + 1, opts);
      }

      const assistant = await this.options.store.addMessage(
        chatId,
        'assistant',
        completion.content?.trim() || '(empty model response)',
      );

      return {
        user: user ?? [...history].reverse().find((m) => m.role === 'user')!,
        assistant,
        pendingApprovals: await this.approvals.listPending(chatId),
        autoApprovedTools: await this.approvals.listAutoApproved(chatId),
        provider: this.options.client.provider,
      };
    } finally {
      if (botId) {
        await this.options.store.setBotPresence(botId, 'online');
      }
    }
  }

  /**
   * Every bot gets lakehouse tools + default meta tools.
   * Only `handoff_to_bot` is Primary-gated.
   */
  private toolsFor(bot: Bot | null): ToolDefinition[] {
    return this.tools
      .filter((tool) => tool.definition.name !== HANDOFF_TOOL_NAME || Boolean(bot?.isPrimary))
      .map((tool) => tool.definition);
  }

  private async systemPromptFor(bot: Bot | null): Promise<string> {
    const botName = bot?.name ?? 'Primary';
    const toolNames = this.toolsFor(bot).map((t) => t.name);

    let teammates: Array<{ id: string; name: string }> = [];
    if (bot?.isPrimary) {
      const roster = bot.spaceId
        ? await this.options.store.listBots({ spaceId: bot.spaceId, ownerId: bot.ownerId })
        : [];
      teammates = roster
        .filter((other) => other.id !== bot.id)
        .map((other) => ({ id: other.id, name: other.name }));
    }

    let memories: Awaited<ReturnType<MemorySkillStore['listMemories']>> = [];
    let skills: Awaited<ReturnType<MemorySkillStore['listSkills']>> = [];
    if (bot) {
      [memories, skills] = await Promise.all([
        this.memory.listMemories(bot.id),
        this.memory.listSkills(bot.id),
      ]);
    }

    const catalog = buildCapabilityCatalog({
      toolNames,
      isPrimary: Boolean(bot?.isPrimary),
      teammates,
      memoryKeys: memories.map((memory) => memory.key),
      skills,
    });

    const base = [
      `You are ${botName}, a durable BricksBot teammate for the Databricks lakehouse. Be concise.`,
      formatCapabilityPrompt(catalog),
    ].join('\n\n');

    // Memories keep values in-window; skills already appear as an index in Capabilities.
    const memorySection = formatBotContext(memories, []);
    return memorySection ? `${base}\n\n${memorySection}` : base;
  }

  private async refusalFor(toolCall: ToolCall, ctx: HandoffTurnContext): Promise<string | null> {
    return (await this.toolFor(toolCall.name)?.preflight?.(toolCall.arguments, ctx)) ?? null;
  }

  private toolFor(name: string): RegisteredTool | undefined {
    return this.tools.find((tool) => tool.definition.name === name);
  }

  private async executeTool(toolCall: ToolCall, ctx: HandoffTurnContext): Promise<string> {
    if (toolCall.name === HANDOFF_TOOL_NAME) {
      return this.executeHandoffRoundTrip(toolCall.arguments, ctx);
    }
    const tool = this.toolFor(toolCall.name);
    if (!tool) {
      if (toolCall.name === 'web_fetch') {
        throw new Error('web_fetch is not configured (empty allowlist)');
      }
      throw new Error(`Unknown tool: ${toolCall.name}`);
    }
    return tool.execute(toolCall.arguments, ctx);
  }

  /**
   * Deliver brief → run teammate one turn → post “N messages with …” on both chats
   * and return their reply so Primary can summarize.
   */
  private async executeHandoffRoundTrip(
    args: Record<string, unknown>,
    ctx: HandoffTurnContext,
  ): Promise<string> {
    const planned = await planHandoff(this.options.store, ctx.bot, args);
    if (!planned.ok) return planned.error;

    const { sender, target, brief } = planned.plan;
    const targetChat = await this.options.store.getOrCreateChatForBot(target.id);
    const sourceChatId = ctx.chatId;
    const briefLine = handoffBriefUserLine(sender.name, brief);

    await this.options.store.addMessage(targetChat.id, 'user', briefLine);

    await this.options.store.addMessage(
      sourceChatId,
      'system',
      serializeHandoffNotice({
        kind: 'handoff',
        direction: 'sent',
        targetBotId: target.id,
        targetName: target.name,
        targetChatId: targetChat.id,
        senderBotId: sender.id,
        senderName: sender.name,
        brief,
        threadBotId: target.id,
      }),
    );

    let reply: string;
    try {
      const nested = await this.continueTurn(targetChat.id, undefined, 0, { autoApproveAll: true });
      reply = nested.assistant?.content?.trim() || '(no reply)';
    } catch (err) {
      reply = `(handoff failed) ${err instanceof Error ? err.message : 'Unexpected error'}`;
      await this.options.store.addMessage(targetChat.id, 'assistant', reply);
    }

    const targetMessages = await this.options.store.listMessages(targetChat.id);
    let threadStart = -1;
    for (let i = targetMessages.length - 1; i >= 0; i -= 1) {
      const message = targetMessages[i]!;
      if (message.role === 'user' && message.content === briefLine) {
        threadStart = i;
        break;
      }
    }
    const threadSlice = threadStart >= 0 ? targetMessages.slice(threadStart) : targetMessages.slice(-4);
    const messageCount = threadSlice.filter(
      (message) => message.role === 'user' || message.role === 'assistant',
    ).length;

    const baseNotice = {
      kind: 'handoff' as const,
      brief,
      messageCount,
      replyPreview: reply.slice(0, 800),
      threadBotId: target.id,
    };

    // Primary side: peer is the teammate; peek loads teammate chat.
    await this.options.store.addMessage(
      sourceChatId,
      'system',
      serializeHandoffNotice({
        ...baseNotice,
        direction: 'thread',
        targetBotId: target.id,
        targetName: target.name,
        targetChatId: targetChat.id,
        senderBotId: sender.id,
        senderName: sender.name,
      }),
    );

    // Teammate side: peer is Primary; peek still loads teammate chat via threadBotId.
    await this.options.store.addMessage(
      targetChat.id,
      'system',
      serializeHandoffNotice({
        ...baseNotice,
        direction: 'thread',
        targetBotId: sender.id,
        targetName: sender.name,
        targetChatId: targetChat.id,
        senderBotId: target.id,
        senderName: target.name,
      }),
    );

    return `Handed off to ${target.name}. Their reply:\n${reply}`;
  }
}
