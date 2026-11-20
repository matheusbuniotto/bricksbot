import type {
  Bot,
  Chat,
  MarketplaceBot,
  Message,
  SearchHit,
  Space,
  SpaceMember,
  WorkspaceUser,
} from '../../../shared/chat/types';
import type { PendingChoice } from '../../../shared/chat/choice-notice';
import type { ApprovalDecision, ApprovalRequest, ModelOption } from '../../../shared/agents/types';
import type { SandboxUiStatus } from '../../../shared/sandbox/types';
import type { DatabricksMcpApp } from '../../../shared/agents/mcp-types';
import { readJson } from './http';

export interface ModelCatalogView {
  models: ModelOption[];
  /** The model that runs when a bot or routine picks none. */
  default: string | null;
}

export async function fetchModels(): Promise<ModelCatalogView> {
  return readJson(await fetch('/api/models'));
}

export async function fetchSpaces(): Promise<Space[]> {
  const data = await readJson<{ spaces: Space[] }>(await fetch('/api/spaces'));
  return data.spaces;
}

export async function createSpace(name: string): Promise<Space> {
  const data = await readJson<{ space: Space }>(
    await fetch('/api/spaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    })
  );
  return data.space;
}

export async function fetchSpaceMembers(
  spaceId: string
): Promise<{ members: SpaceMember[]; canManage: boolean; callerId: string | null }> {
  const data = await readJson<{ members: SpaceMember[]; canManage?: boolean; callerId?: string }>(
    await fetch(`/api/spaces/${spaceId}/members`)
  );
  return { members: data.members, canManage: data.canManage === true, callerId: data.callerId ?? null };
}

/** Remove a member, or leave the space when `userId` is the caller. */
export async function removeSpaceMember(spaceId: string, userId: string): Promise<void> {
  const res = await fetch(`/api/spaces/${spaceId}/members/${encodeURIComponent(userId)}`, { method: 'DELETE' });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
}

export async function addSpaceMember(
  spaceId: string,
  userId: string,
  role: SpaceMember['role'] = 'member'
): Promise<SpaceMember> {
  const data = await readJson<{ member: SpaceMember }>(
    await fetch(`/api/spaces/${spaceId}/members`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId, role }),
    })
  );
  return data.member;
}

export async function searchWorkspaceUsers(
  spaceId: string,
  query: string,
  signal?: AbortSignal
): Promise<WorkspaceUser[]> {
  const params = new URLSearchParams({ q: query });
  const data = await readJson<{ users: WorkspaceUser[] }>(
    await fetch(`/api/spaces/${encodeURIComponent(spaceId)}/users/search?${params.toString()}`, {
      signal,
    })
  );
  return data.users;
}

export async function fetchBots(
  spaceId?: string | null,
  archived: 'active' | 'archived' | 'all' = 'active'
): Promise<Bot[]> {
  const params = new URLSearchParams();
  if (spaceId !== undefined) params.set('spaceId', spaceId ?? 'null');
  if (archived !== 'active') params.set('archived', archived);
  const query = params.size ? `?${params.toString()}` : '';
  const data = await readJson<{ bots: Bot[] }>(await fetch(`/api/bots${query}`));
  return data.bots;
}

