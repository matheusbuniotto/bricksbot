import type { ToolDefinition } from '../../../shared/agents/types.js';
import type { ChatStore } from '../../../shared/chat/types.js';
import type { HandoffTurnContext } from '../handoff.js';
import {
  ArtifactSyncService,
  resolveArtifactVolumePath,
} from '../../sandbox/artifact-sync.js';
import type { SandboxSessionService } from '../../sandbox/session-service.js';

export const SANDBOX_EXEC_TOOL_NAME = 'sandbox_exec';
export const SANDBOX_PYTHON_EXEC_TOOL_NAME = 'python_exec';
export const SANDBOX_UPLOAD_TOOL_NAME = 'sandbox_upload';
export const SANDBOX_DOWNLOAD_TOOL_NAME = 'sandbox_download';
export const SANDBOX_SAVE_ARTIFACT_TOOL_NAME = 'sandbox_save_artifact';
export const SANDBOX_STOP_TOOL_NAME = 'sandbox_stop';
export const SANDBOX_DELETE_TOOL_NAME = 'sandbox_delete';

export const SANDBOX_TOOL_NAMES = [
  SANDBOX_EXEC_TOOL_NAME,
  SANDBOX_PYTHON_EXEC_TOOL_NAME,
  SANDBOX_UPLOAD_TOOL_NAME,
  SANDBOX_DOWNLOAD_TOOL_NAME,
  SANDBOX_SAVE_ARTIFACT_TOOL_NAME,
  SANDBOX_STOP_TOOL_NAME,
  SANDBOX_DELETE_TOOL_NAME,
] as const;

export function isAutoSandboxTool(toolName: string): boolean {
  return toolName === SANDBOX_STOP_TOOL_NAME;
}

/** Ask-first sandbox tools — never auto-run on handoff (`autoApproveAll`). */
export function isAskFirstSandboxTool(toolName: string): boolean {
  return (
    toolName === SANDBOX_EXEC_TOOL_NAME ||
    toolName === SANDBOX_PYTHON_EXEC_TOOL_NAME ||
    toolName === SANDBOX_UPLOAD_TOOL_NAME ||
    toolName === SANDBOX_DOWNLOAD_TOOL_NAME ||
    toolName === SANDBOX_SAVE_ARTIFACT_TOOL_NAME ||
    toolName === SANDBOX_DELETE_TOOL_NAME
  );
}

