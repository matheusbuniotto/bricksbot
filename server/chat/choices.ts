import { randomUUID } from 'node:crypto';
import type { PendingChoice } from '../../shared/chat/choice-notice.js';

export type { PendingChoice };

export interface CreatePendingChoiceInput {
  chatId: string;
  toolCallId: string;
  prompt: string;
  options: string[];
}

/** In-memory pending choices (block turn until user picks). */
export class ChoiceStore {
  private readonly byId = new Map<string, PendingChoice>();

  create(input: CreatePendingChoiceInput): PendingChoice {
    const choice: PendingChoice = {
      id: randomUUID(),
      chatId: input.chatId,
      toolCallId: input.toolCallId,
      prompt: input.prompt,
      options: [...input.options],
      createdAt: new Date().toISOString(),
    };
    this.byId.set(choice.id, choice);
    return choice;
  }

  get(id: string): PendingChoice | null {
    return this.byId.get(id) ?? null;
  }

  listPending(chatId: string): PendingChoice[] {
    return [...this.byId.values()]
      .filter((choice) => choice.chatId === chatId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  answer(id: string, selectedOption: string): PendingChoice {
    const existing = this.byId.get(id);
    if (!existing) {
      throw new Error('Choice not found');
    }
    if (!existing.options.includes(selectedOption)) {
      throw new Error('Invalid option');
    }
    this.byId.delete(id);
    return existing;
  }
}
