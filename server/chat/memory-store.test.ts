import { beforeEach, describe, expect, test } from 'vitest';
import { MemoryChatStore } from './memory-store.js';

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
    expect((await store.listSpaces('user-1')).map((s) => s.name).sort()).toEqual([
      'Fraud team',
      'Personal',
    ]);
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
      ]),
    );
    expect(await store.listSpaces('teammate')).toEqual([
      expect.objectContaining({ id: space.id, name: 'Shared' }),
    ]);
  });

  test('getOrCreateChatForBot + addMessage still persist turns', async () => {
    const { primary } = await store.ensureBootstrap('user-1');
    const chat = await store.getOrCreateChatForBot(primary.id);
    await store.addMessage(chat.id, 'user', 'hello');
    await store.addMessage(chat.id, 'assistant', 'ack');
    expect(await store.listMessages(chat.id)).toHaveLength(2);
  });

  test('setBotPresence updates roster presence', async () => {
    const { primary } = await store.ensureBootstrap('user-1');
    const updated = await store.setBotPresence(primary.id, 'thinking');
    expect(updated.presence).toBe('thinking');
  });
});
