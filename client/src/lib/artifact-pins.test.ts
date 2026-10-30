import { describe, expect, test } from 'vitest';
import { serializeArtifactPinNotice } from '../../../shared/chat/artifact-pin-notice';
import type { Message } from '../../../shared/chat/types';
import { listArtifactPinsFromMessages } from './artifact-pins';

function systemMsg(id: string, content: string, createdAt: string): Message {
  return { id, chatId: 'c', role: 'system', content, createdAt };
}

describe('listArtifactPinsFromMessages', () => {
  test('collects artifact_pin system messages newest first', () => {
    const first = serializeArtifactPinNotice({
      kind: 'artifact_pin',
      title: 'Older',
      artifactKind: 'note',
      body: 'a',
      pinnedByBotId: 'b',
      pinnedByName: 'Bot',
    });
    const second = serializeArtifactPinNotice({
      kind: 'artifact_pin',
      title: 'Newer',
      artifactKind: 'sql',
      body: 'SELECT 1',
      summary: 'ok',
      pinnedByBotId: 'b',
      pinnedByName: 'Bot',
    });
    const pins = listArtifactPinsFromMessages([
      systemMsg('1', first, '2026-01-01T00:00:00Z'),
      systemMsg('2', '{ "kind": "handoff" }', '2026-01-02T00:00:00Z'),
      systemMsg('3', second, '2026-01-03T00:00:00Z'),
    ]);
    expect(pins).toHaveLength(2);
    expect(pins[0]?.notice.title).toBe('Newer');
    expect(pins[1]?.notice.title).toBe('Older');
  });

  test('ignores non-system and invalid JSON', () => {
    expect(
      listArtifactPinsFromMessages([
        {
          id: 'u',
          chatId: 'c',
          role: 'user',
          content: '{}',
          createdAt: '2026-01-01T00:00:00Z',
        },
        systemMsg('s', 'not json', '2026-01-01T00:00:00Z'),
      ]),
    ).toEqual([]);
  });
});
