/** Deep links to a chat live in the hash, so the server needs no catch-all route for them. */

export function chatRoute(botId: string, chatId: string): string {
  return `#/bots/${encodeURIComponent(botId)}/chats/${encodeURIComponent(chatId)}`;
}

/** `#/bots/:botId` or `#/bots/:botId/chats/:chatId`; anything else is not a chat link. */
export function parseChatRoute(hash: string): { botId: string; chatId?: string } | null {
  const match = /^#\/bots\/([^/]+)(?:\/chats\/([^/]+))?$/.exec(hash);
  if (!match) return null;
  return { botId: decodeURIComponent(match[1]), chatId: match[2] ? decodeURIComponent(match[2]) : undefined };
}
