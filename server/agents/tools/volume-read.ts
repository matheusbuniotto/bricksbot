import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ToolDefinition } from '../../../shared/agents/types.js';

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
  if (trimmed.includes('..')) {
    return 'volume_read does not allow path traversal (..)';
  }
  return null;
}

export function createVolumeReadTool(options: VolumeReadToolOptions = {}) {
  const maxChars = options.maxChars ?? 20_000;

  return {
    definition: volumeReadToolDefinition,
    preflight(args: Record<string, unknown>): string | null {
      const action = String(args.action ?? '');
      if (action !== 'read' && action !== 'list') {
        return 'volume_read requires action to be "read" or "list"';
      }
      return validateVolumePath(String(args.path ?? ''));
    },
    async execute(args: Record<string, unknown>): Promise<string> {
      const action = String(args.action ?? '');
      const rawPath = String(args.path ?? '').trim();

      const validationError = validateVolumePath(rawPath);
      if (validationError) return `volume_read error: ${validationError}`;

      if (action !== 'read' && action !== 'list') {
        return 'volume_read error: action must be "read" or "list"';
      }

      // If custom fsImpl provided (e.g. for testing or local simulation)
      if (options.fsImpl) {
        try {
          if (action === 'read') {
            const content = await options.fsImpl.readFile(rawPath);
            return content.length > maxChars ? `${content.slice(0, maxChars)}\n…[truncated]` : content;
          }
          const files = await options.fsImpl.readdir(rawPath);
          return files.length > 0 ? files.join('\n') : '(directory is empty)';
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'unknown file system error';
          return `volume_read error: ${msg}`;
        }
      }

      // Try local filesystem mount (Databricks Apps mount Volumes at /Volumes/...)
      try {
        const stat = await fs.stat(rawPath);
        if (action === 'read') {
          if (stat.isDirectory()) {
            return `volume_read error: ${rawPath} is a directory. Use action "list".`;
          }
          const content = await fs.readFile(rawPath, 'utf8');
          return content.length > maxChars ? `${content.slice(0, maxChars)}\n…[truncated]` : content;
        }

        if (!stat.isDirectory()) {
          return `volume_read error: ${rawPath} is a file. Use action "read".`;
        }
        const entries = await fs.readdir(rawPath);
        return entries.length > 0 ? entries.join('\n') : '(directory is empty)';
      } catch (localErr) {
        // If not accessible on local disk and workspace token/host available, try REST API /api/2.0/fs/files
        if (options.host && options.getToken) {
          try {
            const token = await options.getToken();
            const host = options.host.replace(/\/+$/, '');
            const fetchImpl = options.fetchImpl ?? globalThis.fetch;

            if (action === 'read') {
              const url = `${host}/api/2.0/fs/files${rawPath}`;
              const res = await fetchImpl(url, {
                headers: { Authorization: `Bearer ${token}` },
              });
              if (!res.ok) {
                return `volume_read failed (${res.status}): unable to read ${rawPath}`;
              }
              const text = await res.text();
              return text.length > maxChars ? `${text.slice(0, maxChars)}\n…[truncated]` : text;
            }

            const url = `${host}/api/2.0/fs/directories${rawPath}`;
            const res = await fetchImpl(url, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) {
              return `volume_read failed (${res.status}): unable to list ${rawPath}`;
            }
            const data = (await res.json()) as { contents?: Array<{ path?: string }> };
            const names = (data.contents ?? [])
              .map((c) => path.basename(c.path ?? ''))
              .filter(Boolean);
            return names.length > 0 ? names.join('\n') : '(directory is empty)';
          } catch (restErr) {
            const msg = restErr instanceof Error ? restErr.message : 'REST error';
            return `volume_read error: ${msg}`;
          }
        }

        const msg = localErr instanceof Error ? localErr.message : 'file not found';
        return `volume_read error: Volume path not found on workspace: ${msg}`;
      }
    },
  };
}
