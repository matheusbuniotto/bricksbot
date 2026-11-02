import { describe, expect, test } from 'vitest';
import { writeVolumeBytes } from '../agents/tools/volume-files.js';
import { resolveArtifactVolumePath } from './artifact-sync.js';

const ROOT = '/Volumes/main/default/bricksbot_artifacts/bricksbot';
const BOT = '3f2a1111-2222-4333-8444-555566667777';
const CHAT = 'chat-9';

describe('sandbox artifact volume path', () => {
  test('default save lands under the caller bot sandbox folder', () => {
    const resolved = resolveArtifactVolumePath('/tmp/out/report.csv', CHAT, undefined, ROOT, {
      userId: 'Alice@Co.com',
      botId: BOT,
    });
    expect(resolved).toEqual({
      ok: true,
      artifactName: 'report.csv',
      volumePath: `${ROOT}/users/alice@co.com/bots/${BOT}/sandbox/${CHAT}/report.csv`,
    });
  });

  test('explicit volume_path stays a validated /Volumes path', () => {
    const resolved = resolveArtifactVolumePath(
      'plot.png',
      CHAT,
      '/Volumes/main/default/shared/plot.png',
      ROOT,
      { userId: 'alice@co.com', botId: BOT }
    );
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.volumePath).toBe('/Volumes/main/default/shared/plot.png');
  });

  test('default root without a caller is rejected', () => {
    const resolved = resolveArtifactVolumePath('plot.png', CHAT, undefined, ROOT);
    expect(resolved.ok).toBe(false);
  });
});

describe('writeVolumeBytes', () => {
  test('PUT uses the caller path and does not run for a rejected relative path', async () => {
    const calls: string[] = [];
    await writeVolumeBytes(
      {
        host: 'https://example.cloud.databricks.com',
        getToken: async () => 'obo-token',
        fetchImpl: async (input) => {
          calls.push(String(input));
          return new Response(null, { status: 200 });
        },
      },
      `${ROOT}/users/alice@co.com/bots/${BOT}/notes/a.md`,
      Buffer.from('hi'),
      true
    );
    expect(calls).toEqual([
      `https://example.cloud.databricks.com/api/2.0/fs/files${ROOT}/users/alice@co.com/bots/${BOT}/notes/a.md?overwrite=true`,
    ]);

    await expect(
      writeVolumeBytes(
        {
          fetchImpl: async () => {
            throw new Error('should not PUT');
          },
        },
        '/Workspace/Users/alice/a.md',
        Buffer.from('no'),
        true
      )
    ).rejects.toThrow(/\/Volumes\//);
    expect(calls).toHaveLength(1);
  });
});
