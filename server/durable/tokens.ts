import type { LlmMessage } from '../../shared/agents/types.js';
import type { Message } from '../../shared/chat/types.js';

/** Rough token estimate — ~4 chars/token; good enough for compaction thresholds. */
export function estimateTokensFromText(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function estimateMessageTokens(message: Pick<Message, 'role' | 'content' | 'toolCalls'>): number {
  let total = estimateTokensFromText(message.content) + 4;
  if (message.toolCalls?.length) {
    total += estimateTokensFromText(JSON.stringify(message.toolCalls));
  }
  return total;
}

export function estimateLlmTokens(messages: LlmMessage[]): number {
  return messages.reduce((sum, message) => {
    let total = estimateTokensFromText(message.content) + 4;
    if (message.toolCalls?.length) {
      total += estimateTokensFromText(JSON.stringify(message.toolCalls));
    }
    return sum + total;
  }, 0);
}
