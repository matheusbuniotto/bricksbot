import { parseArtifactPinNotice } from '../../shared/chat/artifact-pin-notice.js';
import { parseBotCreatedNotice } from '../../shared/chat/bot-created-notice.js';
import {
  parseChoiceAnswerNotice,
  parseChoicePromptNotice,
  serializeChoiceAnswerNotice,
  serializeChoicePromptNotice,
  type PendingChoice,
} from '../../shared/chat/choice-notice.js';
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
} from '../../shared/agents/capability-catalog.js';
import { mergeEffectiveSkills } from '../../shared/agents/effective-skills.js';
import { isDefaultMetaTool } from '../../shared/agents/meta-tools.js';
import { toolLabel } from '../../shared/agents/tool-labels.js';
import type {
  ApprovalDecision,
  ApprovalRequest,
  ChatClient,
  LlmMessage,
  ToolCall,
  ToolDefinition,
} from '../../shared/agents/types.js';
import type { MemorySkillStore } from '../../shared/agents/memory/types.js';
import type { RoutineStore } from '../../shared/routines/types.js';
import {
  createHandoffTool,
  HANDOFF_TOOL_NAME,
  planHandoff,
  type HandoffTurnContext,
} from '../agents/handoff.js';
import { applyCompactionToHistory, runCompaction, shouldCompact } from '../durable/compaction.js';
import {
  CREATE_BOT_TOOL_NAME,
  createCreateBotTool,
} from '../agents/tools/create-bot.js';
import { createLakehouseCatalogTool } from '../agents/tools/lakehouse-catalog.js';
import { createMemorySkillTools } from '../agents/tools/memory-tools.js';
import { createPiSkillTools } from '../agents/tools/pi-skills-tools.js';
import { createSqlQueryTool, type SqlQueryToolOptions } from '../agents/tools/sql-query.js';
import { createVolumeReadTool, type VolumeReadToolOptions } from '../agents/tools/volume-read.js';
import { createPinArtifactTool } from '../agents/tools/pin-artifact.js';
import { createPinChartTool } from '../agents/tools/pin-chart.js';
import { ASK_CHOICE_TOOL_NAME, createAskChoiceTool, planAskChoice } from '../agents/tools/ask-choice.js';
import {
  createRoutineTools,
  DELETE_ROUTINE_TOOL_NAME,
  isAutoRoutineTool,
} from '../agents/tools/routine-tools.js';
import {
  createSandboxTools,
  isAskFirstSandboxTool,
  isAutoSandboxTool,
  SANDBOX_DELETE_TOOL_NAME,
} from '../agents/tools/sandbox-tools.js';
import { createWebFetchTool } from '../agents/tools/web-fetch.js';
import { formatBotContext } from '../agents/memory/context.js';
import { MemoryMemorySkillStore } from '../agents/memory/memory-store.js';
import { MemoryRoutineStore } from '../routines/memory-store.js';
import type { ArtifactSyncService } from '../sandbox/artifact-sync.js';
import type { SandboxSessionService } from '../sandbox/session-service.js';
import { ApprovalStore } from './approvals.js';
import { ChoiceStore } from './choices.js';

/** Never persist “Always allow” for these tools. */
function requiresAlwaysAsk(toolName: string): boolean {
  return (
    toolName === CREATE_BOT_TOOL_NAME ||
    toolName === ASK_CHOICE_TOOL_NAME ||
    toolName === DELETE_ROUTINE_TOOL_NAME ||
    toolName === SANDBOX_DELETE_TOOL_NAME
  );
}

export interface ChatServiceOptions {
  store: ChatStore;
  client: ChatClient;
  approvals?: ApprovalStore;
  choices?: ChoiceStore;
  webFetchAllowlist?: string[];
  sqlQuery?: SqlQueryToolOptions;
  lakehouseCatalog?: SqlQueryToolOptions;
  volumeRead?: VolumeReadToolOptions;
  /** Defaults to an in-memory store so meta tools stay on for every bot. */
  memory?: MemorySkillStore;
  /** Defaults to in-memory so schedule_routine works in tests/local without Lakebase. */
  routines?: RoutineStore;
  compaction?: CompactionStore;
  compactionSettings?: CompactionSettings;
  idempotency?: IdempotencyStore;
  /** Optional Phase 5 sandbox execution service (tools registered only when enabled). */
  sandbox?: SandboxSessionService;
  sandboxArtifactSync?: ArtifactSyncService;
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

    // Handoff / bot-created chips are UI-only; tool results already carry facts to the model.
    if (
      message.role === 'system' &&
      (parseHandoffNotice(message.content) ||
        parseBotCreatedNotice(message.content) ||
        parseArtifactPinNotice(message.content) ||
        parseChoicePromptNotice(message.content) ||
        parseChoiceAnswerNotice(message.content))
    ) {
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
  pendingChoices?: PendingChoice[];
  autoApprovedTools?: string[];
  provider: ChatClient['provider'];
}

export class ChatService {
  private readonly approvals: ApprovalStore;
  private readonly choices: ChoiceStore;
  private readonly tools: RegisteredTool[];
  private readonly compactionSettings: CompactionSettings;
  private readonly memory: MemorySkillStore;

