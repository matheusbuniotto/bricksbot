import type {
  ChatClient,
  ChatCompletionOptions,
  ChatCompletionRequest,
  ChatCompletionResult,
} from '../../shared/agents/types.js';
import type { ModelCatalog } from '../agents/models.js';
import { costOf } from './pricing.js';
import type { LlmUsageRecord, UsageStore } from './usage-store.js';

/**
 * Records one ledger row per completed call that carries an attribution (turns and compaction).
 * If the ledger is down, interactive calls carry on and a routine call fails: no routine
 * runs unmetered.
 */
export class MeteredChatClient implements ChatClient {
  constructor(
    private readonly inner: ChatClient,
    private readonly usage: UsageStore,
    private readonly catalog: ModelCatalog,
    private readonly warn: (message: string, err: unknown) => void = console.warn
  ) {}

  get provider(): ChatClient['provider'] {
    return this.inner.provider;
  }

  get model(): string | undefined {
    return this.inner.model;
  }

  async complete(request: ChatCompletionRequest, options?: ChatCompletionOptions): Promise<ChatCompletionResult> {
    const result = await this.inner.complete(request, options);
    const { attribution } = options ?? {};
    if (!attribution) return result;

    const requested = request.model ?? this.inner.model;
    const { usd, source } = costOf(result.usage, requested ? this.catalog.get(requested) : undefined);
    const { routine, ...scope } = attribution;
    const entry = {
      ...scope,
      model: result.model ?? requested ?? this.inner.provider,
      provider: this.inner.provider,
      promptTokens: result.usage?.promptTokens ?? 0,
      completionTokens: result.usage?.completionTokens ?? 0,
      cachedTokens: result.usage?.cachedTokens ?? 0,
      reasoningTokens: result.usage?.reasoningTokens ?? 0,
      costUsd: usd,
      costSource: source,
    };
    try {
      await this.record(entry, routine ? 2 : 1);
    } catch (err) {
      this.warn('[bricksbot] Usage ledger write failed', err);
      if (routine) throw new Error('Usage ledger unavailable; routine call not accepted');
    }
    return result;
  }

  // A routine call is thrown away when the ledger is down, and the provider was already paid: try the write twice first.
  private async record(entry: LlmUsageRecord, attempts: number): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.usage.record(entry);
      } catch (err) {
        if (attempt >= attempts) throw err;
      }
    }
  }
}
