import type { Presence } from '../../../shared/chat/types';
import { toolLabel } from '../../../shared/agents/tool-labels';
import { looksLikeJsonBlob } from '../../../shared/chat/preview';

export { approvalTitle, toolLabel } from '../../../shared/agents/tool-labels';
export { lastUserFacingPreview, messagePreviewLine } from '../../../shared/chat/preview';

/** Tools that only offer Once / Not approve (no Always allow). */
export function isOnceOnlyApproval(toolName: string): boolean {
  return (
    toolName === 'create_bot' ||
    toolName === 'ask_choice' ||
    toolName === 'delete_routine' ||
    toolName === 'sandbox_delete' ||
    toolName === 'genie_ask' ||
    toolName === 'ask_genie_space'
  );
}

export function presenceTooltip(presence: Presence): string {
  switch (presence) {
    case 'waiting':
      return 'Waiting for approval';
    case 'blocked':
      return 'Needs you';
    case 'thinking':
      return 'Thinking…';
    case 'working':
      return 'Running…';
    case 'away':
      return 'Away';
    case 'offline':
      return 'Offline';
    case 'online':
      return 'Online';
    default: {
      const _exhaustive: never = presence;
      return _exhaustive;
    }
  }
}

export function rosterPreviewForPresence(presence: Presence, messagePreview: string): string {
  const base = messagePreview.replace(/\s+/g, ' ').trim();
  if (presence === 'thinking') return 'Thinking…';
  if (presence === 'working') return 'Running…';
  if (presence === 'waiting') return base ? `Waiting: ${base}` : 'Waiting:';
  if (presence === 'blocked') return base ? `Needs you: ${base}` : 'Needs you';
  return base;
}

export interface ToolResultView {
  summary: string;
  detail: string;
  isError: boolean;
  technical: boolean;
}

function summarizeToolSubject(parsed: Record<string, unknown>, label: string): string {
  const name = typeof parsed.name === 'string' ? parsed.name.trim() : '';
  const key = typeof parsed.key === 'string' ? parsed.key.trim() : '';
  const title = typeof parsed.title === 'string' ? parsed.title.trim() : '';
  if (name) return `${label}: ${name}`;
  if (key) return `${label}: ${key}`;
  if (title) return `${label}: ${title}`;
  return label;
}

export function toolResultView(content: string, toolNameHint = ''): ToolResultView {
  const fallback = toolNameHint ? toolLabel(toolNameHint) : 'Tool';
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const tool = typeof parsed.tool === 'string' ? parsed.tool : toolNameHint;
    const label = tool ? toolLabel(tool) : fallback;

    if (typeof parsed.error === 'string' && parsed.error.trim()) {
      return {
        summary: `${summarizeToolSubject(parsed, label)} failed`,
        detail: parsed.error.trim(),
        isError: true,
        technical: false,
      };
    }

    const preferred =
      (typeof parsed.result === 'string' && parsed.result) ||
      (typeof parsed.message === 'string' && parsed.message) ||
      (typeof parsed.content === 'string' && parsed.content) ||
      (typeof parsed.stdout === 'string' && parsed.stdout.trim()) ||
      (typeof parsed.volumePath === 'string' && parsed.volumePath.trim()) ||
      null;

    if (preferred) {
      return {
        summary: summarizeToolSubject(parsed, label),
        detail: preferred,
        isError: false,
        technical: false,
      };
    }

    return {
      summary: summarizeToolSubject(parsed, label),
      detail: JSON.stringify(parsed, null, 2),
      isError: false,
      technical: true,
    };
  } catch {
    const plain = content.trim();
    return {
      summary: fallback,
      detail: plain,
      isError: false,
      technical: looksLikeJsonBlob(plain),
    };
  }
}
