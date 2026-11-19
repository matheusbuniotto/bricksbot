import { parseArtifactPinNotice } from '../../shared/chat/artifact-pin-notice.js';
import { parseBotCreatedNotice } from '../../shared/chat/bot-created-notice.js';
import {
  parseChoiceAnswerNotice,
  parseChoicePromptNotice,
  serializeChoiceAnswerNotice,
  serializeChoicePromptNotice,
  type PendingChoice,
} from '../../shared/chat/choice-notice.js';
import { handoffBriefUserLine, parseHandoffNotice, serializeHandoffNotice } from '../../shared/chat/handoff-notice.js';
import type { Bot, Chat, ChatStore, Message } from '../../shared/chat/types.js';
import type { CompactionSettings, CompactionStore, IdempotencyStore } from '../../shared/durable/types.js';
import { DEFAULT_COMPACTION_SETTINGS } from '../../shared/durable/types.js';
import { buildCapabilityCatalog, formatCapabilityPrompt } from '../../shared/agents/capability-catalog.js';
import { mergeEffectiveSkills } from '../../shared/agents/effective-skills.js';
import { isDefaultMetaTool } from '../../shared/agents/meta-tools.js';
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
import { ActiveRunError, type Run, type RunContext, type RunStore } from '../../shared/runs/types.js';
import { createHandoffTool, HANDOFF_TOOL_NAME, planHandoff, type HandoffTurnContext } from '../agents/handoff.js';
import { applyCompactionToHistory, runCompaction, shouldCompact } from '../durable/compaction.js';
import { CREATE_BOT_TOOL_NAME, createCreateBotTool } from '../agents/tools/create-bot.js';
import { createLakehouseCatalogTool, lakehouseCatalogToolDefinition } from '../agents/tools/lakehouse-catalog.js';
import { createMemorySkillTools } from '../agents/tools/memory-tools.js';
import { createPiSkillTools } from '../agents/tools/pi-skills-tools.js';
import { createSqlQueryTool, sqlQueryToolDefinition, type SqlQueryToolOptions } from '../agents/tools/sql-query.js';
import {
  createVolumeReadTool,
  volumeReadToolDefinition,
  type VolumeReadToolOptions,
} from '../agents/tools/volume-read.js';
import {
  createVolumeWriteTool,
  isAskFirstVolumeWrite,
  VOLUME_WRITE_TOOL_NAME,
  type VolumeWriteToolOptions,
} from '../agents/tools/volume-write.js';
import { createPinArtifactTool } from '../agents/tools/pin-artifact.js';
import { createPinChartTool } from '../agents/tools/pin-chart.js';
import { ASK_CHOICE_TOOL_NAME, createAskChoiceTool, planAskChoice } from '../agents/tools/ask-choice.js';
import { createRoutineTools, DELETE_ROUTINE_TOOL_NAME, isAutoRoutineTool } from '../agents/tools/routine-tools.js';
import {
  createSandboxTools,
  isAskFirstSandboxTool,
  isAutoSandboxTool,
  SANDBOX_DELETE_TOOL_NAME,
} from '../agents/tools/sandbox-tools.js';
import { createWebFetchTool } from '../agents/tools/web-fetch.js';
import {
  createSystemAiMcpTools,
  GENIE_ASK_TOOL_NAME,
  GENIE_CANCEL_TOOL_NAME,
  GENIE_GET_QUERY_RESULT_TOOL_NAME,
  GENIE_POLL_TOOL_NAME,
} from '../agents/tools/system-ai-mcp.js';
import {
  createGenieSpaceTool,
  GENIE_SPACE_TOOL_NAME,
  type GenieSpaceToolOptions,
} from '../agents/tools/genie-space.js';
import { isConnectedMcpTool } from '../agents/tools/mcp-tools.js';
import type { SystemAiMcpOptions } from '../../shared/agents/mcp-types.js';
import { formatBotContext } from '../agents/memory/context.js';
import { MemoryMemorySkillStore } from '../agents/memory/memory-store.js';
import { annotate, traced } from '../observability/tracing.js';
import { MemoryRunStore } from '../runs/memory-store.js';
import { abortable, RunService, RunStoppedError, stoppedBy } from '../runs/run-service.js';
import { MemoryRoutineStore } from '../routines/memory-store.js';
import type { ArtifactSyncService } from '../sandbox/artifact-sync.js';
import type { SandboxSessionService } from '../sandbox/session-service.js';
import { MemoryVolumeUsageStore } from '../volumes/usage-store.js';
import { ApprovalStore } from './approvals.js';
import { ChoiceStore } from './choices.js';
import { canUseBot } from './access-policy.js';
import { routineNeedsOwnerApproval } from './databricks-auth.js';
import { PluginHost } from '../plugins/host/plugin-host.js';
import type { PluginExecutionContext, PluginPromptContext, PluginTurnContext } from '../../shared/plugins/types.js';

const SILENT_LOG: PluginExecutionContext['log'] = { info: () => {}, warn: () => {}, error: () => {} };

const errorText = (err: unknown) => (err instanceof Error ? err.message : 'Unexpected error');

function latestOfRole(history: Message[], role: Message['role']): Message | undefined {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i].role === role) return history[i];
  }
  return undefined;
}

const CREDENTIALED_TOOL_NAMES = new Set([
  sqlQueryToolDefinition.name,
  lakehouseCatalogToolDefinition.name,
  volumeReadToolDefinition.name,
  VOLUME_WRITE_TOOL_NAME,
  GENIE_ASK_TOOL_NAME,
  GENIE_POLL_TOOL_NAME,
  GENIE_GET_QUERY_RESULT_TOOL_NAME,
  GENIE_CANCEL_TOOL_NAME,
  GENIE_SPACE_TOOL_NAME,
]);

/** Tools that reach lakehouse data with a Databricks token; routine turns gate them on the owner. */
function isCredentialedTool(toolName: string): boolean {
  return (
    CREDENTIALED_TOOL_NAMES.has(toolName) ||
    isConnectedMcpTool(toolName) ||
    isAskFirstSandboxTool(toolName) ||
    isAutoSandboxTool(toolName)
  );
}

