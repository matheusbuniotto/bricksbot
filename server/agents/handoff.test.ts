import { describe, expect, test } from 'vitest';
import { MemoryChatStore } from '../chat/memory-store.js';
import { deliverHandoff, planHandoff } from './handoff.js';

describe('planHandoff', () => {
  test('refuses a bot that is not Primary', async () => {
    const store = new MemoryChatStore();
    const { primary } = await store.ensureBootstrap('alice');
    const analyst = await store.createBot({
      name: 'Analyst',
      ownerId: primary.ownerId,
      spaceId: primary.spaceId,
    });
    const source = await store.getOrCreateChatForBot(analyst.id);

    const planned = await planHandoff(store, analyst, { bot_id: primary.id, brief: 'look at revenue' });
    expect(planned.ok).toBe(false);
    if (!planned.ok) expect(planned.error).toMatch(/only the primary/i);

    const delivered = await deliverHandoff(store, analyst, source.id, {
      bot_id: primary.id,
      brief: 'look at revenue',
    });
    expect(delivered).toMatch(/only the primary/i);
    expect(await store.listMessages(source.id)).toEqual([]);
    const primaryChat = await store.getOrCreateChatForBot(primary.id);
    expect(await store.listMessages(primaryChat.id)).toEqual([]);
  });

  test('delivers into the same Space and records a notice on the source chat', async () => {
    const store = new MemoryChatStore();
    const { primary } = await store.ensureBootstrap('alice');
    const analyst = await store.createBot({
      name: 'Analyst',
      ownerId: primary.ownerId,
      spaceId: primary.spaceId,
    });
    const source = await store.getOrCreateChatForBot(primary.id);

    const delivered = await deliverHandoff(store, primary, source.id, {
      bot_name: 'analyst',
      brief: 'look at revenue',
    });
    expect(delivered).toBe('Handed off to Analyst.');

    const target = await store.getOrCreateChatForBot(analyst.id);
    expect(await store.listMessages(target.id)).toEqual([
      expect.objectContaining({ role: 'user', content: 'From Primary: look at revenue' }),
    ]);
    const sourceMessages = await store.listMessages(source.id);
    expect(sourceMessages).toHaveLength(1);
    expect(sourceMessages[0]?.role).toBe('system');
    expect(JSON.parse(sourceMessages[0].content)).toEqual(
      expect.objectContaining({
        kind: 'handoff',
        direction: 'sent',
        targetBotId: analyst.id,
        targetName: 'Analyst',
        brief: 'look at revenue',
        senderName: 'Primary',
        threadBotId: analyst.id,
      })
    );
  });

  test('refuses a target in another Space', async () => {
    const store = new MemoryChatStore();
    const { primary } = await store.ensureBootstrap('alice');
    const other = await store.createSpace({ name: 'Other', ownerId: 'alice' });
    const analyst = await store.createBot({
      name: 'Analyst',
      ownerId: 'alice',
      spaceId: other.id,
    });
    const source = await store.getOrCreateChatForBot(primary.id);

    const planned = await planHandoff(store, primary, { bot_id: analyst.id, brief: 'cross the line' });
    expect(planned.ok).toBe(false);
    if (!planned.ok) expect(planned.error).toMatch(/your Space/);

    await deliverHandoff(store, primary, source.id, { bot_id: analyst.id, brief: 'cross the line' });
    const target = await store.getOrCreateChatForBot(analyst.id);
    expect(await store.listMessages(target.id)).toEqual([]);
    expect(await store.listMessages(source.id)).toEqual([]);
  });

  test('refuses a viewer even inside the Space', async () => {
    const store = new MemoryChatStore();
    const team = await store.createSpace({ name: 'Team', ownerId: 'carol' });
    await store.addSpaceMember(team.id, 'alice', 'viewer');
    const primary = await store.createBot({
      name: 'Primary',
      ownerId: 'alice',
      spaceId: team.id,
      isPrimary: true,
    });
    const analyst = await store.createBot({
      name: 'Analyst',
      ownerId: 'carol',
      spaceId: team.id,
    });
    const source = await store.getOrCreateChatForBot(primary.id);

    const planned = await planHandoff(store, primary, { bot_id: analyst.id, brief: 'please' });
    expect(planned.ok).toBe(false);
    if (!planned.ok) expect(planned.error).toMatch(/membership/);
    await deliverHandoff(store, primary, source.id, { bot_id: analyst.id, brief: 'please' });
    const target = await store.getOrCreateChatForBot(analyst.id);
    expect(await store.listMessages(target.id)).toEqual([]);
  });

  test('a member can hand off to another owner bot in the same Space', async () => {
    const store = new MemoryChatStore();
    const team = await store.createSpace({ name: 'Team', ownerId: 'carol' });
    await store.addSpaceMember(team.id, 'alice', 'member');
    const primary = await store.createBot({
      name: 'Primary',
      ownerId: 'alice',
      spaceId: team.id,
      isPrimary: true,
    });
    const analyst = await store.createBot({
      name: 'Analyst',
      ownerId: 'carol',
      spaceId: team.id,
    });
    const source = await store.getOrCreateChatForBot(primary.id);

    const delivered = await deliverHandoff(store, primary, source.id, {
      bot_id: analyst.id,
      brief: 'shared work',
    });
    expect(delivered).toBe('Handed off to Analyst.');
    const target = await store.getOrCreateChatForBot(analyst.id, 'alice');
    expect(await store.listMessages(target.id)).toEqual([
      expect.objectContaining({ role: 'user', content: 'From Primary: shared work' }),
    ]);
  });
});
