import type { UpdateBotInput } from '../../shared/chat/types.js';

/** Naming rules shared by the Lakebase and in-memory ChatStore. */

export const PRIMARY_NAME = 'Primary';
export const DEFAULT_SPACE_NAME = 'Personal';
export const DEFAULT_CHAT_TITLE = 'New chat';

export function avatarFromName(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase();
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
