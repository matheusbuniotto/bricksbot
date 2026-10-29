import type { ChatClient, ChatCompletionRequest, ChatCompletionResult } from '../../shared/llm/types.js';

/** Fallback when no LLM env is configured — keeps Phase 1 UX working. */
export class StubChatClient implements ChatClient {
  readonly provider = 'stub' as const;

  async complete(request: ChatCompletionRequest): Promise<ChatCompletionResult> {
    const lastUser = [...request.messages].reverse().find((m) => m.role === 'user');
    const text = lastUser?.content?.trim() || '';
    return {
      content:
        `Received: “${text}”. ` +
        `No live model yet — set scope \`claw\` secret \`openrouter-api-key\` (same as clawhouse) ` +
        `or local OPENROUTER_API_KEY / LLM_API_KEY, then redeploy.`,
      toolCalls: [],
    };
  }
}
