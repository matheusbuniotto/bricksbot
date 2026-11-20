import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import type { VolumeQuotaLimits, VolumeUsageStore } from '../../shared/agents/volume-namespace.js';
import {
  ATTACHMENT_HEAD_BYTES,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENTS_PER_CHAT,
  attachmentKindFor,
  type Attachment,
  type AttachmentStore,
} from '../../shared/chat/attachments.js';
import type { Chat } from '../../shared/chat/types.js';
import { filesApiUrl } from '../agents/tools/volume-read.js';
import {
  assessVolumeQuota,
  resolveNamespacedVolumePath,
  resolveVolumeRoot,
  sanitizeVolumeBotId,
  sanitizeVolumeUserId,
} from '../agents/tools/volume-namespace.js';
import { presentEnv } from '../lib/env.js';
import { buildPreview } from './preview.js';
import { validateAttachment } from './validate.js';

/** A refusal the person can act on, with the HTTP status that fits it. */
export class AttachmentError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

/** The Volume where uploads land: `BRICKSBOT_ATTACHMENT_VOLUME_ROOT`, else the shared `BRICKSBOT_VOLUME_ROOT`. */
export function resolveAttachmentRoot(env: Record<string, string | undefined>): string | undefined {
  const own = presentEnv(env.BRICKSBOT_ATTACHMENT_VOLUME_ROOT);
  return resolveVolumeRoot(own ? { BRICKSBOT_VOLUME_ROOT: own } : env);
}

/** Where the bytes go. The Files API, called with the signed-in person's own token. */
export interface AttachmentFiles {
  ensureDirectory(dir: string): Promise<void>;
  /** Never overwrites. `length` is sent as Content-Length. */
  put(filePath: string, body: AsyncIterable<Uint8Array>, length: number): Promise<void>;
  get(filePath: string): Promise<Readable>;
  /** A file that is already gone is fine. */
  remove(filePath: string): Promise<void>;
}

export function filesApiClient(options: {
  host: string;
  /** Use the `viewer` purpose: the caller's token only, never the App service principal. */
  getToken: () => Promise<string>;
  fetchImpl?: typeof fetch;
}): AttachmentFiles {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  async function call(url: string, init: RequestInit & { duplex?: 'half' }, okStatuses: number[] = []) {
    const res = await fetchImpl(url, {
      ...init,
      headers: { Authorization: `Bearer ${await options.getToken()}`, ...(init.headers as object) },
    });
    if (!res.ok && !okStatuses.includes(res.status)) {
      const text = await res.text().catch(() => '');
      throw new Error(`Volume request failed (${res.status}): ${text || res.statusText}`);
    }
    return res;
  }

  return {
    // Creates missing parents and succeeds on an existing directory (the Files API does not do that on file PUT).
    ensureDirectory: async (dir) => void (await call(filesApiUrl(options.host, 'directories', dir), { method: 'PUT' })),
    put: async (filePath, body, length) => {
      await call(`${filesApiUrl(options.host, 'files', filePath)}?overwrite=false`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(length) },
        body: body as unknown as ReadableStream,
        duplex: 'half',
      });
    },
    get: async (filePath) => {
      const res = await call(filesApiUrl(options.host, 'files', filePath), { method: 'GET' });
      return Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
    },
    remove: async (filePath) => {
      await call(filesApiUrl(options.host, 'files', filePath), { method: 'DELETE' }, [404]);
    },
  };
}

function displayName(raw: string): string {
  const printable = [...(raw.split(/[\\/]/).pop() ?? '')].filter((char) => char.charCodeAt(0) >= 32);
  return printable.join('').trim().slice(0, 200);
}

export interface AttachmentServiceOptions {
  root: string;
  store: AttachmentStore;
  files: AttachmentFiles;
  usage: VolumeUsageStore;
  limits: VolumeQuotaLimits;
}

export class AttachmentService {
  constructor(private readonly options: AttachmentServiceOptions) {}

  get store(): AttachmentStore {
    return this.options.store;
  }

