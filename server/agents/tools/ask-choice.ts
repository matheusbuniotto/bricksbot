import type { ToolDefinition } from '../../../shared/agents/types.js';
import { normalizeOptions } from '../../../shared/chat/choice-notice.js';
import type { HandoffTurnContext } from '../handoff.js';

export const ASK_CHOICE_TOOL_NAME = 'ask_choice';

export const askChoiceToolDefinition: ToolDefinition = {
  name: ASK_CHOICE_TOOL_NAME,
  description:
    'Ask the user to pick one option (2–5 choices). Use when a decision must come from the user before continuing. ' +
    'The turn blocks until they select; the choice is stored in the transcript as “Sua resposta”.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      prompt: { type: 'string', description: 'Short question shown with the options' },
      options: {
        type: 'array',
        items: { type: 'string' },
        minItems: 2,
        maxItems: 5,
        description: '2–5 distinct option labels',
      },
    },
    required: ['prompt', 'options'],
  },
};

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

type Planned = { ok: true; prompt: string; options: string[] } | { ok: false; error: string };

export function planAskChoice(args: Record<string, unknown>): Planned {
  const prompt = readText(args.prompt);
  if (!prompt) {
    return { ok: false, error: 'ask_choice requires prompt' };
  }
  const options = normalizeOptions(args.options);
  if (!options) {
    return {
      ok: false,
      error: 'ask_choice options must be 2–5 unique non-empty strings',
    };
  }
  return { ok: true, prompt, options };
}

export function createAskChoiceTool() {
  return {
    definition: askChoiceToolDefinition,
    preflight(args: Record<string, unknown>, ctx: HandoffTurnContext): string | null {
      if (!ctx.bot) {
        return 'ask_choice requires an active Bot';
      }
      const planned = planAskChoice(args);
      return planned.ok ? null : planned.error;
    },
    /** Real execution posts the choice UI via ChatService.beginPendingChoice — not here. */
    execute(): Promise<string> {
      return Promise.resolve(
        JSON.stringify({
          error: 'ask_choice must be completed by the user in the choice UI',
          tool: ASK_CHOICE_TOOL_NAME,
        })
      );
    },
  };
}
