import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, test } from 'vitest';
import { MemoryChatStore } from './memory-store.js';

/** Chat order is by timestamp, so let the clock move between steps. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 3));

describe('MemoryChatStore', () => {
  let store: MemoryChatStore;

  beforeEach(() => {
    store = new MemoryChatStore();
  });

  test('ensureBootstrap creates Personal space + Primary bot once', async () => {
    const a = await store.ensureBootstrap('user-1');
    const b = await store.ensureBootstrap('user-1');

    expect(a.space.id).toBe(b.space.id);
    expect(a.space.name).toBe('Personal');
    expect(a.primary.id).toBe(b.primary.id);
    expect(a.primary.isPrimary).toBe(true);
    expect(await store.listBots({ ownerId: 'user-1' })).toHaveLength(1);
  });

  test('createSpace and createBot support multi-bot roster', async () => {
    const { space } = await store.ensureBootstrap('user-1');
    const team = await store.createSpace({ name: 'Fraud team', ownerId: 'user-1' });
    const analyst = await store.createBot({
      name: 'Analyst',
      spaceId: team.id,
      ownerId: 'user-1',
    });

    expect(analyst.avatarLabel).toBe('A');
    expect(analyst.spaceId).toBe(team.id);
    expect((await store.listSpaces('user-1')).map((s) => s.name).sort()).toEqual(['Fraud team', 'Personal']);
    expect(await store.listBots({ spaceId: team.id })).toEqual([
      expect.objectContaining({ id: analyst.id, name: 'Analyst' }),
    ]);
    expect(await store.listBots({ spaceId: space.id })).toHaveLength(1);
  });

  test('space members can be shared with roles', async () => {
    const space = await store.createSpace({ name: 'Shared', ownerId: 'owner' });
    await store.addSpaceMember(space.id, 'teammate', 'member');
    const members = await store.listSpaceMembers(space.id);
    expect(members).toEqual(
      expect.arrayContaining([
        { spaceId: space.id, userId: 'owner', role: 'admin' },
        { spaceId: space.id, userId: 'teammate', role: 'member' },
      ])
    );
    expect(await store.listSpaces('teammate')).toEqual([expect.objectContaining({ id: space.id, name: 'Shared' })]);
  });

  test('getDefaultChat + addMessage still persist turns', async () => {
    const { primary } = await store.ensureBootstrap('user-1');
    const chat = await store.getDefaultChat(primary.id);
    await store.addMessage(chat.id, 'user', 'hello');
    await store.addMessage(chat.id, 'assistant', 'ack');
    expect(await store.listMessages(chat.id)).toHaveLength(2);
  });

  test('setBotPresence updates roster presence', async () => {
    const { primary } = await store.ensureBootstrap('user-1');
    const updated = await store.setBotPresence(primary.id, 'thinking');
    expect(updated.presence).toBe('thinking');
    const waiting = await store.setBotPresence(primary.id, 'waiting');
    expect(waiting.presence).toBe('waiting');
  });

  test('rename, move, archive, restore, and delete bots', async () => {
    const { space, primary } = await store.ensureBootstrap('user-1');
    const team = await store.createSpace({ name: 'Code', ownerId: 'user-1' });
    const analyst = await store.createBot({
      name: 'Analyst',
      spaceId: space.id,
      ownerId: 'user-1',
    });
    const coder = await store.createBot({
      name: 'Coder',
      spaceId: space.id,
      ownerId: 'user-1',
    });

    const renamed = await store.updateBot(analyst.id, { name: 'Fraud Analyst' });
    expect(renamed.name).toBe('Fraud Analyst');
    expect(renamed.avatarLabel).toBe('F');

    await store.moveBot(coder.id, { spaceId: team.id, index: 0 });
    expect((await store.getBot(coder.id))?.spaceId).toBe(team.id);

    await store.moveBot(analyst.id, { spaceId: space.id, index: 0 });
    const personal = await store.listBots({ spaceId: space.id, ownerId: 'user-1' });
    expect(personal.filter((bot) => !bot.isPrimary).map((bot) => bot.name)).toEqual(['Fraud Analyst']);

    await store.archiveBot(analyst.id);
    expect(await store.listBots({ ownerId: 'user-1' })).toEqual([
      expect.objectContaining({ id: primary.id }),
      expect.objectContaining({ id: coder.id }),
    ]);
    expect(await store.listBots({ ownerId: 'user-1', archived: 'archived' })).toEqual([
      expect.objectContaining({ id: analyst.id, archivedAt: expect.any(String) }),
    ]);

    await store.unarchiveBot(analyst.id);
    expect((await store.getBot(analyst.id))?.archivedAt).toBeNull();

    await store.deleteBot(analyst.id);
    expect(await store.getBot(analyst.id)).toBeNull();

    await expect(store.archiveBot(primary.id)).rejects.toThrow(/Primary/);
    await expect(store.deleteBot(primary.id)).rejects.toThrow(/Primary/);
  });

  test('shares non-primary space bots across members without exposing Primary', async () => {
    const { primary: primaryA } = await store.ensureBootstrap('user-a');
    const { primary: primaryB } = await store.ensureBootstrap('user-b');
    expect(primaryB.id).not.toBe(primaryA.id);

    const shared = await store.createSpace({ name: 'Shared Team', ownerId: 'user-a' });
    const analyst = await store.createBot({
      name: 'Analyst',
      spaceId: shared.id,
      ownerId: 'user-a',
      isShared: true,
    });
    await store.addSpaceMember(shared.id, 'user-b', 'member');

    const botsForB = await store.listBots({ ownerId: 'user-b' });
    expect(botsForB.map((b) => b.id)).toEqual([primaryB.id, analyst.id]);

    const spaceBotsForB = await store.listBots({ ownerId: 'user-b', spaceId: shared.id });
    expect(spaceBotsForB.map((b) => b.id)).toEqual([analyst.id]);
  });

  test('addMessage updates bot.lastPreview for user/assistant/handoff notices and ignores tool rows', async () => {
    const { primary } = await store.ensureBootstrap('user-a');
    expect(primary.lastPreview).toBe('');
    const chat = await store.getDefaultChat(primary.id);

    await store.addMessage(chat.id, 'user', 'Check the sales table');
    expect((await store.getBot(primary.id))?.lastPreview).toBe('Check the sales table');

    await store.addMessage(chat.id, 'tool', JSON.stringify({ result: '10 rows' }), {
      toolCallId: 'call-1',
    });
    expect((await store.getBot(primary.id))?.lastPreview).toBe('Check the sales table');

    await store.addMessage(chat.id, 'assistant', 'Sales look healthy');
    expect((await store.getBot(primary.id))?.lastPreview).toBe('Sales look healthy');
  });

  test('isolates per-user chats and lastPreview on shared bots', async () => {
    await store.ensureBootstrap('user-a');
    await store.ensureBootstrap('user-b');
    const sharedSpace = await store.createSpace({ name: 'Team', ownerId: 'user-a' });
    await store.addSpaceMember(sharedSpace.id, 'user-b', 'member');
    const bot = await store.createBot({
      name: 'Analyst',
      spaceId: sharedSpace.id,
      ownerId: 'user-a',
      isShared: true,
    });

    const chatA = await store.getDefaultChat(bot.id, 'user-a');
    const chatB = await store.getDefaultChat(bot.id, 'user-b');
    expect(chatA.id).not.toBe(chatB.id);
    expect(chatA.userId).toBe('user-a');
    expect(chatB.userId).toBe('user-b');

    await store.addMessage(chatA.id, 'user', 'Private to user-a');
    expect(await store.listMessages(chatA.id)).toHaveLength(1);
    expect(await store.listMessages(chatB.id)).toHaveLength(0);

    const botsForA = await store.listBots({ ownerId: 'user-a' });
    const botsForB = await store.listBots({ ownerId: 'user-b' });
    expect(botsForA.find((b) => b.id === bot.id)?.lastPreview).toBe('Private to user-a');
    expect(botsForB.find((b) => b.id === bot.id)?.lastPreview).toBe('');

    await store.addMessage(chatB.id, 'user', 'Private to user-b');
    const botsForBAfter = await store.listBots({ ownerId: 'user-b' });
    expect(botsForBAfter.find((b) => b.id === bot.id)?.lastPreview).toBe('Private to user-b');
    expect((await store.getBot(bot.id))?.lastPreview).toBe('Private to user-a');
  });

  test('listMarketplaceBots returns only active shared non-primary bots with blank preview', async () => {
    const { primary } = await store.ensureBootstrap('user-a');
    await expect(store.updateBot(primary.id, { isShared: true })).rejects.toThrow('Cannot share the Primary bot');

    const personalBot = await store.createBot({
      name: 'Private Bot',
      ownerId: 'user-a',
      description: 'Stays private',
    });
    expect(personalBot.isShared).toBe(false);
    expect(await store.listMarketplaceBots()).toEqual([]);

    const chat = await store.getDefaultChat(personalBot.id, 'user-a');
    await store.addMessage(chat.id, 'user', 'Owner secret message');

    const shared = await store.updateBot(personalBot.id, {
      isShared: true,
      description: 'Shared analyst instructions',
    });
    expect(shared.isShared).toBe(true);
    expect(shared.description).toBe('Shared analyst instructions');

    const marketplace = await store.listMarketplaceBots();
    expect(marketplace).toHaveLength(1);
    expect(marketplace[0]).toMatchObject({
      id: personalBot.id,
      name: 'Private Bot',
      isShared: true,
      description: 'Shared analyst instructions',
      lastPreview: '',
    });
  });

  describe('multiple chats per bot', () => {
    async function setup() {
      const store = new MemoryChatStore();
      const bot = await store.createBot({ name: 'Analyst', ownerId: 'alice' });
      return { store, bot };
    }

    test('a user can have several chats; the default is the latest active one', async () => {
      const { store, bot } = await setup();
      const first = await store.getDefaultChat(bot.id, 'alice');
      expect(await store.getDefaultChat(bot.id, 'alice')).toBe(first);

      await tick();
      const second = await store.createChat(bot.id, 'alice', 'Q3');
      expect(second.id).not.toBe(first.id);
      expect((await store.getDefaultChat(bot.id, 'alice')).id).toBe(second.id);

      await tick();
      await store.addMessage(first.id, 'user', 'back to the first');
      expect((await store.getDefaultChat(bot.id, 'alice')).id).toBe(first.id);
      expect((await store.listChats(bot.id, 'alice')).map((c) => c.id)).toEqual([first.id, second.id]);
    });

    test('lists only the caller chats and hides archived ones', async () => {
      const { store, bot } = await setup();
      const mine = await store.createChat(bot.id, 'alice');
      const theirs = await store.createChat(bot.id, 'bob');
      expect(mine.title).toBe('New chat');
      expect((await store.listChats(bot.id, 'alice')).map((c) => c.id)).toEqual([mine.id]);
      expect((await store.listChats(bot.id, 'bob')).map((c) => c.id)).toEqual([theirs.id]);

      const archived = await store.archiveChat(mine.id);
      expect(archived.archivedAt).toBeTruthy();
      expect(await store.listChats(bot.id, 'alice')).toEqual([]);
      expect((await store.getDefaultChat(bot.id, 'alice')).id).not.toBe(mine.id);
      expect(await store.getChat(mine.id)).not.toBeNull();
    });

    test('renames a chat', async () => {
      const { store, bot } = await setup();
      const chat = await store.createChat(bot.id, 'alice');
      expect((await store.renameChat(chat.id, '  Weekly KPIs ')).title).toBe('Weekly KPIs');
      await expect(store.renameChat('missing', 'x')).rejects.toThrow('Chat not found');
    });

    test('a routine always resolves to its own chat, never the default', async () => {
      const { store, bot } = await setup();
      const routine = { id: randomUUID(), botId: bot.id, ownerId: 'alice', name: 'Daily' };
      const regular = await store.getDefaultChat(bot.id, 'alice');
      const chat = await store.getRoutineChat(routine);
      expect(chat).toMatchObject({ kind: 'routine', routineId: routine.id, userId: 'alice' });
      expect(chat.id).not.toBe(regular.id);
      expect((await store.getRoutineChat(routine)).id).toBe(chat.id);
      expect((await store.getRoutineChat({ ...routine, id: randomUUID() })).id).not.toBe(chat.id);
      expect((await store.getDefaultChat(bot.id, 'alice')).id).toBe(regular.id);
    });

    test('handoffs land in one chat per (teammate, caller)', async () => {
      const { store, bot } = await setup();
      const regular = await store.getDefaultChat(bot.id, 'alice');
      const handoff = await store.getHandoffChat(bot.id, 'alice');
      expect(handoff).toMatchObject({ kind: 'handoff', userId: 'alice' });
      expect(handoff.id).not.toBe(regular.id);
      expect((await store.getHandoffChat(bot.id, 'alice')).id).toBe(handoff.id);
      expect((await store.getHandoffChat(bot.id, 'bob')).id).not.toBe(handoff.id);
      expect((await store.getDefaultChat(bot.id, 'alice')).id).toBe(regular.id);
    });

    test('deleting a bot removes all its chats', async () => {
      const { store, bot } = await setup();
      const chat = await store.createChat(bot.id, 'alice');
      await store.deleteBot(bot.id);
      expect(await store.getChat(chat.id)).toBeNull();
    });
  });
});