function clip(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n…[truncated]` : text;
}

export const sandboxExecToolDefinition: ToolDefinition = {
  name: SANDBOX_EXEC_TOOL_NAME,
  description:
    'Run a shell command inside this chat’s isolated Linux sandbox and return stdout, stderr, exit code, and duration. Requires user approval.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      command: {
        type: 'string',
        description: 'Shell command or script to execute via /bin/bash -c',
      },
      cwd: {
        type: 'string',
        description: 'Optional working directory inside the sandbox',
      },
      timeout_sec: {
        type: 'number',
        description: 'Optional timeout in seconds (defaults to SANDBOX_EXEC_TIMEOUT_SEC)',
      },
    },
    required: ['command'],
  },
};

export const sandboxPythonExecToolDefinition: ToolDefinition = {
  name: SANDBOX_PYTHON_EXEC_TOOL_NAME,
  description:
    'Run Python code inside the isolated sandbox (backed by Databricks Sandbox or Unity Catalog system.ai.python_exec) and return stdout, stderr, and exit code. Print final outputs to stdout. Requires user approval.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      code: {
        type: 'string',
        description:
          'Python 3 script to execute. Initialize variables and imports in the script and print results to stdout.',
      },
      timeout_sec: {
        type: 'number',
        description: 'Optional timeout in seconds (defaults to SANDBOX_EXEC_TIMEOUT_SEC)',
      },
    },
    required: ['code'],
  },
};

export const sandboxUploadToolDefinition: ToolDefinition = {
  name: SANDBOX_UPLOAD_TOOL_NAME,
  description:
    'Write a UTF-8 file into the chat’s sandbox filesystem. Requires user approval.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      destination: {
        type: 'string',
        description: 'Target file path in the sandbox (e.g. /home/sandbox-agent/analyze.py)',
      },
      content: {
        type: 'string',
        description: 'File text content to write',
      },
    },
    required: ['destination', 'content'],
  },
};

export const sandboxDownloadToolDefinition: ToolDefinition = {
  name: SANDBOX_DOWNLOAD_TOOL_NAME,
  description:
    'Read a file from the chat’s sandbox filesystem. Requires user approval.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      source: {
        type: 'string',
        description: 'File path in the sandbox to read',
      },
    },
    required: ['source'],
  },
};

export const sandboxSaveArtifactToolDefinition: ToolDefinition = {
  name: SANDBOX_SAVE_ARTIFACT_TOOL_NAME,
  description:
    'Copy a generated file from the sandbox to a Unity Catalog Volume (/Volumes/...) and pin it to this chat before teardown. Requires user approval.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      source_path: {
        type: 'string',
        description: 'Path of the generated file inside the sandbox',
      },
      volume_path: {
        type: 'string',
        description:
          'Target Unity Catalog Volume path starting with /Volumes/... (optional when SANDBOX_ARTIFACT_VOLUME_PATH is set)',
      },
      title: {
        type: 'string',
        description: 'Optional human-friendly label for the pinned artifact',
      },
      summary: {
        type: 'string',
        description: 'Optional one-line summary for the transcript pin',
      },
    },
    required: ['source_path'],
  },
};

export const sandboxStopToolDefinition: ToolDefinition = {
  name: SANDBOX_STOP_TOOL_NAME,
  description:
    'Stop the chat’s active sandbox session to pause compute while preserving its persistent home directory.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {},
  },
};

export const sandboxDeleteToolDefinition: ToolDefinition = {
  name: SANDBOX_DELETE_TOOL_NAME,
  description:
    'Permanently delete the chat’s sandbox session and its home directory. Always requires user approval.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {},
  },
};

export interface CreateSandboxToolsOptions {
  sessionService: SandboxSessionService;
  chatStore: ChatStore;
  artifactSync?: ArtifactSyncService;
  host?: string;
  getToken?: () => Promise<string>;
  maxChars?: number;
}

export function createSandboxTools(options: CreateSandboxToolsOptions) {
  const { sessionService, chatStore } = options;
  const maxChars = options.maxChars ?? 20_000;
  const artifactSync =
    options.artifactSync ??
    new ArtifactSyncService({
      chatStore,
      sessionService,
      host: options.host,
      getToken: options.getToken,
    });

  return [
    {
      definition: sandboxExecToolDefinition,
      preflight(args: Record<string, unknown>, ctx: HandoffTurnContext): string | null {
        if (!ctx.bot) return 'sandbox_exec requires an active Bot';
        const command = typeof args.command === 'string' ? args.command.trim() : '';
        if (!command) return 'sandbox_exec requires a non-empty command';
        return null;
      },
      async execute(args: Record<string, unknown>, ctx: HandoffTurnContext): Promise<string> {
        if (!ctx.bot) {
          return JSON.stringify({
            ok: false,
            error: 'sandbox_exec requires an active Bot',
            tool: SANDBOX_EXEC_TOOL_NAME,
          });
        }
        const command = typeof args.command === 'string' ? args.command.trim() : '';
        if (!command) {
          return JSON.stringify({
            ok: false,
            error: 'sandbox_exec requires a non-empty command',
            tool: SANDBOX_EXEC_TOOL_NAME,
          });
        }
        const cwd = typeof args.cwd === 'string' && args.cwd.trim() ? args.cwd.trim() : undefined;
        const timeoutSec =
          typeof args.timeout_sec === 'number' && Number.isFinite(args.timeout_sec)
            ? args.timeout_sec
            : undefined;

        try {
          const result = await sessionService.exec(
            {
              chatId: ctx.chatId,
              botId: ctx.bot.id,
              userId: ctx.bot.ownerId,
            },
            {
              cmd: [command],
              cwd,
              timeoutSec,
            },
          );
          return JSON.stringify({
            ok: true,
            tool: SANDBOX_EXEC_TOOL_NAME,
            exitCode: result.exitCode,
            durationMs: result.durationMs,
            stdout: clip(result.stdout, maxChars),
            stderr: clip(result.stderr, maxChars),
            artifactPaths: result.artifactPaths,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Sandbox execution failed';
          return JSON.stringify({
            ok: false,
            error: message,
            tool: SANDBOX_EXEC_TOOL_NAME,
          });
        }
      },
    },
    {
      definition: sandboxPythonExecToolDefinition,
      preflight(args: Record<string, unknown>, ctx: HandoffTurnContext): string | null {
        if (!ctx.bot) return 'python_exec requires an active Bot';
        const code = typeof args.code === 'string' ? args.code.trim() : '';
        if (!code) return 'python_exec requires non-empty Python code';
        return null;
      },
      async execute(args: Record<string, unknown>, ctx: HandoffTurnContext): Promise<string> {
        if (!ctx.bot) {
          return JSON.stringify({
            ok: false,
            error: 'python_exec requires an active Bot',
            tool: SANDBOX_PYTHON_EXEC_TOOL_NAME,
          });
        }
        const code = typeof args.code === 'string' ? args.code : '';
        if (!code.trim()) {
          return JSON.stringify({
            ok: false,
            error: 'python_exec requires non-empty Python code',
            tool: SANDBOX_PYTHON_EXEC_TOOL_NAME,
          });
        }
        const timeoutSec =
          typeof args.timeout_sec === 'number' && Number.isFinite(args.timeout_sec)
            ? args.timeout_sec
            : undefined;

        try {
          const result = await sessionService.exec(
            {
              chatId: ctx.chatId,
              botId: ctx.bot.id,
              userId: ctx.bot.ownerId,
            },
            {
              cmd: ['python3', '-c', code],
              timeoutSec,
            },
          );
          return JSON.stringify({
            ok: true,
            tool: SANDBOX_PYTHON_EXEC_TOOL_NAME,
            exitCode: result.exitCode,
            durationMs: result.durationMs,
            stdout: clip(result.stdout, maxChars),
            stderr: clip(result.stderr, maxChars),
            artifactPaths: result.artifactPaths,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Python execution failed';
          return JSON.stringify({
            ok: false,
            error: message,
            tool: SANDBOX_PYTHON_EXEC_TOOL_NAME,
          });
        }
      },
    },
    {
      definition: sandboxUploadToolDefinition,
      preflight(args: Record<string, unknown>, ctx: HandoffTurnContext): string | null {
        if (!ctx.bot) return 'sandbox_upload requires an active Bot';
        const dest = typeof args.destination === 'string' ? args.destination.trim() : '';
        if (!dest) return 'sandbox_upload requires destination';
        if (typeof args.content !== 'string') return 'sandbox_upload requires content';
        return null;
      },
      async execute(args: Record<string, unknown>, ctx: HandoffTurnContext): Promise<string> {
        if (!ctx.bot) {
          return JSON.stringify({
            ok: false,
            error: 'sandbox_upload requires an active Bot',
            tool: SANDBOX_UPLOAD_TOOL_NAME,
          });
        }
        const dest = typeof args.destination === 'string' ? args.destination.trim() : '';
        const content = typeof args.content === 'string' ? args.content : '';
        try {
          const uploaded = await sessionService.uploadFile(
            {
              chatId: ctx.chatId,
              botId: ctx.bot.id,
              userId: ctx.bot.ownerId,
            },
            { data: content, dest },
          );
          return JSON.stringify({
            ok: true,
            tool: SANDBOX_UPLOAD_TOOL_NAME,
            name: uploaded.artifactName,
            bytes: uploaded.bytes,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Sandbox upload failed';
          return JSON.stringify({
            ok: false,
            error: message,
            tool: SANDBOX_UPLOAD_TOOL_NAME,
          });
        }
      },
    },
    {
      definition: sandboxDownloadToolDefinition,
      preflight(args: Record<string, unknown>, ctx: HandoffTurnContext): string | null {
        if (!ctx.bot) return 'sandbox_download requires an active Bot';
        const src = typeof args.source === 'string' ? args.source.trim() : '';
        if (!src) return 'sandbox_download requires source';
        return null;
      },
      async execute(args: Record<string, unknown>, ctx: HandoffTurnContext): Promise<string> {
        if (!ctx.bot) {
          return JSON.stringify({
            ok: false,
            error: 'sandbox_download requires an active Bot',
            tool: SANDBOX_DOWNLOAD_TOOL_NAME,
          });
        }
        const src = typeof args.source === 'string' ? args.source.trim() : '';
        try {
          const downloaded = await sessionService.downloadFile(
            {
              chatId: ctx.chatId,
              botId: ctx.bot.id,
              userId: ctx.bot.ownerId,
            },
            { src },
          );
          const text = Buffer.from(downloaded.data).toString('utf8');
          return JSON.stringify({
            ok: true,
            tool: SANDBOX_DOWNLOAD_TOOL_NAME,
            name: downloaded.artifactName,
            bytes: downloaded.bytes,
            content: clip(text, maxChars),
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Sandbox download failed';
          return JSON.stringify({
            ok: false,
            error: message,
            tool: SANDBOX_DOWNLOAD_TOOL_NAME,
          });
        }
      },
    },
    {
      definition: sandboxSaveArtifactToolDefinition,
      preflight(args: Record<string, unknown>, ctx: HandoffTurnContext): string | null {
        if (!ctx.bot) return 'sandbox_save_artifact requires an active Bot';
        const sourcePath = typeof args.source_path === 'string' ? args.source_path.trim() : '';
        if (!sourcePath) return 'sandbox_save_artifact requires source_path';
        const volumePath = typeof args.volume_path === 'string' ? args.volume_path.trim() : undefined;
        const resolved = resolveArtifactVolumePath(
          sourcePath,
          ctx.chatId,
          volumePath,
          sessionService.getArtifactVolumeRoot(),
        );
        return resolved.ok ? null : resolved.error;
      },
      async execute(args: Record<string, unknown>, ctx: HandoffTurnContext): Promise<string> {
        try {
          const sourcePath = typeof args.source_path === 'string' ? args.source_path.trim() : '';
          const volumePath =
            typeof args.volume_path === 'string' ? args.volume_path.trim() : undefined;
          const title = typeof args.title === 'string' ? args.title.trim() : undefined;
          const summary = typeof args.summary === 'string' ? args.summary.trim() : undefined;

          const synced = await artifactSync.syncAndPin(ctx, {
            sourcePath,
            volumePath,
            title,
            summary,
          });
          return JSON.stringify({
            ok: true,
            tool: SANDBOX_SAVE_ARTIFACT_TOOL_NAME,
            title: synced.title,
            name: synced.artifactName,
            volumePath: synced.volumePath,
            bytes: synced.bytes,
            messageId: synced.messageId,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Artifact sync failed';
          return JSON.stringify({
            ok: false,
            error: message,
            tool: SANDBOX_SAVE_ARTIFACT_TOOL_NAME,
          });
        }
      },
    },
    {
      definition: sandboxStopToolDefinition,
      async execute(_args: Record<string, unknown>, ctx: HandoffTurnContext): Promise<string> {
        try {
          const res = await sessionService.stopSession(ctx.chatId, 'agent_tool');
          return JSON.stringify({
            ok: true,
            tool: SANDBOX_STOP_TOOL_NAME,
            stopped: res.stopped,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Sandbox stop failed';
          return JSON.stringify({
            ok: false,
            error: message,
            tool: SANDBOX_STOP_TOOL_NAME,
          });
        }
      },
    },
    {
      definition: sandboxDeleteToolDefinition,
      async execute(_args: Record<string, unknown>, ctx: HandoffTurnContext): Promise<string> {
        try {
          const res = await sessionService.deleteSession(ctx.chatId, 'agent_tool');
          return JSON.stringify({
            ok: true,
            tool: SANDBOX_DELETE_TOOL_NAME,
            deleted: res.deleted,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Sandbox delete failed';
          return JSON.stringify({
            ok: false,
            error: message,
            tool: SANDBOX_DELETE_TOOL_NAME,
          });
        }
      },
    },
  ];
}
