import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { filesApiUrl, validateVolumePath } from './volume-read.js';

export interface VolumeFileClient {
  host?: string;
  getToken?: () => Promise<string>;
  fetchImpl?: typeof fetch;
  /** Test double. When set, local disk and the Files API are not used. */
  writeFile?: (volumePath: string, data: Uint8Array, overwrite: boolean) => Promise<void>;
}

async function fileExists(volumePath: string): Promise<boolean> {
  try {
    await fs.stat(volumePath);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return false;
    throw err;
  }
}

export async function writeVolumeBytes(
  client: VolumeFileClient,
  volumePath: string,
  data: Uint8Array,
  overwrite: boolean
): Promise<void> {
  const invalid = validateVolumePath(volumePath);
  if (invalid) {
    throw new Error(invalid.replace(/^volume_read/, 'volume_write'));
  }

  if (client.writeFile) {
    await client.writeFile(volumePath, data, overwrite);
    return;
  }

  if (client.host && client.getToken) {
    const token = await client.getToken();
    const fetchImpl = client.fetchImpl ?? globalThis.fetch;
    const url = `${filesApiUrl(client.host, 'files', volumePath)}?overwrite=${overwrite}`;
    const res = await fetchImpl(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
      },
      body: Buffer.from(data),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (!overwrite && (res.status === 409 || /already exists/i.test(text))) {
        throw new Error('volume_write refused: file exists and overwrite is false');
      }
      throw new Error(`Volume upload failed (${res.status}): ${text || res.statusText}`);
    }
    return;
  }

  if (!overwrite && (await fileExists(volumePath))) {
    throw new Error('volume_write refused: file exists and overwrite is false');
  }
  await fs.mkdir(path.dirname(volumePath), { recursive: true });
  await fs.writeFile(volumePath, data);
}
