/** Structured choice prompt / answer notices in system message content. */

export interface ChoicePromptNotice {
  kind: 'choice_prompt';
  id: string;
  toolCallId: string;
  prompt: string;
  options: string[];
}

export interface ChoiceAnswerNotice {
  kind: 'choice_answer';
  choiceId: string;
  prompt: string;
  selectedOption: string;
}

/** Pending choice returned by API while the user has not picked yet. */
export interface PendingChoice {
  id: string;
  chatId: string;
  toolCallId: string;
  prompt: string;
  options: string[];
  createdAt: string;
}

export function serializeChoicePromptNotice(notice: ChoicePromptNotice): string {
  return JSON.stringify(notice);
}

export function parseChoicePromptNotice(content: string): ChoicePromptNotice | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed) as Partial<ChoicePromptNotice>;
    if (parsed.kind !== 'choice_prompt' || !parsed.id || !parsed.toolCallId) return null;
    const prompt = typeof parsed.prompt === 'string' ? parsed.prompt.trim() : '';
    if (!prompt) return null;
    const options = normalizeOptions(parsed.options);
    if (!options) return null;
    return {
      kind: 'choice_prompt',
      id: parsed.id,
      toolCallId: parsed.toolCallId,
      prompt,
      options,
    };
  } catch {
    return null;
  }
}

export function serializeChoiceAnswerNotice(notice: ChoiceAnswerNotice): string {
  return JSON.stringify(notice);
}

export function parseChoiceAnswerNotice(content: string): ChoiceAnswerNotice | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed) as Partial<ChoiceAnswerNotice>;
    if (parsed.kind !== 'choice_answer' || !parsed.choiceId) return null;
    const selectedOption = typeof parsed.selectedOption === 'string' ? parsed.selectedOption.trim() : '';
    if (!selectedOption) return null;
    const prompt = typeof parsed.prompt === 'string' ? parsed.prompt : '';
    return {
      kind: 'choice_answer',
      choiceId: parsed.choiceId,
      prompt,
      selectedOption,
    };
  } catch {
    return null;
  }
}

/** Transcript line after the user picks an option. */
export function choiceAnswerPreviewLine(notice: ChoiceAnswerNotice): string {
  return `Sua resposta: ${notice.selectedOption}`;
}

export function normalizeOptions(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const options = raw
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean);
  if (options.length < 2 || options.length > 5) return null;
  if (new Set(options).size !== options.length) return null;
  return options;
}

/** Map choiceId → selected option from answer notices in a message list. */
export function indexChoiceAnswers(
  messages: Array<{ role: string; content: string }>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const message of messages) {
    if (message.role !== 'system') continue;
    const answer = parseChoiceAnswerNotice(message.content);
    if (answer) map.set(answer.choiceId, answer.selectedOption);
  }
  return map;
}
