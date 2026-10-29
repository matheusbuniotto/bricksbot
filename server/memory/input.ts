export function requireBotId(botId: string): string {
  const trimmed = botId.trim();
  if (!trimmed) throw new Error('Bot id is required');
  return trimmed;
}

export function normalizeMemory(key: string, content: string): { key: string; content: string } {
  const trimmedKey = key.trim();
  const trimmedContent = content.trim();
  if (!trimmedKey) throw new Error('Memory key is required');
  if (!trimmedContent) throw new Error('Memory content is required');
  return { key: trimmedKey, content: trimmedContent };
}

export function normalizeSkill(name: string, body: string): { name: string; body: string } {
  const trimmedName = name.trim();
  const trimmedBody = body.trim();
  if (!trimmedName) throw new Error('Skill name is required');
  if (!trimmedBody) throw new Error('Skill body is required');
  return { name: trimmedName, body: trimmedBody };
}
