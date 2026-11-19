import type { UpdateBotInput } from '../../shared/chat/types.js';

/** Naming rules shared by the Lakebase and in-memory ChatStore. */

export const PRIMARY_NAME = 'Primary';
export const DEFAULT_SPACE_NAME = 'Personal';
export const DEFAULT_CHAT_TITLE = 'New chat';

export function avatarFromName(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase();
}

const TITLE_MAX_LENGTH = 60;

/** A chat title from the first thing the user said: its first line, cut at a word. Empty when there is no text. */
export function titleFromMessage(content: string): string {
  const firstLine = content.split('\n').find((line) => line.trim()) ?? '';
  const text = firstLine
    .replace(/^[\s#>*-]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= TITLE_MAX_LENGTH) return text;
  const cut = text.slice(0, TITLE_MAX_LENGTH);
  const atWord = cut.lastIndexOf(' ');
  return `${(atWord > TITLE_MAX_LENGTH / 2 ? cut.slice(0, atWord) : cut).trimEnd()}…`;
}

/** Keep custom labels; regenerate the one-letter default when the name changes. */
export function updatedAvatarLabel(
  current: string,
  input: Pick<UpdateBotInput, 'name' | 'avatarLabel'>,
  name: string
): string {
  if (input.avatarLabel !== undefined) return input.avatarLabel.trim() || avatarFromName(name);
  if (input.name !== undefined && current.length === 1) return avatarFromName(name);
  return current;
}
