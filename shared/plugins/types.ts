export interface PluginMetadata {
  name: string;
  version: string;
  description: string;
  author?: string;
}

export interface PluginExecutionContext {
  chatId: string;
  botId: string;
  userId?: string;
  userToken?: string;
  host: string;
  log: {
    info(message: string, data?: unknown): void;
    warn(message: string, data?: unknown): void;
    error(message: string, error?: unknown): void;
  };
}

export interface PluginPromptContext {
  chatId: string;
  botId: string;
  botName: string;
  isPrimary: boolean;
}

export interface PluginTurnContext extends PluginExecutionContext {
  messages: Array<{ role: string; content: string }>;
  model: string;
}

export interface PluginToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  askFirst?: boolean;
  neverAlwaysAllow?: boolean;
  annotations?: {
    readOnly?: boolean;
    destructive?: boolean;
  };
  approvalArguments?: (
    args: Record<string, unknown>,
    ctx: PluginExecutionContext
  ) => Promise<Record<string, unknown>> | Record<string, unknown>;
  preflight?: (
    args: Record<string, unknown>,
    ctx: PluginExecutionContext
  ) => string | null | Promise<string | null>;
  execute(args: Record<string, unknown>, ctx: PluginExecutionContext): Promise<string>;
}

export interface PluginPromptSection {
  name: string;
  render(ctx: PluginPromptContext): Promise<string | undefined> | string | undefined;
}

export interface PluginHooks {
  beforeTurn?: (ctx: PluginTurnContext) => Promise<{ injectSystemPrompt?: string } | void>;
  afterTurn?: (ctx: PluginTurnContext) => Promise<void>;
  beforeTool?: (
    toolName: string,
    args: Record<string, unknown>,
    ctx: PluginExecutionContext
  ) => Promise<{ block?: string; overrideArgs?: Record<string, unknown> } | void>;
  afterTool?: (
    toolName: string,
    result: string,
    ctx: PluginExecutionContext
  ) => Promise<string | void>;
}

export interface BricksbotPlugin {
  metadata: PluginMetadata;
  tools?: PluginToolDefinition[];
  promptSections?: PluginPromptSection[];
  hooks?: PluginHooks;
}

export interface BricksbotPluginAPI {
  readonly metadata: PluginMetadata;
  registerTool(tool: PluginToolDefinition): void;
  registerPromptSection(section: PluginPromptSection): void;
  onBeforeTurn(handler: NonNullable<PluginHooks['beforeTurn']>): void;
  onAfterTurn(handler: NonNullable<PluginHooks['afterTurn']>): void;
  onBeforeTool(handler: NonNullable<PluginHooks['beforeTool']>): void;
  onAfterTool(handler: NonNullable<PluginHooks['afterTool']>): void;
}

export type PluginInitializer = (api: BricksbotPluginAPI) => void | Promise<void>;

export type PluginSource = 'volume' | 'npm' | 'builtin';

export interface PluginRecord {
  id: string;
  name: string;
  source: PluginSource;
  sourcePath: string;
  enabled: boolean;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface PluginRegistryStore {
  listPlugins(): Promise<PluginRecord[]>;
  getPlugin(name: string): Promise<PluginRecord | null>;
  upsertPlugin(
    record: Omit<PluginRecord, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
  ): Promise<PluginRecord>;
  setPluginEnabled(name: string, enabled: boolean): Promise<PluginRecord>;
  deletePlugin(name: string): Promise<void>;
}

