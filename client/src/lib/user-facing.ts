import type { Presence } from '../../../shared/chat/types';
import { toolLabel } from '../../../shared/agents/tool-labels';

export { approvalTitle, toolLabel } from '../../../shared/agents/tool-labels';
export { lastUserFacingPreview, messagePreviewLine } from '../../../shared/chat/preview';

function looksLikeJsonBlob(content: string): boolean {
  const trimmed = content.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

/** Tooltip / title for roster and header bot faces. */
export function presenceTooltip(presence: Presence): string {
  switch (presence) {
    case 'waiting':
      return 'Aguardando aprovação';
    case 'blocked':
      return 'Precisa de você';
    case 'thinking':
      return 'Pensando…';
    case 'working':
      return 'Executando…';
    case 'away':
      return 'Ausente';
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

/** Roster one-liner including live presence copy and optional Aguardando prefix. */
export function rosterPreviewForPresence(presence: Presence, messagePreview: string): string {
  const base = messagePreview.replace(/\s+/g, ' ').trim();
  if (presence === 'thinking') return 'Thinking…';
  if (presence === 'working') return 'Running…';
  if (presence === 'waiting') return base ? `Aguardando: ${base}` : 'Aguardando:';
  if (presence === 'blocked') return base ? `Precisa de você: ${base}` : 'Precisa de você';
  return base;
}

export interface ToolResultView {
  summary: string;
  detail: string;
  isError: boolean;
  /** True when detail is still mostly technical (JSON / dumps). */
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

/** Collapse tool rows into a short summary; keep raw payload for optional expand. */
export function toolResultView(content: string, toolNameHint = ''): ToolResultView {
  const fallback = toolNameHint ? toolLabel(toolNameHint) : 'Tool';
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const tool =
      typeof parsed.tool === 'string' ? parsed.tool : toolNameHint;
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
