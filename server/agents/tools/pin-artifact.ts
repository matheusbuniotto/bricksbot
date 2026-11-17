import {
  ARTIFACT_BODY_LIMITS,
  ARTIFACT_PIN_KINDS,
  serializeArtifactPinNotice,
  type ArtifactPinKind,
} from '../../../shared/chat/artifact-pin-notice.js';
import { validateMermaidSource } from '../../../shared/chat/mermaid-source.js';
import { validateVegaLiteSpec } from '../../../shared/chat/vega-spec.js';
import type { ChatStore } from '../../../shared/chat/types.js';
import type { ToolDefinition } from '../../../shared/agents/types.js';
import type { HandoffTurnContext } from '../handoff.js';
import { readText } from '../../lib/coerce.js';

export const PIN_ARTIFACT_TOOL_NAME = 'pin_artifact';

/** Default pin cap; table/chart/mermaid have their own in ARTIFACT_BODY_LIMITS. */
export const MAX_PIN_BODY_CHARS = ARTIFACT_BODY_LIMITS.note;

const ARTIFACT_KINDS: readonly ArtifactPinKind[] = ARTIFACT_PIN_KINDS;

export const pinArtifactToolDefinition: ToolDefinition = {
  name: PIN_ARTIFACT_TOOL_NAME,
  description:
    'Pin a finding, interactive Vega-Lite chart, table, or Mermaid diagram onto this chat as a rendered artifact (title + kind + body). ' +
    'Use kind="chart" with a Vega-Lite v6 JSON spec (inline data.values) to render charts from python_exec or calculations; use pin_chart when charting an earlier sql_query. ' +
    'Never draw ASCII charts or claim you cannot attach images. Never pin secrets.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: { type: 'string', description: 'Short label for the finding' },
      kind: {
        type: 'string',
        enum: [...ARTIFACT_KINDS],
        description:
          'note | sql | volume_path | link | table ({columns,rows} JSON) | chart (Vega-Lite v6 JSON, inline data.values only; prefer pin_chart for SQL results) | mermaid (diagram source: flowchart, sequenceDiagram, stateDiagram, classDiagram, erDiagram)',
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

  const body = readText(args.body);
  if (!body) {
    return { ok: false, error: 'pin_artifact requires body' };
  }
  const limit = ARTIFACT_BODY_LIMITS[kind];
  if (body.length > limit) {
    return {
      ok: false,
      error: `pin_artifact body is too long (${body.length} chars; max ${limit}). Put large content on a Volume and pin kind volume_path.`,
    };
  }
  if (kind === 'mermaid') {
    const checked = validateMermaidSource(body);
    if (!checked.ok) return { ok: false, error: `pin_artifact ${checked.error}` };
  }
  if (kind === 'chart' && body.startsWith('{')) {
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      if ('mark' in parsed || 'layer' in parsed) {
        const checked = validateVegaLiteSpec(parsed, { allowData: true });
        if (!checked.ok) return { ok: false, error: `pin_artifact ${checked.error}` };
      }
    } catch {
      return { ok: false, error: 'pin_artifact chart body must be valid JSON' };
    }
  }

  const summary = readText(args.summary) || undefined;
  return { ok: true, args: { title, kind, body, summary } };
}

export async function executePinArtifact(
  store: ChatStore,
  ctx: HandoffTurnContext,
  args: Record<string, unknown>
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
    })
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
