import { artifactPinPreviewLine, parseArtifactPinNotice } from '../../../shared/chat/artifact-pin-notice';
import { parseBotCreatedNotice } from '../../../shared/chat/bot-created-notice';
import { parseHandoffNotice } from '../../../shared/chat/handoff-notice';
import type { Message } from '../../../shared/chat/types';
import { toolLabel } from '../../../shared/agents/tool-labels';

export { approvalTitle, toolLabel } from '../../../shared/agents/tool-labels';

function looksLikeJsonBlob(content: string): boolean {
  const trimmed = content.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

/** One-line roster / list preview. Skips tool noise and raw system JSON. */
export function lastUserFacingPreview(messages: Message[]): string {
  for (const message of [...messages].reverse()) {
    if (message.role === 'tool') continue;

    if (message.role === 'system') {
      const created = parseBotCreatedNotice(message.content);
      if (created) {
        return `Created ${created.name}`;
      }
      const handoff = parseHandoffNotice(message.content);
      if (handoff) {
        if (handoff.direction === 'thread' && handoff.messageCount && handoff.messageCount > 0) {
          const n = handoff.messageCount;
          return `${n} message${n === 1 ? '' : 's'} with ${handoff.targetName}`;
        }
        if (handoff.replyPreview?.trim()) return handoff.replyPreview.trim();
        if (handoff.brief?.trim()) return handoff.brief.trim();
        if (handoff.direction === 'sent') return `Sent to ${handoff.targetName}`;
        if (handoff.direction === 'received') {
          return `From ${handoff.senderName || handoff.targetName}`;
        }
        continue;
      }
      const pin = parseArtifactPinNotice(message.content);
      if (pin) {
        return artifactPinPreviewLine(pin);
      }
      if (looksLikeJsonBlob(message.content)) continue;
      const plain = message.content.replace(/\s+/g, ' ').trim();
      if (plain) return plain;
      continue;
    }

    const plain = message.content.replace(/\s+/g, ' ').trim();
    if (plain) return plain;
  }
  return '';
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
  if (name) return `${label}: ${name}`;
  if (key) return `${label}: ${key}`;
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
