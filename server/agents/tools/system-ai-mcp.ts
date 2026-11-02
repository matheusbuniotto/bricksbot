import type { ToolDefinition } from '../../../shared/agents/types.js';
import type {
  GenieAskResult,
  GenieCitation,
  GenieStatus,
  SystemAiMcpOptions,
} from '../../../shared/agents/mcp-types.js';
import type { HandoffTurnContext } from '../handoff.js';
import { UnityGatewayMcpClient } from './mcp-client.js';

export const GENIE_ASK_TOOL_NAME = 'genie_ask';
export const GENIE_POLL_TOOL_NAME = 'genie_poll_response';
export const GENIE_GET_QUERY_RESULT_TOOL_NAME = 'genie_get_query_result';
export const GENIE_CANCEL_TOOL_NAME = 'genie_cancel_response';

export const DEFAULT_GENIE_SERVICE_NAME = 'system.ai.genie_one_mcp';

export interface RegisteredTool {
  definition: ToolDefinition;
  preflight?: (args: Record<string, unknown>, ctx: HandoffTurnContext) => string | null | Promise<string | null>;
  execute(args: Record<string, unknown>, ctx: HandoffTurnContext): Promise<string>;
}

export const genieAskToolDefinition: ToolDefinition = {
  name: GENIE_ASK_TOOL_NAME,
  description:
    'Ask a natural language analytics question to Databricks One / Genie. Grounded in the workspace Genie Ontology. Incurs compute cost; always requires user approval.',
  parameters: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'Natural language question or request for Genie analytics',
      },
      conversation_id: {
        type: 'string',
        description: 'Optional ID of an existing conversation to continue',
      },
      auto_poll: {
        type: 'boolean',
        description: 'Whether to poll until completion (default true). Set false to return in_progress immediately.',
      },
    },
    required: ['question'],
  },
};

export const geniePollToolDefinition: ToolDefinition = {
  name: GENIE_POLL_TOOL_NAME,
  description: 'Poll an in-flight Genie question for status, answer, and SQL query.',
  parameters: {
    type: 'object',
    properties: {
      conversation_id: {
        type: 'string',
        description: 'Genie conversation ID',
      },
      response_id: {
        type: 'string',
        description: 'Genie response ID',
      },
    },
    required: ['conversation_id', 'response_id'],
  },
};

export const genieGetQueryResultToolDefinition: ToolDefinition = {
  name: GENIE_GET_QUERY_RESULT_TOOL_NAME,
  description: 'Retrieve tabular query results from a completed Genie response.',
  parameters: {
    type: 'object',
    properties: {
      conversation_id: {
        type: 'string',
        description: 'Genie conversation ID',
      },
      response_id: {
        type: 'string',
        description: 'Genie response ID',
      },
    },
    required: ['conversation_id', 'response_id'],
  },
};

export const genieCancelToolDefinition: ToolDefinition = {
  name: GENIE_CANCEL_TOOL_NAME,
  description: 'Cancel an in-flight Genie response execution.',
  parameters: {
    type: 'object',
    properties: {
      conversation_id: {
        type: 'string',
        description: 'Genie conversation ID',
      },
      response_id: {
        type: 'string',
        description: 'Genie response ID',
      },
    },
    required: ['conversation_id', 'response_id'],
  },
};

function safeParseJson(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Non-JSON content
  }
  return null;
}

interface GeniePollPayload {
  status?: string;
  answer?: string;
  query?: string;
  citations?: GenieCitation[];
  error?: string | { message?: string };
}

