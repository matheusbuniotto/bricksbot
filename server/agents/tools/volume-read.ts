import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ToolDefinition } from '../../../shared/agents/types.js';
import { normalizeHostUrl } from '../../chat/databricks-auth.js';
import { clip } from '../../lib/coerce.js';

export interface VolumeReadToolOptions {
  host?: string;
  getToken?: () => Promise<string>;
  fetchImpl?: typeof fetch;
  fsImpl?: {
    readFile(filePath: string): Promise<string>;
    readdir(dirPath: string): Promise<string[]>;
  };
  maxChars?: number;
}

export const volumeReadToolDefinition: ToolDefinition = {
  name: 'volume_read',
  description:
    'Read or list files in Databricks Unity Catalog Volumes (paths starting with /Volumes/...). Requires user approval.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      action: {
        type: 'string',
        enum: ['read', 'list'],
        description: 'Whether to "read" file text or "list" files in a directory.',
      },
      path: {
        type: 'string',
        description: 'Unity Catalog volume path, e.g. /Volumes/main/default/my_volume/file.csv',
      },
    },
    required: ['action', 'path'],
  },
};

export function validateVolumePath(rawPath: string): string | null {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    return 'volume_read requires a path';
  }
  if (!trimmed.startsWith('/Volumes/')) {
    return 'volume_read only accesses Unity Catalog Volumes paths starting with /Volumes/';
  }
  if (trimmed.includes('..') || trimmed.includes('\0')) {
    return 'volume_read does not allow path traversal (..)';
  }
  return null;
}

/** Files API URL with each path segment encoded, so `%2e%2e`, `?` or `#` cannot reach another endpoint. */
export function filesApiUrl(host: string, kind: 'files' | 'directories', volumePath: string): string {
  const encoded = volumePath.split('/').map(encodeURIComponent).join('/');
  return `${normalizeHostUrl(host)}/api/2.0/fs/${kind}${encoded}`;
}

type VolumeAction = 'read' | 'list';

function readAction(args: Record<string, unknown>): VolumeAction | null {
  return args.action === 'read' || args.action === 'list' ? args.action : null;
}

function formatListing(names: string[]): string {
  return names.length > 0 ? names.join('\n') : '(directory is empty)';
}

async function readFromLocalMount(action: VolumeAction, volumePath: string, maxChars: number): Promise<string> {
  const stat = await fs.stat(volumePath);
  if (action === 'read') {
    if (stat.isDirectory()) return `volume_read error: ${volumePath} is a directory. Use action "list".`;
    return clip(await fs.readFile(volumePath, 'utf8'), maxChars);
  }
  if (!stat.isDirectory()) return `volume_read error: ${volumePath} is a file. Use action "read".`;
  return formatListing(await fs.readdir(volumePath));
}

async function readFromFilesApi(
  action: VolumeAction,
  volumePath: string,
  maxChars: number,
  client: { host: string; getToken: () => Promise<string>; fetchImpl: typeof fetch }
): Promise<string> {
  const headers = { Authorization: `Bearer ${await client.getToken()}` };
  const kind = action === 'read' ? 'files' : 'directories';
  const res = await client.fetchImpl(filesApiUrl(client.host, kind, volumePath), { headers });
  if (!res.ok) {
    return `volume_read failed (${res.status}): unable to ${action} ${volumePath}`;
  }
  if (action === 'read') return clip(await res.text(), maxChars);
  const data = (await res.json()) as { contents?: Array<{ path?: string }> };
  return formatListing((data.contents ?? []).map((c) => path.basename(c.path ?? '')).filter(Boolean));
}

export function createVolumeReadTool(options: VolumeReadToolOptions = {}) {
  const maxChars = options.maxChars ?? 20_000;

  return {
    definition: volumeReadToolDefinition,
    preflight(args: Record<string, unknown>): string | null {
      if (!readAction(args)) {
        return 'volume_read requires action to be "read" or "list"';
      }
      return validateVolumePath(String(args.path ?? ''));
    },
    async execute(args: Record<string, unknown>): Promise<string> {
      const action = readAction(args);
      const volumePath = String(args.path ?? '').trim();

      const validationError = validateVolumePath(volumePath);
      if (validationError) return `volume_read error: ${validationError}`;
      if (!action) return 'volume_read error: action must be "read" or "list"';

      // Custom fsImpl (tests or local simulation).
      if (options.fsImpl) {
        try {
          if (action === 'read') return clip(await options.fsImpl.readFile(volumePath), maxChars);
          return formatListing(await options.fsImpl.readdir(volumePath));
        } catch (err) {
          return `volume_read error: ${err instanceof Error ? err.message : 'unknown file system error'}`;
        }
      }

      // Databricks Apps may mount Volumes at /Volumes/...; otherwise use the Files API.
      try {
        return await readFromLocalMount(action, volumePath, maxChars);
      } catch (localErr) {
        if (!options.host || !options.getToken) {
          const msg = localErr instanceof Error ? localErr.message : 'file not found';
          return `volume_read error: Volume path not found on workspace: ${msg}`;
        }
        try {
          return await readFromFilesApi(action, volumePath, maxChars, {
            host: options.host,
            getToken: options.getToken,
            fetchImpl: options.fetchImpl ?? globalThis.fetch,
          });
        } catch (restErr) {
          return `volume_read error: ${restErr instanceof Error ? restErr.message : 'REST error'}`;
        }
      }
    },
  };
}
