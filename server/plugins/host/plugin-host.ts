import type { HandoffTurnContext } from '../../agents/handoff.js';
import type { RegisteredTool } from '../../chat/service.js';
import type {
  BricksbotPlugin,
  BricksbotPluginAPI,
  PluginExecutionContext,
  PluginHooks,
  PluginInitializer,
  PluginMetadata,
  PluginPromptContext,
  PluginPromptSection,
  PluginToolDefinition,
  PluginTurnContext,
} from '../../../shared/plugins/types.js';

export interface PluginRegisteredTool extends RegisteredTool {
  askFirst: boolean;
  neverAlwaysAllow: boolean;
  pluginName: string;
}

export interface PluginHostOptions {
  host?: string;
  userToken?: string;
  logger?: PluginExecutionContext['log'];
}

export class PluginHost {
  private readonly plugins = new Map<string, BricksbotPlugin>();
  private readonly registeredTools = new Map<string, PluginRegisteredTool>();
  private promptSections: Array<{ pluginName: string; section: PluginPromptSection }> = [];
  private beforeTurnHooks: Array<{ pluginName: string; handler: NonNullable<PluginHooks['beforeTurn']> }> = [];
  private afterTurnHooks: Array<{ pluginName: string; handler: NonNullable<PluginHooks['afterTurn']> }> = [];
  private beforeToolHooks: Array<{ pluginName: string; handler: NonNullable<PluginHooks['beforeTool']> }> = [];
  private afterToolHooks: Array<{ pluginName: string; handler: NonNullable<PluginHooks['afterTool']> }> = [];

  constructor(private readonly options: PluginHostOptions = {}) {}

  unregisterPlugin(pluginName: string): void {
    this.plugins.delete(pluginName);
    for (const [toolName, tool] of this.registeredTools.entries()) {
      if (tool.pluginName === pluginName) {
        this.registeredTools.delete(toolName);
      }
    }
    this.promptSections = this.promptSections.filter((entry) => entry.pluginName !== pluginName);
    this.beforeTurnHooks = this.beforeTurnHooks.filter((entry) => entry.pluginName !== pluginName);
    this.afterTurnHooks = this.afterTurnHooks.filter((entry) => entry.pluginName !== pluginName);
    this.beforeToolHooks = this.beforeToolHooks.filter((entry) => entry.pluginName !== pluginName);
    this.afterToolHooks = this.afterToolHooks.filter((entry) => entry.pluginName !== pluginName);
  }