export function systemAiMcpConfigFromEnv(env: Record<string, string | undefined>): SystemAiMcpOptions | undefined {
  const isEnabled =
    env.DATABRICKS_GENIE_ENABLED?.trim().toLowerCase() === 'true' ||
    env.DATABRICKS_ONE_ENABLED?.trim().toLowerCase() === 'true' ||
    env.SYSTEM_AI_MCPS?.trim().toLowerCase() === 'true' ||
    env.SYSTEM_AI_MCPS?.trim().toLowerCase().includes('genie');

  if (!isEnabled) {
    return undefined;
  }

  const host = env.DATABRICKS_HOST?.trim() || env.DATABRICKS_WORKSPACE_URL?.trim() || '';
  const token = env.DATABRICKS_TOKEN?.trim();
  const workspaceId = env.DATABRICKS_WORKSPACE_ID?.trim();
  const maxPollSeconds = env.GENIE_MAX_POLL_SECONDS ? Number.parseInt(env.GENIE_MAX_POLL_SECONDS, 10) : undefined;

  return {
    enabled: true,
    host,
    getToken: token ? () => Promise.resolve(token) : undefined,
    workspaceId: workspaceId || undefined,
    maxPollSeconds: Number.isFinite(maxPollSeconds) ? maxPollSeconds : undefined,
  };
}