  constructor(private readonly options: ChatServiceOptions) {
    this.approvals = options.approvals ?? new ApprovalStore();
    this.choices = options.choices ?? new ChoiceStore();
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
    tools.push(createCreateBotTool(options.store, this.memory));
    tools.push(...createMemorySkillTools(this.memory));
    tools.push(...createPiSkillTools(this.memory));
    tools.push(createPinArtifactTool(options.store));
    tools.push(createPinChartTool(options.store));
    tools.push(createAskChoiceTool());
    tools.push(
      ...createRoutineTools(options.routines ?? new MemoryRoutineStore(), options.store),
    );
    if (options.sandbox?.isEnabled()) {
      tools.push(
        ...createSandboxTools({
          sessionService: options.sandbox,
          chatStore: options.store,
          artifactSync: options.sandboxArtifactSync,
          host: sqlOptions.host,
          getToken: sqlOptions.getToken,
        }),
      );
    }
    this.tools = tools;
  }

  getApprovals(): ApprovalStore {
    return this.approvals;
  }

  getChoices(): ChoiceStore {
    return this.choices;
  }

  getSandbox(): SandboxSessionService | undefined {
    return this.options.sandbox;
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
    const pending = await this.approvals.get(approvalId);
    // create_bot never persists “all the time” — coerce to once.
    const effectiveDecision: ApprovalDecision =
      decision === 'all_the_time' && pending && requiresAlwaysAsk(pending.toolCall.name)
        ? 'once'
        : decision;
    const isDenial = effectiveDecision === 'denied' || effectiveDecision === 'not_approved';
    const approval = await this.approvals.decide(approvalId, effectiveDecision);
    const chatId = approval.chatId;

    if (isDenial) {
      await this.options.store.addMessage(
        chatId,
        'tool',
        JSON.stringify({ error: 'User denied tool call', tool: approval.toolCall.name }),
        { toolCallId: approval.toolCall.id },
      );
    } else if (approval.toolCall.name === ASK_CHOICE_TOOL_NAME) {
      const botId = await this.options.store.findBotIdForChat(chatId);
      const bot = botId ? await this.options.store.getBot(botId) : null;
      const error = await this.beginPendingChoice(chatId, approval.toolCall, bot);
      if (error) {
        await this.options.store.addMessage(
          chatId,
          'tool',
          JSON.stringify({ error, tool: approval.toolCall.name }),
          { toolCallId: approval.toolCall.id },
        );
      }
    } else {
      const botId = await this.options.store.findBotIdForChat(chatId);
      const bot = botId ? await this.options.store.getBot(botId) : null;
      if (botId) {
        await this.options.store.setBotPresence(botId, 'working');
      }
      const toolResult = await this.executeTool(approval.toolCall, { chatId, bot });
      await this.options.store.addMessage(chatId, 'tool', toolResult, {
        toolCallId: approval.toolCall.id,
      });
    }

    // OpenAI requires every tool_call id from the assistant turn to have a tool
    // result before the next completion — wait if siblings are still pending.
    const stillPending = await this.approvals.listPending(chatId);
    const pendingChoices = await this.choices.listPending(chatId);
    if (stillPending.length > 0 || pendingChoices.length > 0) {
      const botId = await this.options.store.findBotIdForChat(chatId);
      await this.syncBotPresenceAfterTurn(chatId, botId);
      const history = await this.options.store.listMessages(chatId);
      const lastAssistant = [...history].reverse().find((m) => m.role === 'assistant') ?? null;
      return {
        user: [...history].reverse().find((m) => m.role === 'user')!,
        assistant: lastAssistant,
        pendingApprovals: stillPending,
        pendingChoices,
        autoApprovedTools: await this.approvals.listAutoApproved(chatId),
        provider: this.options.client.provider,
      };
    }

    return this.continueTurn(chatId);
  }

  async submitChoice(choiceId: string, selectedOption: string): Promise<SendMessageResult> {
    const trimmed = selectedOption.trim();
    if (!trimmed) {
      throw new Error('selectedOption is required');
    }

    const pending = this.choices.get(choiceId);
    if (!pending) {
      throw new Error('Choice not found');
    }

    const answered = this.choices.answer(choiceId, trimmed);
    const chatId = answered.chatId;

    await this.options.store.addMessage(
      chatId,
      'system',
      serializeChoiceAnswerNotice({
        kind: 'choice_answer',
        choiceId: answered.id,
        prompt: answered.prompt,
        selectedOption: trimmed,
      }),
    );

    await this.options.store.addMessage(
      chatId,
      'tool',
      JSON.stringify({ ok: true, selected: trimmed, tool: ASK_CHOICE_TOOL_NAME }),
      { toolCallId: answered.toolCallId },
    );

    const stillPendingApprovals = await this.approvals.listPending(chatId);
    const pendingChoices = await this.choices.listPending(chatId);
    if (stillPendingApprovals.length > 0 || pendingChoices.length > 0) {
      const botId = await this.options.store.findBotIdForChat(chatId);
      await this.syncBotPresenceAfterTurn(chatId, botId);
      const history = await this.options.store.listMessages(chatId);
      const lastAssistant = [...history].reverse().find((m) => m.role === 'assistant') ?? null;
      return {
        user: [...history].reverse().find((m) => m.role === 'user')!,
        assistant: lastAssistant,
        pendingApprovals: stillPendingApprovals,
        pendingChoices,
        autoApprovedTools: await this.approvals.listAutoApproved(chatId),
        provider: this.options.client.provider,
      };
    }

    return this.continueTurn(chatId);
  }

