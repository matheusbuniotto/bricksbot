import { ARTIFACT_BODY_LIMITS, serializeArtifactPinNotice } from '../../../shared/chat/artifact-pin-notice.js';
import { parseSqlQueryResult } from '../../../shared/chat/sql-result.js';
import { MAX_CHART_ROWS, VEGA_LITE_SCHEMA, validateVegaLiteSpec } from '../../../shared/chat/vega-spec.js';
import type { ChatStore } from '../../../shared/chat/types.js';
import type { ToolDefinition } from '../../../shared/agents/types.js';
import type { HandoffTurnContext } from '../handoff.js';
import { readText } from '../../lib/coerce.js';

export const PIN_CHART_TOOL_NAME = 'pin_chart';

export const pinChartToolDefinition: ToolDefinition = {
  name: PIN_CHART_TOOL_NAME,
  description:
    'Pin an interactive chart built from the rows of an earlier sql_query in this chat. ' +
    'Pass the sql_query tool call id and a Vega-Lite v5 spec WITHOUT data (mark + encoding only); ' +
    'field names must match the query column names. Aggregate in SQL first (GROUP BY / LIMIT). Never pin secrets.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: { type: 'string', description: 'Short label for the chart' },
      source_tool_call_id: {
        type: 'string',
        description: 'Tool call id of a successful earlier sql_query in this chat',
      },
      spec: {
        type: 'object',
        description: 'Vega-Lite v5 spec without data: mark and encoding (and optional layer/facet)',
      },
      summary: { type: 'string', description: 'Optional one-line preview' },
    },
    required: ['title', 'source_tool_call_id', 'spec'],
  },
};

type Planned =
  | { ok: true; title: string; sourceToolCallId: string; spec: Record<string, unknown>; summary?: string }
  | { ok: false; error: string };

export function planPinChart(args: Record<string, unknown>, bot: HandoffTurnContext['bot']): Planned {
  if (!bot) return { ok: false, error: 'pin_chart requires an active Bot' };
  const title = readText(args.title);
  if (!title) return { ok: false, error: 'pin_chart requires title' };
  const sourceToolCallId = readText(args.source_tool_call_id);
  if (!sourceToolCallId) return { ok: false, error: 'pin_chart requires source_tool_call_id' };
  const checked = validateVegaLiteSpec(args.spec, { allowData: false });
  if (!checked.ok) return { ok: false, error: `pin_chart ${checked.error}` };
  return {
    ok: true,
    title,
    sourceToolCallId,
    spec: checked.spec,
    summary: readText(args.summary) || undefined,
  };
}

export async function executePinChart(
  store: ChatStore,
  ctx: HandoffTurnContext,
  args: Record<string, unknown>
): Promise<string> {
  const planned = planPinChart(args, ctx.bot);
  if (!planned.ok) return planned.error;
  const bot = ctx.bot!;

  const messages = await store.listMessages(ctx.chatId);
  const assistantCall = messages.flatMap((m) => m.toolCalls ?? []).find((call) => call.id === planned.sourceToolCallId);
  if (!assistantCall || assistantCall.name !== 'sql_query') {
    return 'pin_chart source_tool_call_id must be the id of an earlier sql_query call in this chat';
  }
  const toolRow = messages.find((m) => m.role === 'tool' && m.toolCallId === planned.sourceToolCallId);
  if (!toolRow) return 'pin_chart: that sql_query has no result yet';

  const parsed = parseSqlQueryResult(toolRow.content);
  if (!parsed.ok) return `pin_chart ${parsed.error}`;
  if (parsed.rows.length > MAX_CHART_ROWS) {
    return `pin_chart: ${parsed.rows.length} rows is over the ${MAX_CHART_ROWS} row limit; aggregate in SQL (GROUP BY / LIMIT) and re-run`;
  }

  const body = JSON.stringify({
    $schema: VEGA_LITE_SCHEMA,
    ...planned.spec,
    data: { values: parsed.rows },
  });
  if (body.length > ARTIFACT_BODY_LIMITS.chart) {
    return `pin_chart: chart data is too large (${body.length} chars; max ${ARTIFACT_BODY_LIMITS.chart}); select fewer columns or rows`;
  }

  const message = await store.addMessage(
    ctx.chatId,
    'system',
    serializeArtifactPinNotice({
      kind: 'artifact_pin',
      title: planned.title,
      artifactKind: 'chart',
      body,
      summary: planned.summary,
      pinnedByBotId: bot.id,
      pinnedByName: bot.name,
    })
  );

  return JSON.stringify({ ok: true, title: planned.title, rows: parsed.rows.length, messageId: message.id });
}

export function createPinChartTool(store: ChatStore) {
  return {
    definition: pinChartToolDefinition,
    preflight(args: Record<string, unknown>, ctx: HandoffTurnContext): string | null {
      const planned = planPinChart(args, ctx.bot);
      return planned.ok ? null : planned.error;
    },
    execute(args: Record<string, unknown>, ctx: HandoffTurnContext): Promise<string> {
      return executePinChart(store, ctx, args);
    },
  };
}
