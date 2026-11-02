import type { Message } from '../../shared/chat/types.js';
import type { CompactionRecord, CompactionSettings, CompactionStore } from '../../shared/durable/types.js';
import { DEFAULT_COMPACTION_SETTINGS } from '../../shared/durable/types.js';
import type { ChatClient, LlmMessage } from '../../shared/agents/types.js';
import { estimateMessageTokens, estimateTokensFromText } from './tokens.js';

/** Marker prefix for optional UI system notes (full history stays in messages). */
export const COMPACTION_NOTICE_PREFIX = '[[bricksbot.compaction]]';

export function findKeepFromIndex(history: Message[], keepFromMessageId: string): number {
  const index = history.findIndex((message) => message.id === keepFromMessageId);
  return index >= 0 ? index : 0;
}

/**
 * Slice history for the model: optional compaction summary + messages from keepFrom.
 * Preserves OpenAI tool_call pairing by never cutting mid assistant/tool cluster when possible.
 */
export function applyCompactionToHistory(
  history: Message[],
  compaction: CompactionRecord | null
): { messages: Message[]; summarySystem: string | null } {
  if (!compaction) return { messages: history, summarySystem: null };
  let keepFrom = findKeepFromIndex(history, compaction.keepFromMessageId);
  // Walk back so we don't orphan tool results without their assistant tool_calls.
  while (keepFrom > 0 && history[keepFrom]?.role === 'tool') {
    keepFrom -= 1;
  }
  const summarySystem = `Conversation summary (older turns compacted; full history retained in storage):\n${compaction.summary}`;
  return { messages: history.slice(keepFrom), summarySystem };
}

export function shouldCompact(
  history: Message[],
  systemPrompt: string,
  settings: CompactionSettings = DEFAULT_COMPACTION_SETTINGS
): boolean {
  const budget = settings.contextWindow - settings.reserveTokens;
  if (budget <= 0) return false;
  const used =
    estimateTokensFromText(systemPrompt) + history.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
  return used > budget;
}

export function pickKeepFromMessage(history: Message[], keepRecentMessages: number): Message | null {
  if (history.length === 0) return null;
  const keep = Math.max(1, keepRecentMessages);
  // Prefer starting on a user turn near the tail.
  const start = Math.max(0, history.length - keep);
  for (let i = start; i < history.length; i += 1) {
    if (history[i]?.role === 'user') return history[i]!;
  }
  return history[start] ?? history[history.length - 1]!;
}

export async function runCompaction(options: {
  chatId: string;
  history: Message[];
  client: ChatClient;
  store: CompactionStore;
  settings?: CompactionSettings;
  instructions?: string;
}): Promise<CompactionRecord | null> {
  const settings = options.settings ?? DEFAULT_COMPACTION_SETTINGS;
  const keepMessage = pickKeepFromMessage(options.history, settings.keepRecentMessages);
  if (!keepMessage) return null;

  const keepIndex = findKeepFromIndex(options.history, keepMessage.id);
  if (keepIndex <= 2) return null; // nothing meaningful to summarize

  const older = options.history.slice(0, keepIndex);
  const transcript = older
    .filter((message) => message.role === 'user' || message.role === 'assistant' || message.role === 'tool')
    .map((message) => {
      const body = message.content.slice(0, 2_000);
      if (message.role === 'tool') return `tool(${message.toolCallId ?? '?'}): ${body}`;
      return `${message.role}: ${body}`;
    })
    .join('\n');

  const instructions =
    options.instructions?.trim() ||
    'Preserve durable facts, decisions, open tasks, approvals, and tool outcomes. Drop chit-chat.';

  const prompt: LlmMessage[] = [
    {
      role: 'system',
      content:
        'You compress older chat turns into a durable summary for a continuing agent. Output plain prose bullets. Do not invent facts.',
    },
    {
      role: 'user',
      content: `${instructions}\n\n---\n${transcript.slice(0, 100_000)}`,
    },
  ];

  const completion = await options.client.complete({ messages: prompt });
  const summary = completion.content?.trim();
  if (!summary) return null;

  return options.store.save({
    chatId: options.chatId,
    summary,
    keepFromMessageId: keepMessage.id,
  });
}
