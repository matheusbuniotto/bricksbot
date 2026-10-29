/** Structured “bot created” notice stored in system message content. */

export interface BotCreatedNotice {
  kind: 'bot_created';
  botId: string;
  name: string;
  chatId: string;
  spaceId: string | null;
  job?: string;
  createdByBotId?: string;
  createdByName?: string;
}

export function serializeBotCreatedNotice(notice: BotCreatedNotice): string {
  return JSON.stringify(notice);
}

export function parseBotCreatedNotice(content: string): BotCreatedNotice | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed) as Partial<BotCreatedNotice>;
    if (parsed.kind !== 'bot_created' || !parsed.name || !parsed.botId) return null;
    return {
      kind: 'bot_created',
      botId: parsed.botId,
      name: parsed.name,
      chatId: typeof parsed.chatId === 'string' ? parsed.chatId : '',
      spaceId: typeof parsed.spaceId === 'string' ? parsed.spaceId : null,
      job: typeof parsed.job === 'string' ? parsed.job : undefined,
      createdByBotId: typeof parsed.createdByBotId === 'string' ? parsed.createdByBotId : undefined,
      createdByName: typeof parsed.createdByName === 'string' ? parsed.createdByName : undefined,
    };
  } catch {
    return null;
  }
}
