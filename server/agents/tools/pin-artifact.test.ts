import { describe, expect, test } from 'vitest';
import { parseArtifactPinNotice } from '../../../shared/chat/artifact-pin-notice.js';
import { MemoryChatStore } from '../../chat/memory-store.js';
import { executePinArtifact, planPinArtifact, PIN_ARTIFACT_TOOL_NAME } from './pin-artifact.js';

describe('pin_artifact', () => {
  test('plans and writes a system artifact_pin notice', async () => {
    const store = new MemoryChatStore();
    const bot = await store.ensurePrimaryBot();
    const chat = await store.getOrCreateChatForBot(bot.id);

    const planned = planPinArtifact(
      {
        title: 'Sample rows',
        kind: 'sql',
        body: 'SELECT * FROM main.sales LIMIT 10',
        summary: 'Top sales sample',
      },
      bot,
    );
    expect(planned.ok).toBe(true);

    const result = await executePinArtifact(
      store,
      { chatId: chat.id, bot },
      {
        title: 'Sample rows',
        kind: 'sql',
        body: 'SELECT * FROM main.sales LIMIT 10',
        summary: 'Top sales sample',
      },
    );
    const parsed = JSON.parse(result) as { ok: boolean; title: string; kind: string; messageId?: string };
    expect(parsed.ok).toBe(true);
    expect(parsed.title).toBe('Sample rows');
    expect(parsed.kind).toBe('sql');
    expect(parsed.messageId).toBeTruthy();

    const messages = await store.listMessages(chat.id);
    const notice = messages.find((message) => message.role === 'system');
    expect(notice).toBeTruthy();
    expect(parseArtifactPinNotice(notice!.content)).toEqual(
      expect.objectContaining({
        kind: 'artifact_pin',
        title: 'Sample rows',
        artifactKind: 'sql',
        pinnedByBotId: bot.id,
        pinnedByName: bot.name,
      }),
    );
  });

  test('rejects missing bot and invalid kind', async () => {
    const store = new MemoryChatStore();
    const bot = await store.ensurePrimaryBot();
    const chat = await store.getOrCreateChatForBot(bot.id);

    expect(planPinArtifact({ title: 'x', kind: 'note', body: 'y' }, null)).toEqual({
      ok: false,
      error: 'pin_artifact requires an active Bot',
    });

    const badKind = await executePinArtifact(
      store,
      { chatId: chat.id, bot },
      { title: 'x', kind: 'genie', body: 'y' },
    );
    expect(badKind).toContain('kind must be one of');

    const messages = await store.listMessages(chat.id);
    expect(messages.some((message) => message.role === 'system')).toBe(false);
  });

  test('tool name is stable for catalog registration', () => {
    expect(PIN_ARTIFACT_TOOL_NAME).toBe('pin_artifact');
  });
});

  test('validates mermaid and chart bodies and enforces per-kind limits', () => {
    const bot = {
      id: 'b1',
      name: 'Primary',
      avatarLabel: 'P',
      presence: 'online' as const,
      spaceId: 's1',
      isPrimary: true,
      ownerId: 'u1',
      sortOrder: 0,
      archivedAt: null,
      createdAt: '2026-10-30T00:00:00Z',
    };
    expect(planPinArtifact({ title: 'Flow', kind: 'mermaid', body: 'flowchart LR\n  A-->B' }, bot).ok).toBe(true);
    expect(planPinArtifact({ title: 'Bad', kind: 'mermaid', body: 'pie title x\n  "a": 1' }, bot).ok).toBe(false);
    expect(
      planPinArtifact(
        { title: 'Big table', kind: 'table', body: JSON.stringify({ columns: ['a'], rows: [['x'.repeat(10_000)]] }) },
        bot,
      ).ok,
    ).toBe(true);
    expect(planPinArtifact({ title: 'Big note', kind: 'note', body: 'x'.repeat(9_000) }, bot).ok).toBe(false);
  });
