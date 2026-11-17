import type { Bot, Chat, MarketplaceBot, Message, Space, SpaceMember, WorkspaceUser } from '../../../shared/chat/types';
import type { PendingChoice } from '../../../shared/chat/choice-notice';
import type { ApprovalDecision, ApprovalRequest } from '../../../shared/agents/types';
import type { SandboxUiStatus } from '../../../shared/sandbox/types';
import type { DatabricksMcpApp } from '../../../shared/agents/mcp-types';
import { readJson } from './http';

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

export async function fetchBotChat(botId: string): Promise<{
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
  }>(await fetch(`/api/bots/${botId}/chat`));
  return {
    chat: data.chat,
    messages: data.messages,
    pendingApprovals: data.pendingApprovals ?? [],
    pendingChoices: data.pendingChoices ?? [],
    autoApprovedTools: data.autoApprovedTools ?? [],
    sandboxStatus: data.sandboxStatus ?? null,
  };
}

export async function stopBotSandbox(botId: string): Promise<SandboxUiStatus> {
  const data = await readJson<{ sandbox: SandboxUiStatus }>(
    await fetch(`/api/bots/${botId}/sandbox/stop`, { method: 'POST' })
  );
  return data.sandbox;
}

export async function deleteBotSandbox(botId: string): Promise<SandboxUiStatus> {
  const data = await readJson<{ sandbox: SandboxUiStatus }>(
    await fetch(`/api/bots/${botId}/sandbox`, { method: 'DELETE' })
  );
  return data.sandbox;
}

export async function sendChatMessage(
  chatId: string,
  content: string
): Promise<{
  user: Message;
  assistant: Message | null;
  pendingApprovals: ApprovalRequest[];
  pendingChoices?: PendingChoice[];
  autoApprovedTools?: string[];
  provider: string;
}> {
  return readJson(
    await fetch(`/api/chats/${chatId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content }),
    })
  );
}

export async function decideApproval(
  approvalId: string,
  decision: ApprovalDecision
): Promise<{
  assistant: Message | null;
  pendingApprovals: ApprovalRequest[];
  pendingChoices?: PendingChoice[];
  autoApprovedTools?: string[];
}> {
  return readJson(
    await fetch(`/api/approvals/${approvalId}/decide`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision }),
    })
  );
}

export async function submitChoice(
  chatId: string,
  choiceId: string,
  selectedOption: string
): Promise<{
  assistant: Message | null;
  pendingApprovals: ApprovalRequest[];
  pendingChoices?: PendingChoice[];
  autoApprovedTools?: string[];
}> {
  return readJson(
    await fetch(`/api/chats/${chatId}/choices/${choiceId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ selectedOption }),
    })
  );
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
