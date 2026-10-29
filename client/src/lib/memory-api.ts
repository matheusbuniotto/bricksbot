import type { BotMemory, BotSkill } from '../../../shared/agents/memory/types';

async function readJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export async function fetchMemories(botId: string): Promise<BotMemory[]> {
  const data = await readJson<{ memories: BotMemory[] }>(await fetch(`/api/bots/${botId}/memories`));
  return data.memories;
}

export async function upsertMemory(botId: string, key: string, content: string): Promise<BotMemory> {
  const data = await readJson<{ memory: BotMemory }>(
    await fetch(`/api/bots/${botId}/memories`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, content }),
    })
  );
  return data.memory;
}

export async function fetchSkills(botId: string): Promise<BotSkill[]> {
  const data = await readJson<{ skills: BotSkill[] }>(await fetch(`/api/bots/${botId}/skills`));
  return data.skills;
}

export async function createSkill(botId: string, name: string, body: string): Promise<BotSkill> {
  const data = await readJson<{ skill: BotSkill }>(
    await fetch(`/api/bots/${botId}/skills`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, body }),
    })
  );
  return data.skill;
}

export async function deleteSkill(botId: string, skillId: string): Promise<void> {
  const res = await fetch(`/api/bots/${botId}/skills/${skillId}`, { method: 'DELETE' });
  if (res.status === 204) return;
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  throw new Error(body.error ?? `Request failed (${res.status})`);
}
