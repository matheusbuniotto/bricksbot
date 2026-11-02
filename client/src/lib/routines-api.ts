import type { Routine } from '../../../shared/routines/types';
import type { Message } from '../../../shared/chat/types';

export interface SetupStatus {
  provider: string;
  needsLlmSetup: boolean;
  lakebaseConfigured: boolean;
  secretsScope: string;
  secretKeys: string[];
  servingHint: string;
  putSecretExamples: string[];
  appPublicUrl?: string | null;
  routineWebhookSecretPutExample?: string[];
}

async function readJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export async function fetchSetupStatus(): Promise<SetupStatus> {
  return readJson(await fetch('/api/setup/status'));
}

export async function fetchRoutines(): Promise<Routine[]> {
  const data = await readJson<{ routines: Routine[] }>(await fetch('/api/routines'));
  return data.routines;
}

export async function createRoutine(input: {
  botId: string;
  name: string;
  cron: string;
  prompt?: string;
}): Promise<{ routine: Routine; webhookSecret: string }> {
  return readJson(
    await fetch('/api/routines', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
  );
}

export async function updateRoutine(
  id: string,
  patch: { enabled?: boolean; name?: string; cron?: string; prompt?: string }
): Promise<Routine> {
  const data = await readJson<{ routine: Routine }>(
    await fetch(`/api/routines/${id}/update`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    })
  );
  return data.routine;
}

export async function runRoutine(id: string): Promise<{
  routine: Routine;
  chat: { user: Message; assistant: Message | null; provider: string };
}> {
  return readJson(
    await fetch(`/api/routines/${id}/run`, {
      method: 'POST',
    })
  );
}

export async function deleteRoutine(id: string): Promise<void> {
  const res = await fetch(`/api/routines/${id}/delete`, { method: 'POST' });
  if (!res.ok && res.status !== 204) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
}