export function createSystemAiMcpTools(options: SystemAiMcpOptions = {}): RegisteredTool[] {
  if (options.enabled === false) {
    return [];
  }

  const client = new UnityGatewayMcpClient({
    host: options.host ?? '',
    getToken: options.getToken,
    workspaceId: options.workspaceId,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
  });

  const serviceName = options.serviceName ?? DEFAULT_GENIE_SERVICE_NAME;
  const maxPollSeconds = options.maxPollSeconds ?? 20;
  const pollIntervalMs = options.pollIntervalMs ?? 1000;

  const genieAsk: RegisteredTool = {
    definition: genieAskToolDefinition,
    preflight(args: Record<string, unknown>): string | null {
      const question = typeof args.question === 'string' ? args.question.trim() : '';
      if (!question) {
        return 'genie_ask requires a question';
      }
      return null;
    },
    async execute(args: Record<string, unknown>): Promise<string> {
      const question = typeof args.question === 'string' ? args.question.trim() : '';
      if (!question) {
        return 'genie_ask error: question is required';
      }
      const conversationIdArg =
        typeof args.conversation_id === 'string' && args.conversation_id.trim()
          ? args.conversation_id.trim()
          : undefined;
      const autoPoll = args.auto_poll !== false;

      let initialResult: Awaited<ReturnType<typeof client.callTool>>;
      try {
        initialResult = await client.callTool(serviceName, 'genie_ask', {
          question,
          ...(conversationIdArg ? { conversation_id: conversationIdArg } : {}),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Tool call failed';
        return `genie_ask error: ${message}`;
      }

      if (initialResult.isError) {
        const errorText = initialResult.content[0]?.text ?? 'Unknown error from Genie';
        return `genie_ask error: ${errorText}`;
      }

      const initialText = initialResult.content[0]?.text ?? '';
      const parsedInitial = safeParseJson(initialText);

      const conversationId =
        typeof parsedInitial?.conversation_id === 'string' ? parsedInitial.conversation_id : (conversationIdArg ?? '');
      const responseId = typeof parsedInitial?.response_id === 'string' ? parsedInitial.response_id : '';

      if (!autoPoll || !conversationId || !responseId) {
        return initialText || JSON.stringify({ conversation_id: conversationId, response_id: responseId });
      }

      // Auto-polling loop
      const startTime = Date.now();
      const maxMs = maxPollSeconds * 1000;

      while (Date.now() - startTime < maxMs) {
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));

        let pollRes: Awaited<ReturnType<typeof client.callTool>>;
        try {
          pollRes = await client.callTool(serviceName, 'genie_poll_response', {
            conversation_id: conversationId,
            response_id: responseId,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Polling failed';
          return `genie_ask polling error: ${message}`;
        }

        const pollText = pollRes.content[0]?.text ?? '';
        const pollPayload = safeParseJson(pollText) as GeniePollPayload | null;

        const status = (typeof pollPayload?.status === 'string' ? pollPayload.status.toLowerCase() : '') as
          | GenieStatus
          | '';

        if (status === 'completed') {
          const result: GenieAskResult = {
            conversation_id: conversationId,
            response_id: responseId,
            status: 'completed',
            answer: typeof pollPayload?.answer === 'string' ? pollPayload.answer : undefined,
            query: typeof pollPayload?.query === 'string' ? pollPayload.query : undefined,
            citations: Array.isArray(pollPayload?.citations) ? pollPayload.citations : undefined,
          };
          return JSON.stringify(result, null, 2);
        }

        if (status === 'failed') {
          const errorMsg =
            typeof pollPayload?.error === 'object' && pollPayload.error !== null
              ? (pollPayload.error as { message?: string }).message
              : (pollPayload?.error ?? 'Genie response failed');
          const result: GenieAskResult = {
            conversation_id: conversationId,
            response_id: responseId,
            status: 'failed',
            error: String(errorMsg),
          };
          return JSON.stringify(result, null, 2);
        }

        if (status === 'cancelled') {
          const result: GenieAskResult = {
            conversation_id: conversationId,
            response_id: responseId,
            status: 'cancelled',
          };
          return JSON.stringify(result, null, 2);
        }
      }

      // Polling timed out
      const timeoutResult: GenieAskResult = {
        conversation_id: conversationId,
        response_id: responseId,
        status: 'in_progress',
        error: `Polling timed out after ${maxPollSeconds}s. The query is still running. Use genie_poll_response with conversation_id and response_id to check later.`,
      };
      return JSON.stringify(timeoutResult, null, 2);
    },
  };

  const geniePoll: RegisteredTool = {
    definition: geniePollToolDefinition,
    preflight(args: Record<string, unknown>): string | null {
      if (!args.conversation_id || !args.response_id) {
        return 'genie_poll_response requires conversation_id and response_id';
      }
      return null;
    },
    async execute(args: Record<string, unknown>): Promise<string> {
      try {
        const res = await client.callTool(serviceName, 'genie_poll_response', {
          conversation_id: String(args.conversation_id ?? ''),
          response_id: String(args.response_id ?? ''),
        });
        return res.content[0]?.text ?? JSON.stringify(res);
      } catch (err) {
        return `genie_poll_response error: ${err instanceof Error ? err.message : 'call failed'}`;
      }
    },
  };

  const genieGetQueryResult: RegisteredTool = {
    definition: genieGetQueryResultToolDefinition,
    preflight(args: Record<string, unknown>): string | null {
      if (!args.conversation_id || !args.response_id) {
        return 'genie_get_query_result requires conversation_id and response_id';
      }
      return null;
    },
    async execute(args: Record<string, unknown>): Promise<string> {
      try {
        const res = await client.callTool(serviceName, 'genie_get_query_result', {
          conversation_id: String(args.conversation_id ?? ''),
          response_id: String(args.response_id ?? ''),
        });
        return res.content[0]?.text ?? JSON.stringify(res);
      } catch (err) {
        return `genie_get_query_result error: ${err instanceof Error ? err.message : 'call failed'}`;
      }
    },
  };

  const genieCancel: RegisteredTool = {
    definition: genieCancelToolDefinition,
    preflight(args: Record<string, unknown>): string | null {
      if (!args.conversation_id || !args.response_id) {
        return 'genie_cancel_response requires conversation_id and response_id';
      }
      return null;
    },
    async execute(args: Record<string, unknown>): Promise<string> {
      try {
        const res = await client.callTool(serviceName, 'genie_cancel_response', {
          conversation_id: String(args.conversation_id ?? ''),
          response_id: String(args.response_id ?? ''),
        });
        return res.content[0]?.text ?? JSON.stringify(res);
      } catch (err) {
        return `genie_cancel_response error: ${err instanceof Error ? err.message : 'call failed'}`;
      }
    },
  };

  return [genieAsk, geniePoll, genieGetQueryResult, genieCancel];
}
