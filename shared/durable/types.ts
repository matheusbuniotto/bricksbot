/** Pi-compatible durable harness types (thin BricksBot landing). */

export interface CompactionRecord {
  id: string;
  chatId: string;
  summary: string;
  /** First message id retained verbatim in the model window after the summary. */
  keepFromMessageId: string;
  createdAt: string;
}

export interface CompactionSettings {
  /** Assumed model context window in tokens. */
  contextWindow: number;
  /** Tokens reserved for the next reply + tools (Pi `reserveTokens`). */
  reserveTokens: number;
  /** Minimum recent messages always kept after a summary. */
  keepRecentMessages: number;
}

export const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
  contextWindow: 128_000,
  reserveTokens: 16_384,
  keepRecentMessages: 24,
};

export interface CompactionStore {
  getLatest(chatId: string): Promise<CompactionRecord | null>;
  save(input: {
    chatId: string;
    summary: string;
    keepFromMessageId: string;
  }): Promise<CompactionRecord>;
}

export interface IdempotencyRecord {
  requestId: string;
  chatId: string;
  resultJson: string;
  createdAt: string;
}

export interface IdempotencyStore {
  get(requestId: string): Promise<IdempotencyRecord | null>;
  put(requestId: string, chatId: string, resultJson: string): Promise<void>;
}