  /**
   * Streams the file to the Volume as the caller. The declared `length` is reserved against the caller's
   * quota first and handed back if anything fails, so a refused or broken upload costs nothing.
   */
  async upload(
    chat: Chat,
    input: { name: string; length: number; body: AsyncIterable<Uint8Array> }
  ): Promise<Attachment> {
    const { store, files, usage, root, limits } = this.options;
    const userId = chat.userId;
    if (!userId) throw new AttachmentError(403, 'Forbidden');
    const name = displayName(input.name);
    if (!attachmentKindFor(name)) throw new AttachmentError(415, 'Unsupported file type');
    if (!(input.length > 0)) throw new AttachmentError(400, 'The file is empty');
    if (input.length > ATTACHMENT_MAX_BYTES) {
      throw new AttachmentError(413, `The file is too large (limit ${ATTACHMENT_MAX_BYTES / 1024 / 1024} MiB)`);
    }
    if ((await store.list(chat.id, userId)).length >= ATTACHMENTS_PER_CHAT) {
      throw new AttachmentError(400, `A chat holds at most ${ATTACHMENTS_PER_CHAT} attachments`);
    }

    const id = randomUUID();
    const safeName = name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80);
    const target = resolveNamespacedVolumePath(
      { root, userId, botId: chat.botId },
      `uploads/${chat.id.slice(0, 8)}/${id.slice(0, 8)}-${safeName}`
    );
    if (!target.ok) throw new AttachmentError(400, target.error);

    const { userSegment, botSegment } = target;
    const usageNow = await usage.getUsage(userSegment, botSegment);
    const quota = assessVolumeQuota({
      ...usageNow,
      incomingBytes: input.length,
      limits: { ...limits, maxWriteBytes: ATTACHMENT_MAX_BYTES },
    });
    if (!quota.ok) throw new AttachmentError(413, quota.error.replace(/^volume_write/, 'Upload'));

    await usage.addBytes(userSegment, botSegment, input.length);
    let wrote = false;
    try {
      const rest = input.body[Symbol.asyncIterator]();
      const chunks: Buffer[] = [];
      for (let size = 0; size < ATTACHMENT_HEAD_BYTES; ) {
        const next = await rest.next();
        if (next.done) break;
        chunks.push(Buffer.from(next.value));
        size += next.value.length;
      }
      const head = Buffer.concat(chunks);
      const checked = validateAttachment(name, head);
      if (!checked.ok) throw new AttachmentError(415, checked.error);

      await files.ensureDirectory(path.posix.dirname(target.path));
      wrote = true;
      await files.put(target.path, checkedBody(head, rest, input.length), input.length);
      return await store.create({
        id,
        chatId: chat.id,
        userId,
        name,
        kind: checked.kind,
        sizeBytes: input.length,
        volumePath: target.path,
        preview: buildPreview(checked.kind, head),
      });
    } catch (err) {
      await usage.releaseBytes(userSegment, botSegment, input.length).catch(() => undefined);
      if (wrote) await files.remove(target.path).catch(() => undefined);
      throw err;
    }
  }

  read(attachment: Attachment): Promise<Readable> {
    return this.options.files.get(attachment.volumePath);
  }

  async remove(chat: Chat, attachment: Attachment): Promise<void> {
    await this.options.files.remove(attachment.volumePath);
    await this.options.store.delete(attachment.chatId, attachment.userId, attachment.id);
    const userSegment = sanitizeVolumeUserId(attachment.userId);
    const botSegment = sanitizeVolumeBotId(chat.botId);
    if (userSegment && botSegment) await this.options.usage.releaseBytes(userSegment, botSegment, attachment.sizeBytes);
  }
}

/** The head we already read, then the rest of the request, failing if the bytes disagree with Content-Length. */
async function* checkedBody(head: Buffer, rest: AsyncIterator<Uint8Array>, declared: number) {
  let sent = head.length;
  if (sent > declared) throw new AttachmentError(400, 'The upload is longer than its Content-Length');
  yield head;
  for (let next = await rest.next(); !next.done; next = await rest.next()) {
    sent += next.value.length;
    if (sent > declared) throw new AttachmentError(400, 'The upload is longer than its Content-Length');
    yield next.value;
  }
  if (sent !== declared) throw new AttachmentError(400, 'The upload is shorter than its Content-Length');
}
