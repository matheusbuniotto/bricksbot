import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ChatStore } from '../../shared/chat/types.js';
import type { HandoffTurnContext } from '../agents/handoff.js';
import { executePinArtifact } from '../agents/tools/pin-artifact.js';
import { validateVolumePath } from '../agents/tools/volume-read.js';
import { redactSecrets, safeArtifactName } from './redact.js';
import type { SandboxSessionService } from './session-service.js';

export interface ArtifactSyncOptions {
  chatStore: ChatStore;
  sessionService: SandboxSessionService;
  host?: string;
  getToken?: () => Promise<string>;
  fetchImpl?: typeof fetch;
  writeVolumeFile?: (volumePath: string, data: Uint8Array) => Promise<void>;
}

export interface SyncArtifactInput {
  sourcePath: string;
  volumePath?: string;
  title?: string;
  summary?: string;
}

export interface SyncArtifactResult {
  ok: true;
  title: string;
  artifactName: string;
  volumePath: string;
  bytes: number;
  messageId: string;
}

export function resolveArtifactVolumePath(
  sourcePath: string,
  chatId: string,
  explicitVolumePath?: string,
  defaultVolumeRoot?: string,
): { ok: true; volumePath: string; artifactName: string } | { ok: false; error: string } {
  const artifactName = safeArtifactName(sourcePath);
  if (!artifactName) {
    return { ok: false, error: 'sandbox_save_artifact requires a valid source_path file name' };
  }

  let candidate = explicitVolumePath?.trim() || '';
  if (!candidate && defaultVolumeRoot?.trim()) {
    const cleanRoot = defaultVolumeRoot.trim().replace(/\/+$/, '');
    candidate = `${cleanRoot}/${chatId}/${artifactName}`;
  }

  if (!candidate) {
    return {
      ok: false,
      error:
        'sandbox_save_artifact requires volume_path (starting with /Volumes/...) or SANDBOX_ARTIFACT_VOLUME_PATH to be configured',
    };
  }

  // If caller passed a Volume directory ending with `/`, append artifactName.
  if (candidate.endsWith('/')) {
    candidate = `${candidate}${artifactName}`;
  }

  const volumeErr = validateVolumePath(candidate);
  if (volumeErr) {
    return {
      ok: false,
      error: volumeErr.replace(/^volume_read/, 'sandbox_save_artifact'),
    };
  }

  return { ok: true, volumePath: candidate, artifactName };
}

export class ArtifactSyncService {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ArtifactSyncOptions) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  private async writeToVolume(volumePath: string, data: Uint8Array): Promise<void> {
    if (this.options.writeVolumeFile) {
      await this.options.writeVolumeFile(volumePath, data);
      return;
    }

    // Try workspace REST API /api/2.0/fs/files first when host + token are configured,
    // or local /Volumes mount if running in a container with Volume FUSE mount.
    if (this.options.host && this.options.getToken) {
      const rawHost = this.options.host.trim().replace(/\/+$/, '');
      const host = /^https?:\/\//i.test(rawHost) ? rawHost : `https://${rawHost}`;
      const token = await this.options.getToken();
      const url = `${host}/api/2.0/fs/files${volumePath}?overwrite=true`;
      const res = await this.fetchImpl(url, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/octet-stream',
        },
        body: Buffer.from(data),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(
          `Volume upload failed (${res.status}): ${text || res.statusText}`,
        );
      }
      return;
    }

    await fs.mkdir(path.dirname(volumePath), { recursive: true });
    await fs.writeFile(volumePath, data);
  }

  async syncAndPin(
    ctx: HandoffTurnContext,
    input: SyncArtifactInput,
  ): Promise<SyncArtifactResult> {
    if (!ctx.bot) {
      throw new Error('sandbox_save_artifact requires an active Bot');
    }

    const resolved = resolveArtifactVolumePath(
      input.sourcePath,
      ctx.chatId,
      input.volumePath,
      this.options.sessionService.getArtifactVolumeRoot(),
    );
    if (!resolved.ok) {
      throw new Error(resolved.error);
    }

    const { volumePath, artifactName } = resolved;
    const downloaded = await this.options.sessionService.downloadFile(
      {
        chatId: ctx.chatId,
        botId: ctx.bot.id,
        userId: ctx.bot.ownerId,
      },
      { src: input.sourcePath },
    );

    try {
      await this.writeToVolume(volumePath, downloaded.data);
    } catch (err) {
      const msg = redactSecrets(
        err instanceof Error ? err.message : 'Unable to write artifact to Volume',
        this.options.sessionService.getSecretsToRedact(),
      );
      throw new Error(msg);
    }

    const title = input.title?.trim() || artifactName;
    const summary =
      input.summary?.trim() || `Saved ${artifactName} (${downloaded.bytes} bytes)`;

    const pinRaw = await executePinArtifact(this.options.chatStore, ctx, {
      title,
      kind: 'volume_path',
      body: volumePath,
      summary,
    });

    let messageId = '';
    try {
      const parsed = JSON.parse(pinRaw) as { ok?: boolean; messageId?: string };
      if (!parsed.ok) {
        throw new Error(pinRaw);
      }
      messageId = parsed.messageId ?? '';
    } catch (err) {
      if (err instanceof Error && err.message === pinRaw) throw err;
      throw new Error(pinRaw);
    }

    return {
      ok: true,
      title,
      artifactName,
      volumePath,
      bytes: downloaded.bytes,
      messageId,
    };
  }
}
