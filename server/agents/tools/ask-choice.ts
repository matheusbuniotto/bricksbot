import type { ToolDefinition } from '../../../shared/agents/types.js';
import { normalizeOptions } from '../../../shared/chat/choice-notice.js';
import type { HandoffTurnContext } from '../handoff.js';
import { readText } from '../../lib/coerce.js';

export const ASK_CHOICE_TOOL_NAME = 'ask_choice';

export const askChoiceToolDefinition: ToolDefinition = {
  name: ASK_CHOICE_TOOL_NAME,
  description:
    'Ask the user to pick one option (2–5 choices). Use only for genuine ambiguity between options the user must decide. ' +
    'Never use it to confirm an action (Proceed? Yes/No): Ask-first tools already show an approval card, so just call the tool. ' +
    'The turn blocks until they select; the choice is stored in the transcript as “Your answer”.',
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

const CONFIRMATION_LABELS = new Set(['yes', 'no', 'proceed', 'cancel', 'confirm', 'ok', 'go ahead', 'sure']);

const isPlainConfirmation = (options: string[]) =>
  options.every((option) =>
    CONFIRMATION_LABELS.has(
      option
        .toLowerCase()
        .replace(/[^a-z ]/g, '')
        .trim()
    )
  );

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
  if (isPlainConfirmation(options)) {
    return {
      ok: false,
      error: 'ask_choice is not for yes/no confirmation; call the action tool directly and the user approves it there',
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