  /** After approval: post choice_prompt system row and keep the turn open. */
  private async beginPendingChoice(
    chatId: string,
    toolCall: ToolCall,
    bot: Bot | null,
  ): Promise<string | null> {
    const planned = planAskChoice(toolCall.arguments);
    if (!planned.ok) return planned.error;
    if (!bot) return 'ask_choice requires an active Bot';

    const pending = this.choices.create({
      chatId,
      toolCallId: toolCall.id,
      prompt: planned.prompt,
      options: planned.options,
    });

    await this.options.store.addMessage(
      chatId,
      'system',
      serializeChoicePromptNotice({
        kind: 'choice_prompt',
        id: pending.id,
        toolCallId: toolCall.id,
        prompt: planned.prompt,
        options: planned.options,
      }),
    );

    return null;
  }

  /** After a turn stops: waiting (approvals) or blocked (user choice) or online. */
  private async syncBotPresenceAfterTurn(chatId: string, botId: string | null): Promise<void> {
    if (!botId) return;
    const [pendingApprovals, pendingChoices] = await Promise.all([
      this.approvals.listPending(chatId),
      this.choices.listPending(chatId),
    ]);
    const presence =
      pendingApprovals.length > 0
        ? 'waiting'
        : pendingChoices.length > 0
          ? 'blocked'
          : 'online';
    await this.options.store.setBotPresence(botId, presence);
  }

  private async pauseSnapshot(chatId: string): Promise<{
    pendingApprovals: ApprovalRequest[];
    pendingChoices: PendingChoice[];
    autoApprovedTools: string[];
  }> {
    const [pendingApprovals, pendingChoices, autoApprovedTools] = await Promise.all([
      this.approvals.listPending(chatId),
      this.choices.listPending(chatId),
      this.approvals.listAutoApproved(chatId),
    ]);
    return { pendingApprovals, pendingChoices, autoApprovedTools };
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
      const pause = await this.pauseSnapshot(chatId);
      return {
        user: user ?? history.find((m) => m.role === 'user')!,
        assistant,
        ...pause,
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
          // create_bot / sandbox_delete / ask_choice always Ask-first.
          // Default meta + sandbox_stop never Ask-first.
          // Handoff autoApproveAll still requires Ask-first for sandbox exec/upload/download/artifact.
          if (
            !requiresAlwaysAsk(toolCall.name) &&
            (isDefaultMetaTool(toolCall.name) ||
              isAutoRoutineTool(toolCall.name) ||
              isAutoSandboxTool(toolCall.name) ||
              (await this.approvals.isAutoApproved(chatId, toolCall.name)) ||
              (opts.autoApproveAll && !isAskFirstSandboxTool(toolCall.name)))
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
          const pause = await this.pauseSnapshot(chatId);
          return {
            user: user ?? history.find((m) => m.role === 'user')!,
            assistant,
            pendingApprovals,
            pendingChoices: pause.pendingChoices,
            autoApprovedTools: pause.autoApprovedTools,
            provider: this.options.client.provider,
          };
        }

        const openChoices = await this.choices.listPending(chatId);
        if (openChoices.length > 0) {
          const pause = await this.pauseSnapshot(chatId);
          return {
            user: user ?? history.find((m) => m.role === 'user')!,
            assistant,
            ...pause,
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

      const pause = await this.pauseSnapshot(chatId);
      return {
        user: user ?? [...history].reverse().find((m) => m.role === 'user')!,
        assistant,
        ...pause,
        provider: this.options.client.provider,
      };
    } finally {
      await this.syncBotPresenceAfterTurn(chatId, botId);
    }
  }

  /**
   * Every bot gets lakehouse tools + default meta tools.
   * `handoff_to_bot` and `create_bot` are Primary-gated.
   */
  private toolsFor(bot: Bot | null): ToolDefinition[] {
    const primaryOnly = new Set([HANDOFF_TOOL_NAME, CREATE_BOT_TOOL_NAME]);
    return this.tools
      .filter((tool) => !primaryOnly.has(tool.definition.name) || Boolean(bot?.isPrimary))
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
    let botSkills: Awaited<ReturnType<MemorySkillStore['listSkills']>> = [];
    if (bot) {
      [memories, botSkills] = await Promise.all([
        this.memory.listMemories(bot.id),
        this.memory.listSkills(bot.id),
      ]);
    }

    const skills = bot ? mergeEffectiveSkills(bot.id, botSkills) : [];

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
