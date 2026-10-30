import { describe, expect, test } from 'vitest';
import {
  artifactPinPreviewLine,
  parseArtifactPinNotice,
  serializeArtifactPinNotice,
} from './artifact-pin-notice.js';

describe('artifact-pin-notice', () => {
  test('round-trips a structured notice', () => {
    const notice = {
      kind: 'artifact_pin' as const,
      title: 'Revenue spike',
      artifactKind: 'sql' as const,
      body: 'SELECT COUNT(*) FROM sales',
      summary: 'Weekly sales up 12%',
      pinnedByBotId: 'b1',
      pinnedByName: 'Analyst',
    };
    expect(parseArtifactPinNotice(serializeArtifactPinNotice(notice))).toEqual(notice);
  });

  test('rejects non-artifact_pin JSON and invalid kinds', () => {
    expect(parseArtifactPinNotice(JSON.stringify({ kind: 'handoff', targetName: 'x' }))).toBeNull();
    expect(
      parseArtifactPinNotice(
        JSON.stringify({ kind: 'artifact_pin', title: 'x', artifactKind: 'bad', body: '' }),
      ),
    ).toBeNull();
    expect(parseArtifactPinNotice('Pinned something')).toBeNull();
  });

  test('artifactPinPreviewLine prefers summary', () => {
    expect(
      artifactPinPreviewLine({
        kind: 'artifact_pin',
        title: 'T',
        artifactKind: 'note',
        body: 'body',
        summary: 'One line',
        pinnedByBotId: '',
        pinnedByName: '',
      }),
    ).toBe('Pinned: One line');
  });
});