  async registerPlugin(pluginOrInit: BricksbotPlugin | PluginInitializer, metadata?: PluginMetadata): Promise<void> {
    const candidateName =
      typeof pluginOrInit === 'function' ? metadata?.name : (metadata?.name ?? pluginOrInit?.metadata?.name);
    if (candidateName && this.plugins.has(candidateName)) {
      this.unregisterPlugin(candidateName);
    }

    if (typeof pluginOrInit === 'function') {
      const meta = metadata;
      if (!meta) {
        throw new Error('Plugin metadata is required when registering a PluginInitializer');
      }
      this.validateMetadata(meta);

      const pluginPromptSections: PluginPromptSection[] = [];
      const api: BricksbotPluginAPI = {
        metadata: meta,
        registerTool: (tool: PluginToolDefinition) => {
          this.validateAndRegisterTool(tool, meta.name);
        },
        registerPromptSection: (section: PluginPromptSection) => {
          this.validateAndRegisterPromptSection(section, meta.name);
          pluginPromptSections.push(section);
        },
        onBeforeTurn: (handler: NonNullable<PluginHooks['beforeTurn']>) => {
          if (typeof handler !== 'function') {
            throw new Error('beforeTurn handler must be a function');
          }
          this.beforeTurnHooks.push({ pluginName: meta.name, handler });
        },
        onAfterTurn: (handler: NonNullable<PluginHooks['afterTurn']>) => {
          if (typeof handler !== 'function') {
            throw new Error('afterTurn handler must be a function');
          }
          this.afterTurnHooks.push({ pluginName: meta.name, handler });
        },
        onBeforeTool: (handler: NonNullable<PluginHooks['beforeTool']>) => {
          if (typeof handler !== 'function') {
            throw new Error('beforeTool handler must be a function');
          }
          this.beforeToolHooks.push({ pluginName: meta.name, handler });
        },
        onAfterTool: (handler: NonNullable<PluginHooks['afterTool']>) => {
          if (typeof handler !== 'function') {
            throw new Error('afterTool handler must be a function');
          }
          this.afterToolHooks.push({ pluginName: meta.name, handler });
        },
      };

      await pluginOrInit(api);
      this.plugins.set(meta.name, { metadata: meta, promptSections: pluginPromptSections });
      return;
    }

    if (!pluginOrInit || typeof pluginOrInit !== 'object') {
      throw new Error('Plugin definition must be an object or an initializer function');
    }

    const meta = metadata ?? pluginOrInit.metadata;
    if (!meta) {
      throw new Error('Plugin metadata is required');
    }
    this.validateMetadata(meta);

    if (pluginOrInit.tools) {
      for (const tool of pluginOrInit.tools) {
        this.validateAndRegisterTool(tool, meta.name);
      }
    }

    if (pluginOrInit.promptSections) {
      for (const section of pluginOrInit.promptSections) {
        this.validateAndRegisterPromptSection(section, meta.name);
      }
    }

    if (pluginOrInit.hooks) {
      if (pluginOrInit.hooks.beforeTurn) {
        if (typeof pluginOrInit.hooks.beforeTurn !== 'function') {
          throw new Error('beforeTurn hook must be a function');
        }
        this.beforeTurnHooks.push({ pluginName: meta.name, handler: pluginOrInit.hooks.beforeTurn });
      }
      if (pluginOrInit.hooks.afterTurn) {
        if (typeof pluginOrInit.hooks.afterTurn !== 'function') {
          throw new Error('afterTurn hook must be a function');
        }
        this.afterTurnHooks.push({ pluginName: meta.name, handler: pluginOrInit.hooks.afterTurn });
      }
      if (pluginOrInit.hooks.beforeTool) {
        if (typeof pluginOrInit.hooks.beforeTool !== 'function') {
          throw new Error('beforeTool hook must be a function');
        }
        this.beforeToolHooks.push({ pluginName: meta.name, handler: pluginOrInit.hooks.beforeTool });
      }
      if (pluginOrInit.hooks.afterTool) {
        if (typeof pluginOrInit.hooks.afterTool !== 'function') {
          throw new Error('afterTool hook must be a function');
        }
        this.afterToolHooks.push({ pluginName: meta.name, handler: pluginOrInit.hooks.afterTool });
      }
    }

    this.plugins.set(meta.name, {
      metadata: meta,
      tools: pluginOrInit.tools,
      promptSections: pluginOrInit.promptSections,
      hooks: pluginOrInit.hooks,
    });
  }

  getRegisteredTools(): PluginRegisteredTool[] {
    return Array.from(this.registeredTools.values());
  }

  getTool(name: string): PluginRegisteredTool | undefined {
    return this.registeredTools.get(name);
  }

  hasTool(name: string): boolean {
    return this.registeredTools.has(name);
  }

  listPlugins(): Array<{
    metadata: PluginMetadata;
    tools: Array<{ name: string; description: string; askFirst: boolean; neverAlwaysAllow: boolean }>;
    promptSections: string[];
  }> {
    return Array.from(this.plugins.values()).map((p) => {
      const tools = this.getRegisteredTools().filter((t) => t.pluginName === p.metadata.name);
      const promptSections = (p.promptSections ?? []).map((s) => s.name);
      return {
        metadata: p.metadata,
        tools: tools.map((t) => ({
          name: t.definition.name,
          description: t.definition.description,
          askFirst: t.askFirst,
          neverAlwaysAllow: t.neverAlwaysAllow,
        })),
        promptSections,
      };
    });
  }

  isAskFirst(toolName: string): boolean {
    const tool = this.registeredTools.get(toolName);
    return tool ? tool.askFirst : true;
  }

  requiresAlwaysAsk(toolName: string): boolean {
    const tool = this.registeredTools.get(toolName);
    return tool ? tool.neverAlwaysAllow : false;
  }

  getPromptSections(): PluginPromptSection[] {
    return this.promptSections.map((entry) => entry.section);
  }

  async renderPromptSections(ctx: PluginPromptContext): Promise<string[]> {
    const maxSectionLength = 500;
    const renderedSections: string[] = [];

    for (const { section } of this.promptSections) {
      const output = await section.render(ctx);
      if (output !== undefined && output !== null && output.trim().length > 0) {
        const text = output.length > maxSectionLength ? output.slice(0, maxSectionLength) : output;
        renderedSections.push(text);
      }
    }

    return renderedSections;
  }

