import { serializeArtifactPinNotice, type ArtifactPinKind } from '../../../shared/chat/artifact-pin-notice.js';
import type { ChatStore } from '../../../shared/chat/types.js';
import type { ToolDefinition } from '../../../shared/agents/types.js';
import type { HandoffTurnContext } from '../handoff.js';

export const PIN_ARTIFACT_TOOL_NAME = 'pin_artifact';

/** Keep pins short; large payloads belong on a Volume path. */
export const MAX_PIN_BODY_CHARS = 8_000;

const ARTIFACT_KINDS: ArtifactPinKind[] = ['note', 'sql', 'volume_path', 'link'];

export const pinArtifactToolDefinition: ToolDefinition = {
  name: PIN_ARTIFACT_TOOL_NAME,
  description:
    'Pin a short lakehouse finding onto this chat as a durable artifact (title + kind + body or path/URL). ' +
    'Use after a successful explore when the user should see a shareable result in the transcript. ' +
    'Prefer remember for lasting rules; pin for findings. Never pin secrets. Large content: store on a Volume and pin the path.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: { type: 'string', description: 'Short label for the finding' },
      kind: {
        type: 'string',
        enum: ARTIFACT_KINDS,
        description: 'note | sql | volume_path | link',
      },
      body: {
        type: 'string',
        description: 'Short markdown, SQL snippet, Volume path, or HTTPS URL',
      },
      summary: {
        type: 'string',
        description: 'Optional one-line preview for roster/transcript',
      },
    },
    required: ['title', 'kind', 'body'],
  },
};

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

type Planned = { ok: true; args: PinArgs } | { ok: false; error: string };

export interface PinArgs {
  title: string;
  kind: ArtifactPinKind;
  body: string;
  summary?: string;
}

export function planPinArtifact(args: Record<string, unknown>, bot: HandoffTurnContext['bot']): Planned {
  if (!bot) {
    return { ok: false, error: 'pin_artifact requires an active Bot' };
  }

  const title = readText(args.title);
  if (!title) {
    return { ok: false, error: 'pin_artifact requires title' };
  }

  const kindRaw = readText(args.kind);
  if (!ARTIFACT_KINDS.includes(kindRaw as ArtifactPinKind)) {
    return { ok: false, error: `pin_artifact kind must be one of: ${ARTIFACT_KINDS.join(', ')}` };
  }
  const kind = kindRaw as ArtifactPinKind;

  const body = typeof args.body === 'string' ? args.body.trim() : '';
  if (!body) {
    return { ok: false, error: 'pin_artifact requires body' };
  }
  if (body.length > MAX_PIN_BODY_CHARS) {
    return {
      ok: false,
      error: `pin_artifact body is too long (${body.length} chars; max ${MAX_PIN_BODY_CHARS}). Put large content on a Volume and pin kind volume_path.`,
    };
  }

  const summary = readText(args.summary) || undefined;
  return { ok: true, args: { title, kind, body, summary } };
}

export async function executePinArtifact(
  store: ChatStore,
  ctx: HandoffTurnContext,
  args: Record<string, unknown>,
): Promise<string> {
  const planned = planPinArtifact(args, ctx.bot);
  if (!planned.ok) return planned.error;

  const { title, kind, body, summary } = planned.args;
  const bot = ctx.bot!;

  const message = await store.addMessage(
    ctx.chatId,
    'system',
    serializeArtifactPinNotice({
      kind: 'artifact_pin',
      title,
      artifactKind: kind,
      body,
      summary,
      pinnedByBotId: bot.id,
      pinnedByName: bot.name,
    }),
  );

  return JSON.stringify({
    ok: true,
    title,
    kind,
    messageId: message.id,
  });
}

export function createPinArtifactTool(store: ChatStore) {
  return {
    definition: pinArtifactToolDefinition,
    preflight(args: Record<string, unknown>, ctx: HandoffTurnContext): string | null {
      const planned = planPinArtifact(args, ctx.bot);
      return planned.ok ? null : planned.error;
    },
    execute(args: Record<string, unknown>, ctx: HandoffTurnContext): Promise<string> {
      return executePinArtifact(store, ctx, args);
    },
  };
}
