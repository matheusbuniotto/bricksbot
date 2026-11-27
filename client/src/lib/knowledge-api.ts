import { knowledgeKindFor, type KnowledgeConfig, type KnowledgeDoc } from '../../../shared/knowledge/types';
import { formatBytes } from './attachments-api';
import { readJson } from './http';

export const fetchKnowledgeConfig = async (): Promise<KnowledgeConfig> =>
  readJson(await fetch('/api/knowledge/config'));

export async function listKnowledge(botId: string): Promise<KnowledgeDoc[]> {
  return (await readJson<{ docs: KnowledgeDoc[] }>(await fetch(`/api/bots/${botId}/knowledge`))).docs;
}

export async function uploadKnowledge(botId: string, file: File): Promise<KnowledgeDoc> {
  const { doc } = await readJson<{ doc: KnowledgeDoc }>(
    await fetch(`/api/bots/${botId}/knowledge?name=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: file,
    })
  );
  return doc;
}

export async function deleteKnowledge(botId: string, id: string): Promise<void> {
  await readJson(await fetch(`/api/bots/${botId}/knowledge/${id}/delete`, { method: 'POST' }));
}

/** Why this file cannot be added, or null. The server checks again. */
export function knowledgeProblem(file: File, config: KnowledgeConfig, count: number): string | null {
  if (count >= config.maxDocs) return `A bot holds at most ${config.maxDocs} knowledge files`;
  const kind = knowledgeKindFor(file.name);
  if (!kind) return `${file.name}: only ${config.extensions.join(', ')} files can be added`;
  const limit = kind === 'text' ? config.maxTextBytes : config.maxBytes;
  if (file.size > limit) return `${file.name} is over ${formatBytes(limit)}`;
  if (file.size === 0) return `${file.name} is empty`;
  return null;
}