  async executeBeforeTurn(ctx: PluginTurnContext): Promise<{ injectSystemPrompt?: string }> {
    const injectedPrompts: string[] = [];

    for (const { handler } of this.beforeTurnHooks) {
      const outcome = await handler(ctx);
      if (outcome?.injectSystemPrompt?.trim()) {
        injectedPrompts.push(outcome.injectSystemPrompt.trim());
      }
    }

    if (injectedPrompts.length > 0) {
      return { injectSystemPrompt: injectedPrompts.join('\n\n') };
    }

    return {};
  }

  async executeAfterTurn(ctx: PluginTurnContext): Promise<void> {
    for (const { handler } of this.afterTurnHooks) {
      await handler(ctx);
    }
  }

  async executeBeforeTool(
    toolName: string,
    args: Record<string, unknown>,
    ctx: PluginExecutionContext
  ): Promise<{ block?: string; overrideArgs?: Record<string, unknown> }> {
    let currentArgs = { ...args };
    let modified = false;

    for (const { handler } of this.beforeToolHooks) {
      const outcome = await handler(toolName, currentArgs, ctx);
      if (outcome?.block) {
        return { block: outcome.block };
      }
      if (outcome?.overrideArgs) {
        currentArgs = { ...currentArgs, ...outcome.overrideArgs };
        modified = true;
      }
    }

    return modified ? { overrideArgs: currentArgs } : {};
  }

  async executeAfterTool(toolName: string, result: string, ctx: PluginExecutionContext): Promise<string> {
    let currentResult = result;

    for (const { handler } of this.afterToolHooks) {
      const outcome = await handler(toolName, currentResult, ctx);
      if (typeof outcome === 'string') {
        currentResult = outcome;
      }
    }

    return currentResult;
  }

  private validateMetadata(meta: PluginMetadata): void {
    if (!meta || typeof meta !== 'object') {
      throw new Error('Plugin metadata must be an object');
    }
    if (typeof meta.name !== 'string' || !meta.name.trim()) {
      throw new Error('Plugin metadata.name must be a non-empty string');
    }
    if (typeof meta.version !== 'string' || !meta.version.trim()) {
      throw new Error('Plugin metadata.version must be a non-empty string');
    }
  }

  private validateAndRegisterTool(tool: PluginToolDefinition, pluginName: string): void {
    if (!tool || typeof tool !== 'object') {
      throw new Error('Tool definition must be an object');
    }
    if (typeof tool.name !== 'string' || !tool.name.trim()) {
      throw new Error('Tool definition must have a non-empty name');
    }
    if (typeof tool.execute !== 'function') {
      throw new Error(`Tool "${tool.name}" must have an execute function`);
    }
    const existing = this.registeredTools.get(tool.name);
    if (existing && existing.pluginName !== pluginName) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }

    const askFirst = tool.askFirst !== undefined ? tool.askFirst : tool.annotations?.readOnly !== true;
    const neverAlwaysAllow = tool.neverAlwaysAllow ?? false;

    const registeredTool: PluginRegisteredTool = {
      definition: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
      askFirst,
      neverAlwaysAllow,
      pluginName,
      preflight: tool.preflight
        ? (args: Record<string, unknown>, ctx: HandoffTurnContext) => tool.preflight!(args, this.bridgeContext(ctx))
        : undefined,
      approvalArguments: tool.approvalArguments
        ? (args: Record<string, unknown>, ctx: HandoffTurnContext) =>
            tool.approvalArguments!(args, this.bridgeContext(ctx))
        : undefined,
      execute: (args: Record<string, unknown>, ctx: HandoffTurnContext) => tool.execute(args, this.bridgeContext(ctx)),
    };

    this.registeredTools.set(tool.name, registeredTool);
  }

  private validateAndRegisterPromptSection(section: PluginPromptSection, pluginName: string): void {
    if (!section || typeof section !== 'object') {
      throw new Error('Prompt section must be an object');
    }
    if (typeof section.name !== 'string' || !section.name.trim()) {
      throw new Error('Prompt section must have a non-empty name');
    }
    if (typeof section.render !== 'function') {
      throw new Error(`Prompt section "${section.name}" must have a render function`);
    }

    this.promptSections.push({ pluginName, section });
  }

  private bridgeContext(ctx: HandoffTurnContext | PluginExecutionContext): PluginExecutionContext {
    if ('log' in ctx && 'host' in ctx) {
      return ctx;
    }
    const handoffCtx = ctx;
    return {
      chatId: handoffCtx.chatId,
      botId: handoffCtx.bot?.id ?? '',
      userId: handoffCtx.userId,
      userToken: this.options.userToken,
      host: this.options.host ?? 'localhost',
      log: this.options.logger ?? {
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    };
  }
}
