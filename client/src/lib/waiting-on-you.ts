// Cards for a bot's routine and handoff chats ride along on the user's chat, but only this chat's own cards hold the composer.
export function isWaitingOnYou(
  chatId: string | undefined,
  approvals: { chatId: string }[],
  choices: { chatId: string }[]
): boolean {
  return [...approvals, ...choices].some((item) => item.chatId === chatId);
}
