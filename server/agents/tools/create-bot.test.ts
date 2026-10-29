import { describe, expect, test } from 'vitest';
import { MemoryChatStore } from '../../chat/memory-store.js';
import { MemoryMemorySkillStore } from '../memory/memory-store.js';
import {
  CREATE_BOT_TOOL_NAME,
  executeCreateBot,
  planCreateBot,
} from './create-bot.js';

describe('create_bot', () => {
  test('Primary plans and creates a bot with job memory and greeting', async () => {
    const store = new MemoryChatStore();
    const memory = new MemoryMemorySkillStore();
    const primary = await store.ensurePrimaryBot();
    const chat = await store.getOrCreateChatForBot(primary.id);

    const planned = await planCreateBot(store, primary, {
      name: 'Revenue',
      job: 'Own weekly revenue review. Ask before contacting customers.',
    });
    expect(planned.ok).toBe(true);

    const result = await executeCreateBot(
      store,
      memory,
      primary,
      chat.id,
      {
        name: 'Revenue',
        job: 'Own weekly revenue review. Ask before contacting customers.',
      },
    );
    const parsed = JSON.parse(result) as {
      ok: boolean;
      tool: string;
      bot_id: string;
      name: string;
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.tool).toBe(CREATE_BOT_TOOL_NAME);
    expect(parsed.name).toBe('Revenue');

    const bot = await store.getBot(parsed.bot_id);
    expect(bot?.spaceId).toBe(primary.spaceId);
    expect(bot?.isPrimary).toBe(false);

    const memories = await memory.listMemories(parsed.bot_id);
    expect(memories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'job',
          content: 'Own weekly revenue review. Ask before contacting customers.',
        }),
      ]),
    );

    const newChat = await store.getOrCreateChatForBot(parsed.bot_id);
    const newMessages = await store.listMessages(newChat.id);
    expect(newMessages[0]?.role).toBe('assistant');
    expect(newMessages[0]?.content).toContain("I'm Revenue");

    const source = await store.listMessages(chat.id);
    const notice = source.find((message) => message.role === 'system');
    expect(notice).toBeTruthy();
    expect(JSON.parse(notice!.content)).toEqual(
      expect.objectContaining({
        kind: 'bot_created',
        botId: parsed.bot_id,
        name: 'Revenue',
      }),
    );
  });

  test('non-Primary cannot create bots', async () => {
    const store = new MemoryChatStore();
    const primary = await store.ensurePrimaryBot();
    const analyst = await store.createBot({
      name: 'Analyst',
      ownerId: primary.ownerId,
      spaceId: primary.spaceId,
    });
    const planned = await planCreateBot(store, analyst, { name: 'Nope' });
    expect(planned).toEqual({
      ok: false,
      error: 'Only the Primary bot can create bots. Ask the user to have Primary create one.',
    });
  });

  test('resolves section_name to a Space', async () => {
    const store = new MemoryChatStore();
    const primary = await store.ensurePrimaryBot();
    const section = await store.createSpace({ name: 'Lakehouse', ownerId: primary.ownerId });
    const planned = await planCreateBot(store, primary, {
      name: 'SQL Scout',
      section_name: 'Lakehouse',
    });
    expect(planned.ok).toBe(true);
    if (planned.ok) {
      expect(planned.plan.spaceId).toBe(section.id);
    }
  });
});
