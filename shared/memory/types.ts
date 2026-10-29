/** Per-bot memory facts and reusable skill documents. */

export interface BotMemory {
  id: string;
  botId: string;
  key: string;
  content: string;
  updatedAt: string;
}

export interface BotSkill {
  id: string;
  botId: string;
  name: string;
  /** Markdown skill document injected into the bot's chat context. */
  body: string;
  createdAt: string;
}

export interface MemorySkillStore {
  listMemories(botId: string): Promise<BotMemory[]>;
  upsertMemory(botId: string, key: string, content: string): Promise<BotMemory>;
  listSkills(botId: string): Promise<BotSkill[]>;
  createSkill(botId: string, name: string, body: string): Promise<BotSkill>;
  deleteSkill(botId: string, skillId: string): Promise<void>;
}
