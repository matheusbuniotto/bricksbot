/** Per-bot memory facts and reusable skill documents. */

export interface BotMemory {
  id: string;
  botId: string;
  userId?: string;
  key: string;
  content: string;
  updatedAt: string;
}

export interface BotSkill {
  id: string;
  botId: string;
  name: string;
  /** Markdown skill body. Prompt shows name + description; full body via activate_skill. */
  body: string;
  createdAt: string;
}

export interface MemorySkillStore {
  listMemories(botId: string, userId?: string): Promise<BotMemory[]>;
  upsertMemory(botId: string, key: string, content: string, userId?: string): Promise<BotMemory>;
  deleteMemory(botId: string, key: string, userId?: string): Promise<void>;
  listSkills(botId: string): Promise<BotSkill[]>;
  listSkillNamesForBots(botIds: string[]): Promise<Map<string, string[]>>;
  createSkill(botId: string, name: string, body: string): Promise<BotSkill>;
  /** Upsert by name — used by save_skill for auto-improvement. */
  upsertSkill(botId: string, name: string, body: string): Promise<BotSkill>;
  deleteSkill(botId: string, skillId: string): Promise<void>;
  cloneSkills(sourceBotId: string, targetBotId: string): Promise<void>;
  evictBot?(botId: string): void;
}