export async function createBot(input: {
  name: string;
  spaceId?: string | null;
  avatarLabel?: string;
  description?: string;
  isShared?: boolean;
}): Promise<Bot> {
  const data = await readJson<{ bot: Bot }>(
    await fetch('/api/bots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
  );
  return data.bot;
}

export async function updateBot(
  botId: string,
  input: {
    name?: string;
    spaceId?: string | null;
    avatarLabel?: string;
    description?: string;
    isShared?: boolean;
    model?: string | null;
  }
): Promise<Bot> {
  const data = await readJson<{ bot: Bot }>(
    await fetch(`/api/bots/${botId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
  );
  return data.bot;
}

export async function fetchMarketplaceBots(): Promise<MarketplaceBot[]> {
  const data = await readJson<{ bots: MarketplaceBot[] }>(await fetch('/api/marketplace/bots'));
  return data.bots;
}

export async function installMarketplaceBot(botId: string, spaceId?: string | null): Promise<Bot> {
  const data = await readJson<{ bot: Bot }>(
    await fetch(`/api/marketplace/bots/${encodeURIComponent(botId)}/install`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ spaceId: spaceId ?? null }),
    })
  );
  return data.bot;
}

export async function moveBot(botId: string, input: { spaceId: string | null; index: number }): Promise<Bot> {
  const data = await readJson<{ bot: Bot }>(
    await fetch(`/api/bots/${botId}/move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
  );
  return data.bot;
}

export async function archiveBot(botId: string): Promise<Bot> {
  const data = await readJson<{ bot: Bot }>(await fetch(`/api/bots/${botId}/archive`, { method: 'POST' }));
  return data.bot;
}

export async function unarchiveBot(botId: string): Promise<Bot> {
  const data = await readJson<{ bot: Bot }>(await fetch(`/api/bots/${botId}/unarchive`, { method: 'POST' }));
  return data.bot;
}

export async function deleteBot(botId: string): Promise<void> {
  const res = await fetch(`/api/bots/${botId}`, { method: 'DELETE' });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
}

export async function fetchBotChat(botId: string) {
  return fetchChatPayload(`/api/bots/${botId}/chat`);
}

/** A specific chat, e.g. the handoff chat a notice points at. */
export async function fetchChat(chatId: string) {
  return fetchChatPayload(`/api/chats/${chatId}`);
}

/** Every active chat the caller has with the bot (user, routine and handoff), newest first. */
export async function fetchChats(botId: string): Promise<Chat[]> {
  return (await readJson<{ chats: Chat[] }>(await fetch(`/api/bots/${botId}/chats`))).chats;
}

export async function createChat(botId: string): Promise<Chat> {
  const res = await fetch(`/api/bots/${botId}/chats`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  return (await readJson<{ chat: Chat }>(res)).chat;
}

export async function renameChat(chatId: string, title: string): Promise<Chat> {
  const res = await fetch(`/api/chats/${chatId}/update`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  return (await readJson<{ chat: Chat }>(res)).chat;
}

export async function archiveChat(chatId: string): Promise<Chat> {
  return (await readJson<{ chat: Chat }>(await fetch(`/api/chats/${chatId}/archive`, { method: 'POST' }))).chat;
}

/** The caller's own conversations that mention every word of `query`. */
export async function searchChats(query: string, signal?: AbortSignal): Promise<SearchHit[]> {
  const params = new URLSearchParams({ q: query });
  return (await readJson<{ hits: SearchHit[] }>(await fetch(`/api/search?${params.toString()}`, { signal }))).hits;
}

async function fetchChatPayload(url: string): Promise<{
  chat: Chat;
  messages: Message[];
  pendingApprovals: ApprovalRequest[];
  pendingChoices: PendingChoice[];
  autoApprovedTools: string[];
  sandboxStatus: SandboxUiStatus | null;
}> {
  const data = await readJson<{
    chat: Chat;
    messages: Message[];
    pendingApprovals?: ApprovalRequest[];
    pendingChoices?: PendingChoice[];
    autoApprovedTools?: string[];
    sandboxStatus?: SandboxUiStatus;
  }>(await fetch(url));
  return {
    chat: data.chat,
    messages: data.messages,
    pendingApprovals: data.pendingApprovals ?? [],
    pendingChoices: data.pendingChoices ?? [],
    autoApprovedTools: data.autoApprovedTools ?? [],
    sandboxStatus: data.sandboxStatus ?? null,
  };
}

export async function stopBotSandbox(botId: string, chatId: string): Promise<SandboxUiStatus> {
  const data = await readJson<{ sandbox: SandboxUiStatus }>(
    await fetch(`/api/bots/${botId}/sandbox/stop?chatId=${chatId}`, { method: 'POST' })
  );
  return data.sandbox;
}

export async function deleteBotSandbox(botId: string, chatId: string): Promise<SandboxUiStatus> {
  const data = await readJson<{ sandbox: SandboxUiStatus }>(
    await fetch(`/api/bots/${botId}/sandbox?chatId=${chatId}`, { method: 'DELETE' })
  );
  return data.sandbox;
}

/** `crypto.randomUUID` exists only in secure contexts; plain http on a LAN IP falls back to getRandomValues. */
export function newRequestId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** What a run reports while it works; `llm.delta` carries live text and is never replayed. */
export interface RunUpdate {
  type:
    | 'run.started'
    | 'llm.delta'
    | 'tool.started'
    | 'tool.finished'
    | 'approval.pending'
    | 'assistant.committed'
    | 'run.finished';
  payload: Record<string, unknown>;
}

/** How a run ended. `waiting` means it paused on approvals or a choice. */
export interface RunOutcome {
  status: 'waiting' | 'completed' | 'failed' | 'stopped';
  error?: string;
}

const POLL_MS = 1500;
/** Safety net beside the stream: a gateway that buffers SSE delivers nothing and raises no error. */
const WATCHDOG_MS = 5000;
const MAX_STREAM_FAILURES = 3;

type RunState = { status: RunOutcome['status'] | 'running'; error?: string };

async function fetchRun(chatId: string, runId: string): Promise<RunState> {
  const { run } = await readJson<{ run: RunState }>(await fetch(`/api/chats/${chatId}/runs/${runId}`));
  return { status: run.status, error: run.error };
}

/** Without a live feed the run is checked every 1.5 s; the outcome is the same, the progress updates are lost. */
async function pollRun(chatId: string, runId: string): Promise<RunOutcome> {
  for (;;) {
    const run = await fetchRun(chatId, runId);
    if (run.status !== 'running') return run as RunOutcome;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

/**
 * Follow a run to its end over server-sent events. The server closes each stream after about 90 s and
 * EventSource reconnects on its own, resuming from the last event id; three connection failures in a row
 * (or a refusal) fall back to polling, and a slow status check runs alongside in case the stream goes quiet.
 */
export function followRun(chatId: string, runId: string, onUpdate?: (update: RunUpdate) => void): Promise<RunOutcome> {
  if (typeof EventSource === 'undefined') return pollRun(chatId, runId);
  return new Promise((resolve, reject) => {
    const source = new EventSource(`/api/chats/${chatId}/runs/${runId}/events`);
    let failures = 0;
    const end = () => {
      source.close();
      clearInterval(watchdog);
    };
    const watchdog = setInterval(() => {
      fetchRun(chatId, runId)
        .then((run) => {
          if (run.status === 'running') return;
          end();
          resolve(run as RunOutcome);
        })
        .catch(() => {});
    }, WATCHDOG_MS);

    source.onopen = () => {
      failures = 0;
    };
    source.onmessage = (message) => {
      const update = JSON.parse(message.data as string) as RunUpdate;
      onUpdate?.(update);
      if (update.type === 'run.finished') {
        const { status, error } = update.payload as { status: RunOutcome['status']; error?: string };
        end();
        resolve({ status, error });
      }
    };
    source.onerror = () => {
      failures += 1;
      if (failures < MAX_STREAM_FAILURES && source.readyState !== EventSource.CLOSED) return;
      end();
      pollRun(chatId, runId).then(resolve, reject);
    };
  });
}

/** Starts the work detached (202 with the run id), then follows the run until it settles. */
async function startAndFollow(
  chatId: string,
  path: string,
  body: Record<string, unknown>,
  onUpdate?: (update: RunUpdate) => void
): Promise<RunOutcome> {
  const { runId } = await readJson<{ runId: string }>(
    await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, async: true }),
    })
  );
  return followRun(chatId, runId, onUpdate);
}

/**
 * `requestId` makes a replayed POST (proxy or browser retry) join the first run instead of starting another.
 * Resolves when the run settles; reload the chat for the messages, approvals and choices it left.
 */
export function sendChatMessage(
  chatId: string,
  content: string,
  onUpdate?: (update: RunUpdate) => void,
  requestId: string = newRequestId()
): Promise<RunOutcome> {
  return startAndFollow(chatId, `/api/chats/${chatId}/messages`, { content, requestId }, onUpdate);
}

/** Stop whatever the chat is running. A no-op when it already finished. */
export async function stopActiveRun(chatId: string): Promise<void> {
  const { run } = await readJson<{ run: { id: string } | null }>(await fetch(`/api/chats/${chatId}/runs/active`));
  if (!run) return;
  await readJson(await fetch(`/api/chats/${chatId}/runs/${run.id}/stop`, { method: 'POST' }));
}

export function decideApproval(
  chatId: string,
  approvalId: string,
  decision: ApprovalDecision,
  onUpdate?: (update: RunUpdate) => void
): Promise<RunOutcome> {
  return startAndFollow(chatId, `/api/approvals/${approvalId}/decide`, { decision }, onUpdate);
}

export function submitChoice(
  chatId: string,
  choiceId: string,
  selectedOption: string,
  onUpdate?: (update: RunUpdate) => void
): Promise<RunOutcome> {
  return startAndFollow(chatId, `/api/chats/${chatId}/choices/${choiceId}`, { selectedOption }, onUpdate);
}

export async function revokeAutoApproval(chatId: string, toolName?: string): Promise<{ autoApprovedTools: string[] }> {
  if (toolName) {
    return readJson(
      await fetch(`/api/chats/${chatId}/approvals/auto/${encodeURIComponent(toolName)}`, {
        method: 'DELETE',
      })
    );
  }
  return readJson(
    await fetch(`/api/chats/${chatId}/approvals/auto/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
  );
}

export async function fetchAutoApprovedTools(chatId: string): Promise<{ autoApprovedTools: string[] }> {
  return readJson(await fetch(`/api/chats/${chatId}/approvals/auto`));
}

export async function fetchMcps(refresh = false): Promise<DatabricksMcpApp[]> {
  const query = refresh ? '?refresh=true' : '';
  const data = await readJson<{ mcps: DatabricksMcpApp[] }>(await fetch(`/api/mcps${query}`));
  return data.mcps;
}

export async function connectMcp(service: string): Promise<DatabricksMcpApp> {
  const data = await readJson<{ mcp: DatabricksMcpApp }>(
    await fetch('/api/mcps/connect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ service }),
    })
  );
  return data.mcp;
}

export async function disconnectMcp(service: string): Promise<boolean> {
  const data = await readJson<{ success: boolean }>(
    await fetch(`/api/mcps/connect/${encodeURIComponent(service)}`, {
      method: 'DELETE',
    })
  );
  return data.success;
}

export async function registerCustomMcp(
  service: string,
  meta?: { name?: string; description?: string }
): Promise<DatabricksMcpApp> {
  const data = await readJson<{ mcp: DatabricksMcpApp }>(
    await fetch('/api/mcps/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ service, ...meta }),
    })
  );
  return data.mcp;
}

export async function removeCustomMcp(service: string): Promise<boolean> {
  const data = await readJson<{ success: boolean }>(
    await fetch(`/api/mcps/${encodeURIComponent(service)}`, {
      method: 'DELETE',
    })
  );
  return data.success;
}
