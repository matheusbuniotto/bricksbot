import type { ChatStore } from '../../../shared/chat/types.js';
import type { ToolDefinition } from '../../../shared/agents/types.js';
import {
  VOLUME_WRITE_TOOL_NAME,
  type VolumeQuotaLimits,
  type VolumeUsageStore,
} from '../../../shared/agents/volume-namespace.js';
import type { HandoffTurnContext } from '../handoff.js';
import { executePinArtifact } from './pin-artifact.js';
import type { VolumeFileClient } from './volume-files.js';
import { writeVolumeBytes } from './volume-files.js';
import { assessVolumeQuota, parseVolumeQuotaLimits, resolveNamespacedVolumePath } from './volume-namespace.js';

export { VOLUME_WRITE_TOOL_NAME };

export function isAskFirstVolumeWrite(toolName: string): boolean {
  return toolName === VOLUME_WRITE_TOOL_NAME;
}

export const volumeWriteToolDefinition: ToolDefinition = {
  name: VOLUME_WRITE_TOOL_NAME,
  description:
    'Write a file under this signed-in user and the active bot on the configured Unity Catalog Volume. ' +
    'Pass relative_path only (for example notes/summary.md). Do not pass absolute /Volumes paths, other users, or another bot. ' +
    'Ask-first. Unavailable on routine runs. Do not write secrets.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      relative_path: {
        type: 'string',
        description: 'File path under this bot folder, such as notes/summary.md',
      },
      content: {
        type: 'string',
        description: 'UTF-8 file body. Omit when content_base64 is set.',
      },
      content_base64: {
        type: 'string',
        description: 'Base64 file body for small binary. Omit when content is set.',
      },
      overwrite: {
        type: 'boolean',
        description: 'Replace an existing file. Default true.',
      },
      pin: {
        type: 'boolean',
        description: 'Pin the Volume path on this chat after a successful write. Default true.',
      },
    },
    required: ['relative_path'],
  },
};

export interface VolumeWriteToolOptions {
  root: string;
  chatStore: ChatStore;
  usage: VolumeUsageStore;
  limits?: VolumeQuotaLimits;
  host?: string;
  getToken?: () => Promise<string>;
  fetchImpl?: typeof fetch;
  writeFile?: VolumeFileClient['writeFile'];
}

type Planned =
  | {
      ok: true;
      path: string;
      relativePath: string;
      userSegment: string;
      botSegment: string;
      data: Uint8Array;
      overwrite: boolean;
      pin: boolean;
      remainingUserBytes: number;
    }
  | { ok: false; error: string };

function readFlag(value: unknown, fallback: boolean): boolean | null {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  return null;
}

function decodeBody(args: Record<string, unknown>): { ok: true; data: Uint8Array } | { ok: false; error: string } {
  const hasContent = Object.prototype.hasOwnProperty.call(args, 'content');
  const hasBase64 = Object.prototype.hasOwnProperty.call(args, 'content_base64');
  if (hasContent === hasBase64) {
    return { ok: false, error: 'volume_write requires exactly one of content or content_base64' };
  }
  if (hasContent) {
    if (typeof args.content !== 'string') {
      return { ok: false, error: 'volume_write content must be a string' };
    }
    return { ok: true, data: Buffer.from(args.content, 'utf8') };
  }
  if (typeof args.content_base64 !== 'string') {
    return { ok: false, error: 'volume_write content_base64 must be base64' };
  }
  const cleaned = args.content_base64.replace(/\s/g, '');
  if (cleaned.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned)) {
    return { ok: false, error: 'volume_write content_base64 must be base64' };
  }
  return { ok: true, data: Buffer.from(cleaned, 'base64') };
}