/** Never persist “Always allow” for these tools. */
function requiresAlwaysAsk(toolName: string): boolean {
  return (
    toolName === CREATE_BOT_TOOL_NAME ||
    toolName === ASK_CHOICE_TOOL_NAME ||
    toolName === DELETE_ROUTINE_TOOL_NAME ||
    toolName === SANDBOX_DELETE_TOOL_NAME ||
    toolName === GENIE_ASK_TOOL_NAME ||
    toolName === GENIE_SPACE_TOOL_NAME
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
  /** Registered only when a Volume root is configured. */
  volumeWrite?: Omit<VolumeWriteToolOptions, 'chatStore' | 'usage'> & {
    usage?: VolumeWriteToolOptions['usage'];
  };
  /** Defaults to an in-memory store so meta tools stay on for every bot. */
  memory?: MemorySkillStore;
  /** Defaults to in-memory so schedule_routine works in tests/local without Lakebase. */
  routines?: RoutineStore;
  compaction?: CompactionStore;
  compactionSettings?: CompactionSettings;
  idempotency?: IdempotencyStore;
  /** Defaults to in-memory so runs, Stop and events work in tests/local without Lakebase. */
  runs?: RunStore;
  /** Optional Phase 5 sandbox execution service (tools registered only when enabled). */
  sandbox?: SandboxSessionService;
  sandboxArtifactSync?: ArtifactSyncService;
  /** Optional Databricks One (Genie) and system.ai MCP tools offered to every user. */
  systemAiMcp?: SystemAiMcpOptions | RegisteredTool[];
  /** Registers ask_genie_space for one Genie space; absent means no Genie tool and no prompt text. */
  genieSpace?: GenieSpaceToolOptions;
  /** Loads a user's connected MCP tools (connectors are user-level). Cached per user. */
  resolveMcpTools?: (userId: string) => Promise<RegisteredTool[]>;
  /** Optional PluginHost for dynamically loaded plugins and extensions. */
  pluginHost?: PluginHost;
}

export type RegisteredTool = {
  definition: ToolDefinition;
  preflight?: (args: Record<string, unknown>, ctx: HandoffTurnContext) => string | null | Promise<string | null>;
  /** Display fields merged onto the approval card. Execute ignores them and recomputes the path. */
  approvalArguments?: (
    args: Record<string, unknown>,
    ctx: HandoffTurnContext
  ) => Promise<Record<string, unknown>> | Record<string, unknown>;
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

/** How a tool call got past (or failed to get past) approval, for traces. */
type ApprovalOutcome = 'auto' | 'user_approved' | 'user_denied' | 'refused';

type ContinueTurnOptions = {
  /** The run this turn belongs to; carries the routine flag (no user OBO token) and the Stop signal. */
  run: RunContext;
  /** Nested teammate turns from handoff auto-run tools without extra approvals. */
  autoApproveAll?: boolean;
  /** Signed-in caller when this chat row belongs to someone else. */
  callerUserId?: string;
};

/** HandoffTurnContext as built by the service: always inside a run. */
type TurnContext = HandoffTurnContext & { run: RunContext };

/** The caller lost access to the bot while the run was in flight. */
class AccessRevokedError extends Error {
  constructor() {
    super('Access to this bot was revoked');
  }
}

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
  /** Lakehouse + meta + sandbox tools fixed at construction. */
  private readonly baseTools: RegisteredTool[];
  /** Tests / legacy: MCP tools offered to every user. */
  private readonly sharedMcpTools: RegisteredTool[] = [];
  /** Each user's connected Unity Gateway MCP tools; replaced when that user's connectors change. */
  private readonly mcpToolsByUser = new Map<string, RegisteredTool[]>();
  private readonly compactionSettings: CompactionSettings;
  private readonly memory: MemorySkillStore;
  private readonly pluginHost?: PluginHost;
  private readonly runs: RunService;
  private readonly activeTurnsByBot = new Map<string, number>();
  /** After a deny, skip auto-continue until the next user message for that chat. */
  private readonly denyPauseByChat = new Set<string>();

  constructor(private readonly options: ChatServiceOptions) {
    this.approvals = options.approvals ?? new ApprovalStore();
    this.choices = options.choices ?? new ChoiceStore();
    this.compactionSettings = options.compactionSettings ?? DEFAULT_COMPACTION_SETTINGS;
    this.pluginHost = options.pluginHost;
    this.runs = new RunService(options.runs ?? new MemoryRunStore());
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
        }
      )
    );
    if (options.volumeWrite?.root) {
      tools.push(
        createVolumeWriteTool({
          ...options.volumeWrite,
          chatStore: options.store,
          usage: options.volumeWrite.usage ?? new MemoryVolumeUsageStore(),
        })
      );
    }
    tools.push(createHandoffTool(options.store));
    tools.push(createCreateBotTool(options.store, this.memory));
    tools.push(...createMemorySkillTools(this.memory));
    tools.push(...createPiSkillTools(this.memory));
    tools.push(createPinArtifactTool(options.store));
    tools.push(createPinChartTool(options.store));
    tools.push(createAskChoiceTool());
    tools.push(...createRoutineTools(options.routines ?? new MemoryRoutineStore(), options.store));
    if (options.genieSpace) {
      tools.push(createGenieSpaceTool(options.genieSpace));
    }
    if (options.sandbox?.isEnabled()) {
      tools.push(
        ...createSandboxTools({
          sessionService: options.sandbox,
          chatStore: options.store,
          artifactSync: options.sandboxArtifactSync,
          host: sqlOptions.host,
          getToken: sqlOptions.getToken,
        })
      );
    }
    this.baseTools = tools;
    // Tests / legacy: seed Genie (or other MCP) tools without going through discovery connect.
    if (options.systemAiMcp) {
      this.sharedMcpTools = Array.isArray(options.systemAiMcp)
        ? options.systemAiMcp
        : createSystemAiMcpTools(options.systemAiMcp);
    }
  }

  /** Tools for a turn run on behalf of `userId`: only that user's MCP connectors are included. */
  private toolsForUser(userId?: string): RegisteredTool[] {
    const pluginTools = this.pluginHost ? this.pluginHost.getRegisteredTools() : [];
    const userMcpTools = userId ? (this.mcpToolsByUser.get(userId) ?? []) : [];
    return [...this.baseTools, ...this.sharedMcpTools, ...userMcpTools, ...pluginTools];
  }

  /** Warm the per-user MCP tool cache (e.g. after restart) before a turn or approved tool runs. */
  private async loadMcpTools(userId?: string): Promise<void> {
    if (!userId || this.mcpToolsByUser.has(userId) || !this.options.resolveMcpTools) return;
    try {
      this.mcpToolsByUser.set(userId, await this.options.resolveMcpTools(userId));
    } catch (err) {
      console.warn(
        `[bricksbot] Failed to load MCP tools for user: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  /**
   * Replace one user's connected MCP tools (Connectors dialog / discovery sync).
   * Pass [] to drop everything that came from that user's MCP connectors.
   */
  replaceMcpTools(userId: string, tools: RegisteredTool[]): void {
    this.mcpToolsByUser.set(userId, tools);
  }

  /** Tool names currently offered to the LLM for `userId` (base + their connected MCP). */
  listToolNames(userId?: string): string[] {
    return this.toolsForUser(userId).map((tool) => tool.definition.name);
  }

  getApprovals(): ApprovalStore {
    return this.approvals;
  }

  getChoices(): ChoiceStore {
    return this.choices;
  }

  getMemory(): MemorySkillStore {
    return this.memory;
  }

  getSandbox(): SandboxSessionService | undefined {
    return this.options.sandbox;
  }

  getRuns(): RunService {
    return this.runs;
  }

  /**
   * Sends a user message and waits for the turn to stop (answer, approvals, or choice).
   * Throws ActiveRunError when the chat already has a run in flight.
   */
  async sendUserMessage(
    chatId: string,
    content: string,
    options?: { requestId?: string; routine?: boolean; systemNote?: string }
  ): Promise<SendMessageResult> {
    const trimmed = content.trim();
    if (!trimmed) {
      throw new Error('Message content is required');
    }

    const requestId = options?.requestId?.trim();
    const stored = await this.storedResult(chatId, requestId);
    if (stored) return stored;

    await this.refuseWhilePaused(chatId);
    const { run, ctx } = await this.openRun(chatId, 'send', { requestId, routine: options?.routine });
    if (!ctx) {
      // Same requestId as a run that is still going (or whose result was never stored).
      if (run.chatId !== chatId) throw new Error('requestId already used for another chat');
      if (run.status === 'running') throw new ActiveRunError(run.id);
      return (await this.storedResult(chatId, requestId)) ?? this.turnResult(chatId);
    }

    this.denyPauseByChat.delete(chatId);
    const result = await this.inRun(ctx, async () => {
      // Written inside the run so a refused send (409) leaves no stray note in the transcript.
      if (options?.systemNote) await this.options.store.addMessage(chatId, 'system', options.systemNote);
      const user = await this.options.store.addMessage(chatId, 'user', trimmed, { runId: ctx.runId });
      return this.continueTurn(chatId, user, 0, { run: ctx });
    });

    if (requestId && this.options.idempotency) {
      await this.options.idempotency.put(requestId, chatId, JSON.stringify(result));
    }
    return result;
  }

  /** Like sendUserMessage, but returns as soon as the user message is saved; the turn runs in the background. */
  async startUserMessage(
    chatId: string,
    content: string,
    options?: { requestId?: string }
  ): Promise<{ run: Run; user: Message }> {
    const trimmed = content.trim();
    if (!trimmed) {
      throw new Error('Message content is required');
    }

    const requestId = options?.requestId?.trim();
    await this.refuseWhilePaused(chatId);
    const { run, ctx } = await this.openRun(chatId, 'send', { requestId });
    if (!ctx) {
      const user = (await this.options.store.listMessages(chatId)).find(
        (message) => message.runId === run.id && message.role === 'user'
      );
      if (!user) throw new Error('requestId already used for another chat');
      return { run, user };
    }

    this.denyPauseByChat.delete(chatId);
    let user: Message;
    try {
      user = await this.options.store.addMessage(chatId, 'user', trimmed, { runId: ctx.runId });
    } catch (err) {
      await this.runs.settle(ctx, 'failed', errorText(err));
      throw err;
    }
    this.inBackground(ctx, () => this.continueTurn(chatId, user, 0, { run: ctx }));
    return { run, user };
  }

  /**
   * A turn paused on an approval or choice still owns the chat: a new message (user, cron, webhook) would land
   * between the assistant's tool_calls and their results and make the history invalid for the LLM.
   */
  private async refuseWhilePaused(chatId: string): Promise<void> {
    const approvals = await this.approvals.listPending(chatId);
    if (approvals.length === 0 && this.choices.listPending(chatId).length === 0) return;
    const latest = await this.runs.store.latest(chatId);
    throw new ActiveRunError(latest?.id ?? '', 'This chat is waiting for an approval or an answer');
  }

  /** A result stored under `requestId`, so a retried send does not run twice. */
  private async storedResult(chatId: string, requestId?: string): Promise<SendMessageResult | null> {
    const existing = requestId && this.options.idempotency ? await this.options.idempotency.get(requestId) : null;
    if (!existing) return null;
    if (existing.chatId !== chatId) throw new Error('requestId already used for another chat');
    return JSON.parse(existing.resultJson) as SendMessageResult;
  }

  /** Opens a run for the chat's caller. `ctx` is null for a repeated requestId; `run` is then the first one. */
  private async openRun(
    chatId: string,
    kind: Run['kind'],
    { requestId, routine }: { requestId?: string; routine?: boolean }
  ): Promise<{ run: Run; ctx: RunContext | null }> {
    const chat = await this.options.store.getChat(chatId);
    return this.runs.start({ chatId, kind, routine: routine === true, requestId, payerUserId: chat?.userId });
  }

  /** A run that continues the turn after an approval or choice; `ctx.turnId` and the routine flag stay the turn's. */
  private async openResume(chatId: string): Promise<RunContext> {
    const [chat, turnRun] = await Promise.all([this.options.store.getChat(chatId), this.runs.store.latest(chatId)]);
    return this.runs.open({ chatId, kind: 'resume', routine: turnRun?.routine === true, payerUserId: chat?.userId });
  }

  /** Runs `work` as the body of `ctx`'s run and records how it ended. */
  private async inRun(ctx: RunContext, work: () => Promise<SendMessageResult>): Promise<SendMessageResult> {
    try {
      const result = await work();
      const paused = result.pendingApprovals.length > 0 || (result.pendingChoices?.length ?? 0) > 0;
      await this.runs.settle(ctx, paused ? 'waiting' : 'completed');
      return result;
    } catch (err) {
      if (err instanceof RunStoppedError && err.reason === 'stop') {
        await this.runs.settle(ctx, 'stopped');
        return this.turnResult(ctx.chatId);
      }
      await this.runs.settle(ctx, 'failed', errorText(err));
      throw err;
    }
  }

  /** Detached runs report through the run record and its events, so nobody awaits the outcome. */
  private inBackground(ctx: RunContext, work: () => Promise<SendMessageResult>): void {
    this.inRun(ctx, work).catch((err) => console.warn(`[bricksbot] Run ${ctx.runId} failed: ${errorText(err)}`));
  }

  /** Stop button: ends the run (here or on the instance running it) once its current step lets go. */
  stopRun(runId: string): Promise<boolean> {
    return this.runs.stop(runId);
  }

  /** Fails runs whose server died mid-turn, leaving every tool call answered so the next turn replays cleanly. */
  sweepInterruptedRuns(): Promise<number> {
    return this.runs.sweep((run) => this.closeOrphanToolCalls(run.chatId, 'Interrupted: the server restarted'));
  }

  /** What the UI gets whenever a turn stops; missing user/assistant default to the latest in the chat. */
  private async turnResult(chatId: string, user?: Message, assistant?: Message | null): Promise<SendMessageResult> {
    const [history, pause] = await Promise.all([
      user && assistant !== undefined ? Promise.resolve([]) : this.options.store.listMessages(chatId),
      this.pauseSnapshot(chatId),
    ]);
    return {
      user: user ?? latestOfRole(history, 'user')!,
      assistant: assistant === undefined ? (latestOfRole(history, 'assistant') ?? null) : assistant,
      ...pause,
      provider: this.options.client.provider,
    };
  }

  /** Continue the model turn unless approvals, choices, or (optionally) a denial still hold it. */
  private async resumeUnlessPaused(run: RunContext, { honorDenyPause }: { honorDenyPause: boolean }) {
    const chatId = run.chatId;
    const [pendingApprovals, pendingChoices] = await Promise.all([
      this.approvals.listPending(chatId),
      this.choices.listPending(chatId),
    ]);
    const paused =
      pendingApprovals.length > 0 || pendingChoices.length > 0 || (honorDenyPause && this.denyPauseByChat.has(chatId));
    if (!paused) return this.continueTurn(chatId, undefined, 0, { run });
    await this.syncBotPresenceAfterTurn(chatId, await this.options.store.findBotIdForChat(chatId));
    return this.turnResult(chatId);
  }

  /** The chat row, its bot id, and the bot itself. */
  private async chatContext(chatId: string): Promise<{ chat: Chat | null; botId: string | null; bot: Bot | null }> {
    const chat = await this.options.store.getChat(chatId);
    const botId = chat?.botId ?? (await this.options.store.findBotIdForChat(chatId));
    const bot = botId ? await this.options.store.getBot(botId) : null;
    return { chat, botId, bot };
  }

  private async trailMetaForChat(
    chatId: string,
    decidedBy?: string
  ): Promise<{ botId: string | null; userId: string | null; decidedBy?: string }> {
    const [botId, chat] = await Promise.all([
      this.options.store.findBotIdForChat(chatId),
      this.options.store.getChat(chatId),
    ]);
    return {
      botId,
      userId: chat?.userId ?? null,
      ...(decidedBy ? { decidedBy } : {}),
    };
  }

  /** One trace covers the decision, the tool it releases, and the resumed turn. */
  decideApproval(
    approvalId: string,
    decision: ApprovalDecision,
    opts?: { decidedBy?: string }
  ): Promise<SendMessageResult> {
    return traced('approval_decision', 'CHAIN', { approval_id: approvalId, decision }, async () => {
      const pending = await this.approvals.get(approvalId);
      if (!pending) throw new Error('Approval not found');
      try {
        const ctx = await this.openResume(pending.chatId);
        return await this.inRun(ctx, () => this.settleApproval(approvalId, decision, ctx, opts));
      } catch (err) {
        // Double click on a card that is already decided while its run is busy: nothing to redo.
        if (err instanceof ActiveRunError && pending.status !== 'pending') return this.turnResult(pending.chatId);
        throw err;
      }
    });
  }

  /** Like decideApproval, but returns the id of the resume run at once and finishes the work in the background. */
  async decideApprovalDetached(
    approvalId: string,
    decision: ApprovalDecision,
    opts?: { decidedBy?: string }
  ): Promise<string> {
    const pending = await this.approvals.get(approvalId);
    if (!pending) throw new Error('Approval not found');
    try {
      const ctx = await this.openResume(pending.chatId);
      this.inBackground(ctx, () => this.settleApproval(approvalId, decision, ctx, opts));
      return ctx.runId;
    } catch (err) {
      if (err instanceof ActiveRunError && pending.status !== 'pending') return err.activeRunId;
      throw err;
    }
  }

  private async settleApproval(
    approvalId: string,
    decision: ApprovalDecision,
    run: RunContext,
    opts?: { decidedBy?: string }
  ): Promise<SendMessageResult> {
    const pending = await this.approvals.get(approvalId);
    if (!pending) {
      throw new Error('Approval not found');
    }

    const effectiveDecision: ApprovalDecision =
      decision === 'all_the_time' && this.requiresAlwaysAsk(pending.toolCall.name) ? 'once' : decision;
    const isAlways = effectiveDecision === 'all_the_time' || effectiveDecision === 'always';
    const isDenial = effectiveDecision === 'denied' || effectiveDecision === 'not_approved';

    const trailMeta = await this.trailMetaForChat(pending.chatId, opts?.decidedBy);
    const { request: approval, applied } = await this.approvals.decide(approvalId, effectiveDecision, trailMeta);
    const chatId = approval.chatId;
    // Double-click / race: already settled — return current pause without re-running tools.
    if (!applied) {
      return this.turnResult(chatId);
    }
    if (isDenial) {
      this.denyPauseByChat.add(chatId);
    }
    await this.applyDecidedApproval(approval, isDenial, run);

    // "Always allow" should clear the whole same-tool wave in this turn, not leave
    // N-1 sibling cards that still need clicks (and race into "already decided").
    if (isAlways) {
      const siblings = (await this.approvals.listPending(chatId)).filter(
        (item) => item.id !== approval.id && item.toolCall.name === approval.toolCall.name
      );
      for (const sibling of siblings) {
        const { request: decided, applied: siblingApplied } = await this.approvals.decide(
          sibling.id,
          'once',
          trailMeta
        );
        if (!siblingApplied) continue;
        await this.applyDecidedApproval(decided, false, run);
      }
    }

    // OpenAI requires every tool_call id from the assistant turn to have a tool
    // result before the next completion — wait if siblings are still pending.
    // Deny-until-new-message: do not auto-retry the model after a denial wave.
    return this.resumeUnlessPaused(run, { honorDenyPause: true });
  }

  private async applyDecidedApproval(approval: ApprovalRequest, isDenial: boolean, run: RunContext): Promise<void> {
    const chatId = approval.chatId;
    if (isDenial) {
      await this.traceTool(approval.toolCall, { chatId }, 'user_denied', () =>
        this.options.store.addMessage(
          chatId,
          'tool',
          JSON.stringify({ error: 'User denied tool call', tool: approval.toolCall.name }),
          { toolCallId: approval.toolCall.id, runId: run.runId }
        )
      );
      return;
    }

    if (approval.toolCall.name === ASK_CHOICE_TOOL_NAME) {
      const botId = await this.options.store.findBotIdForChat(chatId);
      const bot = botId ? await this.options.store.getBot(botId) : null;
      const error = await this.beginPendingChoice(chatId, approval.toolCall, bot);
      if (error) {
        await this.options.store.addMessage(chatId, 'tool', JSON.stringify({ error, tool: approval.toolCall.name }), {
          toolCallId: approval.toolCall.id,
          runId: run.runId,
        });
      }
      return;
    }

    const { chat, botId, bot } = await this.chatContext(chatId);
    if (botId) {
      await this.options.store.setBotPresence(botId, 'working');
    }
    await this.loadMcpTools(chat?.userId);
    const toolResult = await this.executeTool(
      approval.toolCall,
      { chatId, bot, userId: chat?.userId, run },
      'user_approved'
    );
    await this.options.store.addMessage(chatId, 'tool', toolResult, {
      toolCallId: approval.toolCall.id,
      runId: run.runId,
    });
  }

  async submitChoice(choiceId: string, selectedOption: string): Promise<SendMessageResult> {
    const { chatId } = this.pendingChoice(choiceId, selectedOption);
    const ctx = await this.openResume(chatId);
    return this.inRun(ctx, () => this.answerChoice(choiceId, selectedOption.trim(), ctx));
  }

  /** Like submitChoice, but returns the id of the resume run at once and finishes the work in the background. */
  async submitChoiceDetached(choiceId: string, selectedOption: string): Promise<string> {
    const { chatId } = this.pendingChoice(choiceId, selectedOption);
    const ctx = await this.openResume(chatId);
    this.inBackground(ctx, () => this.answerChoice(choiceId, selectedOption.trim(), ctx));
    return ctx.runId;
  }

  private pendingChoice(choiceId: string, selectedOption: string) {
    if (!selectedOption.trim()) {
      throw new Error('selectedOption is required');
    }
    const pending = this.choices.get(choiceId);
    if (!pending) {
      throw new Error('Choice not found');
    }
    return pending;
  }

  private async answerChoice(choiceId: string, selectedOption: string, run: RunContext): Promise<SendMessageResult> {
    const answered = this.choices.answer(choiceId, selectedOption);
    const chatId = answered.chatId;

    await this.options.store.addMessage(
      chatId,
      'system',
      serializeChoiceAnswerNotice({
        kind: 'choice_answer',
        choiceId: answered.id,
        prompt: answered.prompt,
        selectedOption,
      })
    );

    await this.options.store.addMessage(
      chatId,
      'tool',
      JSON.stringify({ ok: true, selected: selectedOption, tool: ASK_CHOICE_TOOL_NAME }),
      { toolCallId: answered.toolCallId, runId: run.runId }
    );

    return this.resumeUnlessPaused(run, { honorDenyPause: false });
  }

  /** After approval: post choice_prompt system row and keep the turn open. */
  private async beginPendingChoice(chatId: string, toolCall: ToolCall, bot: Bot | null): Promise<string | null> {
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
      })
    );

    return null;
  }

  private markBotTurnStart(botId: string | null): void {
    if (!botId) return;
    this.activeTurnsByBot.set(botId, (this.activeTurnsByBot.get(botId) ?? 0) + 1);
  }

  private async markBotTurnEnd(chatId: string, botId: string | null): Promise<void> {
    if (!botId) return;
    const active = (this.activeTurnsByBot.get(botId) ?? 1) - 1;
    if (active <= 0) {
      this.activeTurnsByBot.delete(botId);
      await this.syncBotPresenceAfterTurn(chatId, botId);
    } else {
      this.activeTurnsByBot.set(botId, active);
    }
  }

  /** After a turn stops: waiting (approvals) or blocked (user choice) or online. */
  private async syncBotPresenceAfterTurn(chatId: string, botId: string | null): Promise<void> {
    if (!botId) return;
    const [pendingApprovals, pendingChoices] = await Promise.all([
      this.approvals.listPending(chatId),
      this.choices.listPending(chatId),
    ]);
    const presence = pendingApprovals.length > 0 ? 'waiting' : pendingChoices.length > 0 ? 'blocked' : 'online';
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

  /** One trace per turn; follow-up model calls (depth > 0) stay inside it. */
  private continueTurn(
    chatId: string,
    user: Message | undefined,
    depth: number,
    opts: ContinueTurnOptions
  ): Promise<SendMessageResult> {
    if (depth > 0) return this.runTurn(chatId, user, depth, opts);
    return traced(
      'chat_turn',
      'AGENT',
      { chat_id: chatId, run_id: opts.run.runId, routine: opts.run.routine, handoff: opts.autoApproveAll === true },
      () => this.runTurn(chatId, user, depth, opts)
    );
  }

  private async runTurn(
    chatId: string,
    user: Message | undefined,
    depth: number,
    opts: ContinueTurnOptions
  ): Promise<SendMessageResult> {
    const { run } = opts;
    if (depth > 8) {
      const assistant = await this.options.store.addMessage(
        chatId,
        'assistant',
        'Reached maximum tool execution steps for this turn.',
        { runId: run.runId }
      );
      return this.turnResult(chatId, user, assistant);
    }

    const { chat, botId, bot } = await this.chatContext(chatId);
    if (depth === 0) annotate({ bot_id: botId });
    if (botId) {
      if (depth === 0) {
        this.markBotTurnStart(botId);
      }
      await this.options.store.setBotPresence(botId, 'thinking');
    }

    try {
      let history = await this.options.store.listMessages(chatId);
      const turnUserId = opts.callerUserId ?? chat?.userId;
      // Checked every step: unsharing or removal cuts off a run that is already going.
      if (run.signal.aborted) throw stoppedBy(run.signal);
      if (bot && turnUserId && !(await canUseBot(this.options.store, bot, turnUserId))) {
        throw new AccessRevokedError();
      }
      await this.loadMcpTools(turnUserId);
      const tools = this.toolsFor(bot, turnUserId);
      const systemPrompt = await this.systemPromptFor(
        bot,
        chat?.userId,
        chatId,
        tools.map((tool) => tool.name)
      );

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

      const compaction = this.options.compaction ? await this.options.compaction.getLatest(chatId) : null;
      const { messages: windowed, summarySystem } = applyCompactionToHistory(history, compaction);

      const turnCtx: TurnContext = { chatId, bot, userId: turnUserId, run };
      const pluginTurnContext = (messages: Message[]): PluginTurnContext => ({
        ...this.pluginHostContext(turnCtx),
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        model: this.options.client.model ?? this.options.client.provider,
      });

      let pluginInjectedSystemPrompt: string | undefined;
      if (this.pluginHost) {
        const beforeTurnResult = await this.pluginHost.executeBeforeTurn(pluginTurnContext(windowed));
        pluginInjectedSystemPrompt = beforeTurnResult.injectSystemPrompt;
      }

      const llmMessages: LlmMessage[] = [
        { role: 'system', content: systemPrompt },
        ...(pluginInjectedSystemPrompt ? [{ role: 'system' as const, content: pluginInjectedSystemPrompt }] : []),
        ...(summarySystem ? [{ role: 'system' as const, content: summarySystem }] : []),
        ...toLlmHistory(windowed),
      ];

      if (botId) {
        await this.options.store.setBotPresence(botId, 'working');
      }
      const completion = await traced(
        'llm_call',
        'LLM',
        {
          model: this.options.client.model,
          provider: this.options.client.provider,
          messages: llmMessages.length,
          tools: tools.length,
          depth,
        },
        async () => {
          let partial = '';
          try {
            const result = await this.options.client.complete(
              { messages: llmMessages, tools },
              {
                signal: run.signal,
                onDelta: (text) => {
                  partial += text;
                  run.delta(text);
                },
              }
            );
            annotate({ tool_calls: result.toolCalls.length, total_tokens: result.usage?.totalTokens });
            return result;
          } catch (err) {
            if (!run.signal.aborted) throw err;
            // Keep whatever streamed before Stop, marked so it is not mistaken for a full answer.
            await this.options.store.addMessage(
              chatId,
              'assistant',
              partial ? `${partial}\n\n(stopped)` : '(stopped)',
              { runId: run.runId }
            );
            throw stoppedBy(run.signal);
          }
        }
      );

      if (completion.toolCalls.length > 0) {
        const needsApproval: ToolCall[] = [];
        const toAutoExecute: ToolCall[] = [];
        const refusals: Array<{ toolCall: ToolCall; reason: string }> = [];

        for (const toolCall of completion.toolCalls) {
          const refusal = await this.refusalFor(toolCall, turnCtx);
          if (refusal) {
            refusals.push({ toolCall, reason: refusal });
            continue;
          }
          const isPluginTool = Boolean(this.pluginHost?.hasTool(toolCall.name));
          const isPluginAskFirst = isPluginTool && (this.pluginHost?.isAskFirst(toolCall.name) ?? true);
          // create_bot / sandbox_delete / ask_choice / genie_ask / ask_genie_space always Ask-first.
          // Default meta + sandbox_stop never Ask-first.
          // Handoff autoApproveAll still requires Ask-first for sandbox, volume_write, MCP tools, and plugin tools.
          const handoffAuto =
            opts.autoApproveAll &&
            !isAskFirstSandboxTool(toolCall.name) &&
            !isAskFirstVolumeWrite(toolCall.name) &&
            !isConnectedMcpTool(toolCall.name) &&
            !isPluginAskFirst;
          // Routine turns have no user token: credentialed tools wait for the owner, whose approval supplies OBO.
          const ownerMustApprove = routineNeedsOwnerApproval() && isCredentialedTool(toolCall.name);
          if (
            !ownerMustApprove &&
            !this.requiresAlwaysAsk(toolCall.name) &&
            (isDefaultMetaTool(toolCall.name) ||
              isAutoRoutineTool(toolCall.name) ||
              isAutoSandboxTool(toolCall.name) ||
              (isPluginTool && !isPluginAskFirst) ||
              (await this.approvals.isAutoApproved(chatId, toolCall.name)) ||
              handoffAuto)
          ) {
            toAutoExecute.push(toolCall);
          } else {
            needsApproval.push(toolCall);
          }
        }

        // Keep transcript clean: approval cards carry the wait state. Empty content is
        // fine for tool-only assistant rows (and the UI hides empty bubbles).
        const assistantContent = completion.content?.trim() || '';

        // Persist the assistant tool_calls before any tool results so replay is valid.
        const assistant = await this.options.store.addMessage(chatId, 'assistant', assistantContent, {
          toolCalls: completion.toolCalls,
          runId: run.runId,
        });
        await run.emit('assistant.committed', { messageId: assistant.id, toolCalls: completion.toolCalls.length });

        for (const { toolCall, reason } of refusals) {
          await this.traceTool(toolCall, turnCtx, 'refused', () =>
            this.options.store.addMessage(chatId, 'tool', JSON.stringify({ error: reason, tool: toolCall.name }), {
              toolCallId: toolCall.id,
              runId: run.runId,
            })
          );
        }

        for (const toolCall of toAutoExecute) {
          if (run.signal.aborted) throw stoppedBy(run.signal);
          const toolResult = await this.executeTool(toolCall, turnCtx, 'auto');
          await this.options.store.addMessage(chatId, 'tool', toolResult, {
            toolCallId: toolCall.id,
            runId: run.runId,
          });
        }

        if (needsApproval.length > 0) {
          annotate({ pending_approvals: needsApproval.length });
          const trailMeta = {
            botId: bot?.id ?? null,
            userId: turnCtx.userId ?? chat?.userId ?? null,
          };
          const pendingApprovals = await Promise.all(
            needsApproval.map(async (toolCall) => {
              const extra = await this.toolFor(toolCall.name, turnCtx.userId)?.approvalArguments?.(
                toolCall.arguments,
                turnCtx
              );
              return this.approvals.create(chatId, toolCall, trailMeta, extra);
            })
          );
          await run.emit('approval.pending', {
            approvals: pendingApprovals.map((approval) => ({ id: approval.id, tool: approval.toolCall.name })),
          });
          return {
            ...(await this.turnResult(chatId, user ?? latestOfRole(history, 'user'), assistant)),
            pendingApprovals,
          };
        }

        const openChoices = await this.choices.listPending(chatId);
        if (openChoices.length > 0) {
          return this.turnResult(chatId, user ?? latestOfRole(history, 'user'), assistant);
        }

        return await this.continueTurn(chatId, user, depth + 1, opts);
      }

      const assistant = await this.options.store.addMessage(
        chatId,
        'assistant',
        completion.content?.trim() || '(empty model response)',
        { runId: run.runId }
      );
      await run.emit('assistant.committed', { messageId: assistant.id, toolCalls: 0 });

      if (this.pluginHost) {
        await this.pluginHost.executeAfterTurn(pluginTurnContext([...windowed, assistant]));
      }

      return this.turnResult(chatId, user ?? latestOfRole(history, 'user'), assistant);
    } catch (err) {
      // Stop, lost access, or a crash can land between an assistant's tool_calls and their results.
      if (err instanceof RunStoppedError || err instanceof AccessRevokedError) {
        await this.closeOrphanToolCalls(
          chatId,
          err instanceof AccessRevokedError
            ? err.message
            : err.reason === 'stop'
              ? 'Stopped by user'
              : 'Interrupted: the run lost its lease'
        );
      }
      throw err;
    } finally {
      if (depth === 0) {
        await this.markBotTurnEnd(chatId, botId);
      }
    }
  }

  /**
   * Answers every tool call of the latest assistant turn that has neither a result nor a pending
   * approval/choice, so the next completion never replays a dangling tool_call.
   */
  private async closeOrphanToolCalls(chatId: string, reason: string): Promise<void> {
    const history = await this.options.store.listMessages(chatId);
    const calls = [...history]
      .reverse()
      .find((message) => message.role === 'assistant' && message.toolCalls?.length)?.toolCalls;
    if (!calls) return;
    const pendingApprovals = await this.approvals.listPending(chatId);
    const pendingChoices = this.choices.listPending(chatId);
    const settled = new Set([
      ...history.flatMap((message) => (message.role === 'tool' && message.toolCallId ? [message.toolCallId] : [])),
      ...pendingApprovals.map((approval) => approval.toolCall.id),
      ...pendingChoices.map((choice) => choice.toolCallId),
    ]);
    for (const call of calls.filter((call) => !settled.has(call.id))) {
      await this.options.store.addMessage(chatId, 'tool', JSON.stringify({ error: reason, tool: call.name }), {
        toolCallId: call.id,
      });
    }
  }

  /**
   * Every bot gets lakehouse tools + default meta tools.
   * `handoff_to_bot` and `create_bot` are Primary-gated.
   */
  private toolsFor(bot: Bot | null, userId?: string): ToolDefinition[] {
    const primaryOnly = new Set([HANDOFF_TOOL_NAME, CREATE_BOT_TOOL_NAME]);
    return this.toolsForUser(userId)
      .filter((tool) => !primaryOnly.has(tool.definition.name) || Boolean(bot?.isPrimary))
      .map((tool) => tool.definition);
  }

  private async systemPromptFor(
    bot: Bot | null,
    userId: string | undefined,
    chatId: string,
    toolNames: string[]
  ): Promise<string> {
    const botName = bot?.name ?? 'Primary';

    let teammates: Array<{ id: string; name: string }> = [];
    if (bot?.isPrimary) {
      const roster = bot.spaceId
        ? await this.options.store.listBots({ spaceId: bot.spaceId, ownerId: bot.ownerId })
        : [];
      teammates = roster.filter((other) => other.id !== bot.id).map((other) => ({ id: other.id, name: other.name }));
    }

    let memories: Awaited<ReturnType<MemorySkillStore['listMemories']>> = [];
    let botSkills: Awaited<ReturnType<MemorySkillStore['listSkills']>> = [];
    if (bot) {
      [memories, botSkills] = await Promise.all([
        this.memory.listMemories(bot.id, userId),
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

    const baseSections = [`You are ${botName}, a durable BricksBot teammate for the Databricks lakehouse. Be concise.`];
    if (bot?.description?.trim()) {
      baseSections.push(`Bot instructions: ${bot.description.trim()}`);
    }
    baseSections.push(formatCapabilityPrompt(catalog));
    if (this.pluginHost) {
      const promptCtx: PluginPromptContext = {
        chatId,
        botId: bot?.id ?? '',
        botName,
        isPrimary: Boolean(bot?.isPrimary),
      };
      const pluginSections = await this.pluginHost.renderPromptSections(promptCtx);
      if (pluginSections.length > 0) {
        baseSections.push(...pluginSections);
      }
    }
    const base = baseSections.join('\n\n');

    // Memories keep values in-window; skills already appear as an index in Capabilities.
    const memorySection = formatBotContext(memories, []);
    return memorySection ? `${base}\n\n${memorySection}` : base;
  }

  private pluginHostContext(ctx: HandoffTurnContext): PluginExecutionContext {
    return {
      chatId: ctx.chatId,
      botId: ctx.bot?.id ?? '',
      userId: ctx.userId,
      host: this.options.sqlQuery?.host ?? 'localhost',
      log: SILENT_LOG,
    };
  }

  private requiresAlwaysAsk(toolName: string): boolean {
    if (this.pluginHost?.requiresAlwaysAsk(toolName)) {
      return true;
    }
    return requiresAlwaysAsk(toolName);
  }

  private async refusalFor(toolCall: ToolCall, ctx: HandoffTurnContext): Promise<string | null> {
    if (this.pluginHost) {
      const execCtx = this.pluginHostContext(ctx);
      const hookResult = await this.pluginHost.executeBeforeTool(toolCall.name, toolCall.arguments, execCtx);
      if (hookResult.block) {
        return hookResult.block;
      }
      if (hookResult.overrideArgs) {
        toolCall.arguments = { ...toolCall.arguments, ...hookResult.overrideArgs };
      }
    }
    return (await this.toolFor(toolCall.name, ctx.userId)?.preflight?.(toolCall.arguments, ctx)) ?? null;
  }

  private toolFor(name: string, userId?: string): RegisteredTool | undefined {
    return this.toolsForUser(userId).find((tool) => tool.definition.name === name);
  }

  /** Span per tool call, named after the tool. The handoff span holds the teammate's turn. */
  private traceTool<T>(
    toolCall: ToolCall,
    ctx: { chatId: string; bot?: Bot | null },
    approval: ApprovalOutcome,
    run: () => Promise<T>
  ): Promise<T> {
    return traced(
      toolCall.name,
      'TOOL',
      { tool: toolCall.name, approval, chat_id: ctx.chatId, bot_id: ctx.bot?.id },
      run
    );
  }

  private executeTool(toolCall: ToolCall, ctx: TurnContext, approval: ApprovalOutcome): Promise<string> {
    return this.traceTool(toolCall, ctx, approval, async () => {
      await ctx.run.emit('tool.started', { toolCallId: toolCall.id, name: toolCall.name });
      let ok = false;
      try {
        // Stop frees the run at once; a tool that ignores ctx.run.signal finishes unobserved.
        const result = await abortable(this.runTool(toolCall, ctx), ctx.run.signal);
        ok = true;
        return result;
      } finally {
        await ctx.run.emit('tool.finished', { toolCallId: toolCall.id, name: toolCall.name, ok });
      }
    });
  }

  private async runTool(toolCall: ToolCall, ctx: TurnContext): Promise<string> {
    if (toolCall.name === HANDOFF_TOOL_NAME) {
      return this.executeHandoffRoundTrip(toolCall.arguments, ctx);
    }
    const tool = this.toolFor(toolCall.name, ctx.userId);
    if (!tool) {
      if (toolCall.name === 'web_fetch') {
        throw new Error('web_fetch is not configured (empty allowlist)');
      }
      throw new Error(`Unknown tool: ${toolCall.name}`);
    }
    let result = await tool.execute(toolCall.arguments, ctx);
    if (this.pluginHost) {
      const execCtx = this.pluginHostContext(ctx);
      result = await this.pluginHost.executeAfterTool(toolCall.name, result, execCtx);
    }
    return result;
  }

  /**
   * Deliver brief → run teammate one turn → post “N messages with …” on both chats
   * and return their reply so Primary can summarize.
   */
  private async executeHandoffRoundTrip(args: Record<string, unknown>, ctx: TurnContext): Promise<string> {
    const planned = await planHandoff(this.options.store, ctx.bot, args);
    if (!planned.ok) return planned.error;

    const { sender, target, brief } = planned.plan;
    annotate({ target_bot_id: target.id });
    const callerId = ctx.userId?.trim() || sender.ownerId;
    const targetChat = await this.options.store.getOrCreateChatForBot(target.id, callerId);
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
      })
    );

    let reply: string;
    try {
      // The teammate turn shares the caller's run (Stop, routine flag) but not its event feed.
      const nested = await this.continueTurn(targetChat.id, undefined, 0, {
        autoApproveAll: true,
        callerUserId: callerId,
        run: { ...ctx.run, chatId: targetChat.id, emit: async () => {}, delta: () => {} },
      });
      reply = nested.assistant?.content?.trim() || '(no reply)';
    } catch (err) {
      if (err instanceof RunStoppedError) throw err;
      reply = `(handoff failed) ${err instanceof Error ? err.message : 'Unexpected error'}`;
      await this.options.store.addMessage(targetChat.id, 'assistant', reply);
    }

    const targetMessages = await this.options.store.listMessages(targetChat.id);
    let threadStart = -1;
    for (let i = targetMessages.length - 1; i >= 0; i -= 1) {
      const message = targetMessages[i];
      if (message.role === 'user' && message.content === briefLine) {
        threadStart = i;
        break;
      }
    }
    const threadSlice = threadStart >= 0 ? targetMessages.slice(threadStart) : targetMessages.slice(-4);
    const messageCount = threadSlice.filter(
      (message) => message.role === 'user' || message.role === 'assistant'
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
      })
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
      })
    );

    return `Handed off to ${target.name}. Their reply:\n${reply}`;
  }
}
