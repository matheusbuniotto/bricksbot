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
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!('kind' in parsed) || parsed.kind !== 'bot_created') return null;
    if (!('name' in parsed) || typeof parsed.name !== 'string' || !parsed.name) return null;
    if (!('botId' in parsed) || typeof parsed.botId !== 'string' || !parsed.botId) return null;
    return {
      kind: 'bot_created',
      botId: parsed.botId,
      name: parsed.name,
      chatId: 'chatId' in parsed && typeof parsed.chatId === 'string' ? parsed.chatId : '',
      spaceId: 'spaceId' in parsed && typeof parsed.spaceId === 'string' ? parsed.spaceId : null,
      job: 'job' in parsed && typeof parsed.job === 'string' ? parsed.job : undefined,
      createdByBotId:
        'createdByBotId' in parsed && typeof parsed.createdByBotId === 'string'
          ? parsed.createdByBotId
          : undefined,
      createdByName:
        'createdByName' in parsed && typeof parsed.createdByName === 'string'
          ? parsed.createdByName
          : undefined,
    };
  } catch {
    return null;
  }
}