async function planVolumeWrite(
  args: Record<string, unknown>,
  ctx: HandoffTurnContext,
  options: VolumeWriteToolOptions
): Promise<Planned> {
  if (ctx.run?.routine) {
    return { ok: false, error: 'volume_write is not available on routine runs' };
  }
  if (!ctx.userId?.trim()) {
    return { ok: false, error: 'volume_write requires a signed-in user' };
  }
  if (!ctx.bot) {
    return { ok: false, error: 'volume_write requires an active bot' };
  }

  const overwrite = readFlag(args.overwrite, true);
  const pin = readFlag(args.pin, true);
  if (overwrite === null || pin === null) {
    return { ok: false, error: 'volume_write overwrite and pin must be booleans' };
  }

  const relativePath = typeof args.relative_path === 'string' ? args.relative_path : '';
  const namespaced = resolveNamespacedVolumePath(
    { root: options.root, userId: ctx.userId, botId: ctx.bot.id },
    relativePath
  );
  if (!namespaced.ok) return namespaced;

  const decoded = decodeBody(args);
  if (!decoded.ok) return decoded;

  const limits = options.limits ?? parseVolumeQuotaLimits({});
  const usage = await options.usage.getUsage(namespaced.userSegment, namespaced.botSegment);
  const quota = assessVolumeQuota({
    userBytes: usage.userBytes,
    botBytes: usage.botBytes,
    incomingBytes: decoded.data.byteLength,
    limits,
  });
  if (!quota.ok) return quota;

  return {
    ok: true,
    path: namespaced.path,
    relativePath: namespaced.relativePath,
    userSegment: namespaced.userSegment,
    botSegment: namespaced.botSegment,
    data: decoded.data,
    overwrite,
    pin,
    remainingUserBytes: quota.remainingUserBytes,
  };
}

export function createVolumeWriteTool(options: VolumeWriteToolOptions) {
  const client: VolumeFileClient = {
    host: options.host,
    getToken: options.getToken,
    fetchImpl: options.fetchImpl,
    writeFile: options.writeFile,
  };

  return {
    definition: volumeWriteToolDefinition,
    async preflight(args: Record<string, unknown>, ctx: HandoffTurnContext): Promise<string | null> {
      const planned = await planVolumeWrite(args, ctx, options);
      return planned.ok ? null : planned.error;
    },
    async approvalArguments(args: Record<string, unknown>, ctx: HandoffTurnContext): Promise<Record<string, unknown>> {
      const planned = await planVolumeWrite(args, ctx, options);
      if (!planned.ok) return {};
      return {
        bot_name: ctx.bot?.name ?? '',
        resolved_path: planned.path,
        byte_size: planned.data.byteLength,
        remaining_bytes: planned.remainingUserBytes,
      };
    },
    async execute(args: Record<string, unknown>, ctx: HandoffTurnContext): Promise<string> {
      const planned = await planVolumeWrite(args, ctx, options);
      if (!planned.ok) {
        return JSON.stringify({ ok: false, error: planned.error, tool: VOLUME_WRITE_TOOL_NAME });
      }

      try {
        await writeVolumeBytes(client, planned.path, planned.data, planned.overwrite);
        await options.usage.addBytes(planned.userSegment, planned.botSegment, planned.data.byteLength);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'volume_write failed';
        return JSON.stringify({ ok: false, error: message, tool: VOLUME_WRITE_TOOL_NAME });
      }

      let pinnedMessageId: string | undefined;
      if (planned.pin) {
        const title = planned.relativePath.split('/').pop() || planned.relativePath;
        const pinRaw = await executePinArtifact(options.chatStore, ctx, {
          title,
          kind: 'volume_path',
          body: planned.path,
          summary: `Wrote ${planned.relativePath} (${planned.data.byteLength} bytes)`,
        });
        try {
          const parsed = JSON.parse(pinRaw) as { ok?: boolean; messageId?: string };
          if (parsed.ok && parsed.messageId) pinnedMessageId = parsed.messageId;
        } catch {
          pinnedMessageId = undefined;
        }
      }

      return JSON.stringify({
        ok: true,
        path: planned.path,
        bytes: planned.data.byteLength,
        pinnedMessageId,
      });
    },
  };
}
