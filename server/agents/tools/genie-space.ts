import type { ToolDefinition } from '../../../shared/agents/types.js';
import type { GenieAskResult } from '../../../shared/agents/mcp-types.js';
import { normalizeHostUrl } from '../../chat/databricks-auth.js';
import { clip, readText } from '../../lib/coerce.js';
import { presentEnv } from '../../lib/env.js';
import type { RegisteredTool } from './system-ai-mcp.js';

export const GENIE_SPACE_TOOL_NAME = 'ask_genie_space';

const TERMINAL_STATUSES = new Set(['COMPLETED', 'FAILED', 'CANCELLED', 'QUERY_RESULT_EXPIRED']);
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export interface GenieSpaceToolOptions {
  spaceId: string;
  host: string;
  /** Signed-in user's token (OBO); the same provider sql_query uses. */
  getToken: () => Promise<string>;
  fetchImpl?: typeof fetch;
  maxPollSeconds?: number;
  pollIntervalMs?: number;
  maxRows?: number;
  /** Counts one call against the user's daily Genie cap; false refuses it. Absent means uncapped. */
  claimCall?: (userId: string | undefined) => Promise<boolean>;
}

/** GenieAskResult plus the first rows of Genie's query, so the model can quote numbers. */
interface GenieSpaceResult extends GenieAskResult {
  columns?: string[];
  rows?: unknown[][];
  row_count?: number;
}

interface GenieAttachment {
  attachment_id?: string;
  text?: { content?: string };
  query?: { query?: string; description?: string; statement_id?: string };
}

interface GenieMessage {
  status?: string;
  attachments?: GenieAttachment[];
  error?: { error?: string; message?: string };
}

export const genieSpaceToolDefinition: ToolDefinition = {
  name: GENIE_SPACE_TOOL_NAME,
  description:
    'Ask the one Genie space this install is connected to a business question (metric definitions, KPIs). ' +
    'Prefer sql_query / lakehouse_catalog for known tables. Runs as the signed-in user, incurs Genie and warehouse compute, always requires user approval. ' +
    'Show the user the answer, the generated SQL in a ```sql block, and the source link.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      question: { type: 'string', description: 'Natural language question for the Genie space' },
      conversation_id: {
        type: 'string',
        description: 'Optional Genie conversation id from an earlier answer, to ask a follow-up',
      },
    },
    required: ['question'],
  },
};

/**
 * Registered only when a space id is configured and the workspace host is known.
 * `BRICKSBOT_GENIE_ENABLED=false` switches it off without touching the space id.
 */
export function genieSpaceConfigFromEnv(
  env: Record<string, string | undefined>,
  base: { host?: string; getToken?: () => Promise<string> }
): GenieSpaceToolOptions | undefined {
  const spaceId = presentEnv(env.BRICKSBOT_GENIE_SPACE_ID);
  if (/^(false|0|off|no)$/i.test(presentEnv(env.BRICKSBOT_GENIE_ENABLED) ?? '')) return undefined;
  if (!spaceId || !base.host || !base.getToken) return undefined;
  return { spaceId, host: base.host, getToken: base.getToken };
}

