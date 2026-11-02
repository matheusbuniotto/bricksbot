import type { ChatStore } from '../../shared/chat/types.js';
import type { HandoffTurnContext } from '../agents/handoff.js';
import { executePinArtifact } from '../agents/tools/pin-artifact.js';
import { validateVolumePath } from '../agents/tools/volume-read.js';
import { writeVolumeBytes } from '../agents/tools/volume-files.js';
import { resolveNamespacedVolumePath } from '../agents/tools/volume-namespace.js';
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

export interface ArtifactVolumeNamespace {
  userId: string;
  botId: string;
}

export function resolveArtifactVolumePath(
  sourcePath: string,
  chatId: string,
  explicitVolumePath?: string,
  defaultVolumeRoot?: string,
  namespace?: ArtifactVolumeNamespace
): { ok: true; volumePath: string; artifactName: string } | { ok: false; error: string } {
  const artifactName = safeArtifactName(sourcePath);
  if (!artifactName) {
    return { ok: false, error: 'sandbox_save_artifact requires a valid source_path file name' };
  }

  let candidate = explicitVolumePath?.trim() || '';
  if (!candidate && defaultVolumeRoot?.trim()) {
    if (!namespace?.userId || !namespace.botId) {
      return {
        ok: false,
        error: 'sandbox_save_artifact requires the signed-in user and active bot to place the file',
      };
    }
    const namespaced = resolveNamespacedVolumePath(
      { root: defaultVolumeRoot, userId: namespace.userId, botId: namespace.botId },
      `sandbox/${chatId}/${artifactName}`
    );
    if (!namespaced.ok) {
      return { ok: false, error: namespaced.error.replace(/^volume_write/, 'sandbox_save_artifact') };
    }
    candidate = namespaced.path;
  }

  if (!candidate) {
    return {
      ok: false,
      error:
        'sandbox_save_artifact requires volume_path (starting with /Volumes/...) or BRICKSBOT_VOLUME_ROOT to be configured',
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
    await writeVolumeBytes(
      {
        host: this.options.host,
        getToken: this.options.getToken,
        fetchImpl: this.fetchImpl,
      },
      volumePath,
      data,
      true
    );
  }

  async syncAndPin(ctx: HandoffTurnContext, input: SyncArtifactInput): Promise<SyncArtifactResult> {
    if (!ctx.bot) {
      throw new Error('sandbox_save_artifact requires an active Bot');
    }

    const userId = ctx.userId?.trim();
    if (!input.volumePath?.trim() && !userId) {
      throw new Error('sandbox_save_artifact requires the signed-in user and active bot to place the file');
    }
    const resolved = resolveArtifactVolumePath(
      input.sourcePath,
      ctx.chatId,
      input.volumePath,
      this.options.sessionService.getArtifactVolumeRoot(),
      userId && ctx.bot ? { userId, botId: ctx.bot.id } : undefined
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
      { src: input.sourcePath }
    );

    try {
      await this.writeToVolume(volumePath, downloaded.data);
    } catch (err) {
      const msg = redactSecrets(
        err instanceof Error ? err.message : 'Unable to write artifact to Volume',
        this.options.sessionService.getSecretsToRedact()
      );
      throw new Error(msg);
    }

    const title = input.title?.trim() || artifactName;
    const summary = input.summary?.trim() || `Saved ${artifactName} (${downloaded.bytes} bytes)`;

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