export function createGenieSpaceTool(options: GenieSpaceToolOptions): RegisteredTool {
  const host = normalizeHostUrl(options.host);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const maxPollMs = (options.maxPollSeconds ?? 60) * 1000;
  const pollIntervalMs = options.pollIntervalMs ?? 1000;
  const maxRows = options.maxRows ?? 25;
  const spacePath = `/api/2.0/genie/spaces/${encodeURIComponent(options.spaceId)}`;

  async function genie<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await fetchImpl(`${host}${spacePath}${path}`, {
      method,
      headers: { Authorization: `Bearer ${await options.getToken()}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Genie API ${res.status}: ${clip(text, 500)}`);
    return JSON.parse(text) as T;
  }

  async function pollMessage(conversationId: string, messageId: string): Promise<GenieMessage | null> {
    const path = `/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`;
    const deadline = Date.now() + maxPollMs;
    while (Date.now() < deadline) {
      const message = await genie<GenieMessage>('GET', path);
      if (TERMINAL_STATUSES.has(message.status ?? '')) return message;
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    return null;
  }

  async function queryRows(conversationId: string, messageId: string, attachmentId: string) {
    const path = `/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}/query-result`;
    const { statement_response: statement } = await genie<{
      statement_response?: {
        manifest?: { schema?: { columns?: Array<{ name?: string }> }; total_row_count?: number };
        result?: { data_array?: unknown[][] };
      };
    }>('GET', path);
    const data = statement?.result?.data_array ?? [];
    return {
      columns: (statement?.manifest?.schema?.columns ?? []).map((column) => column.name ?? ''),
      rows: data.slice(0, maxRows),
      row_count: statement?.manifest?.total_row_count ?? data.length,
    };
  }

  return {
    definition: genieSpaceToolDefinition,
    preflight(args) {
      if (!readText(args.question)) return `${GENIE_SPACE_TOOL_NAME} requires a question`;
      const conversationId = readText(args.conversation_id);
      if (conversationId && !ID_PATTERN.test(conversationId))
        return `${GENIE_SPACE_TOOL_NAME}: invalid conversation_id`;
      return null;
    },
    async execute(args, ctx) {
      const question = readText(args.question);
      if (!question) return `${GENIE_SPACE_TOOL_NAME} error: question is required`;
      const followUp = readText(args.conversation_id);
      if (followUp && !ID_PATTERN.test(followUp)) return `${GENIE_SPACE_TOOL_NAME} error: invalid conversation_id`;

      // Inside the try: a ledger error must come back as a tool result, not leave the model's tool call unanswered.
      try {
        if (options.claimCall && !(await options.claimCall(ctx.userId))) {
          return `${GENIE_SPACE_TOOL_NAME} error: the daily Genie limit is used up. It resets at 00:00 UTC.`;
        }
        const started = await genie<{ conversation_id?: string; message_id?: string; id?: string }>(
          'POST',
          followUp ? `/conversations/${encodeURIComponent(followUp)}/messages` : '/start-conversation',
          { content: question }
        );
        const conversationId = started.conversation_id ?? followUp;
        const messageId = started.message_id ?? started.id ?? '';
        if (!conversationId || !messageId) return `${GENIE_SPACE_TOOL_NAME} error: Genie returned no message id`;

        const result: GenieSpaceResult = {
          conversation_id: conversationId,
          response_id: messageId,
          status: 'in_progress',
        };
        const message = await pollMessage(conversationId, messageId);
        if (!message) {
          result.error = `Genie is still working after ${options.maxPollSeconds ?? 60}s. Ask again later or rephrase.`;
          return JSON.stringify(result, null, 2);
        }
        if (message.status === 'CANCELLED') return JSON.stringify({ ...result, status: 'cancelled' }, null, 2);
        if (message.status !== 'COMPLETED') {
          const reason = message.error?.error ?? message.error?.message ?? message.status ?? 'unknown';
          return JSON.stringify({ ...result, status: 'failed', error: `Genie response failed: ${reason}` }, null, 2);
        }

        const attachments = message.attachments ?? [];
        const sql = attachments.find((attachment) => attachment.query?.query);
        result.status = 'completed';
        result.answer =
          attachments.find((attachment) => attachment.text?.content)?.text?.content ?? sql?.query?.description;
        result.query = sql?.query?.query;
        result.citations = [
          {
            title: 'Genie space',
            url: `${host}/genie/rooms/${encodeURIComponent(options.spaceId)}/chats/${encodeURIComponent(conversationId)}`,
            description: sql?.query?.description,
          },
        ];
        if (sql?.attachment_id) {
          try {
            Object.assign(result, await queryRows(conversationId, messageId, sql.attachment_id));
          } catch (err) {
            // The answer and SQL are still useful when the rows have expired.
            result.error = `Query result unavailable: ${err instanceof Error ? err.message : 'request failed'}`;
          }
        }
        return clip(JSON.stringify(result, null, 2), 20_000);
      } catch (err) {
        return `${GENIE_SPACE_TOOL_NAME} error: ${err instanceof Error ? err.message : 'request failed'}`;
      }
    },
  };
}
