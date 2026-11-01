import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { parseArtifactPinNotice } from '../../../shared/chat/artifact-pin-notice';
import { parseBotCreatedNotice } from '../../../shared/chat/bot-created-notice';
import {
  indexChoiceAnswers,
  parseChoiceAnswerNotice,
  parseChoicePromptNotice,
} from '../../../shared/chat/choice-notice';
import {
  collapseHandoffNotices,
  parseHandoffNotice,
  type HandoffNotice,
} from '../../../shared/chat/handoff-notice';
import type { Bot, Message } from '../../../shared/chat/types';
import {
  formatChatTimeSeparator,
  shouldShowChatTimeSeparator,
} from '../lib/chat-time';
import { toolResultView } from '../lib/user-facing';
import { ArtifactPinStatus } from './ArtifactPinStatus';
import { BotCreatedStatus } from './BotCreatedStatus';
import { ChatMarkdown } from './ChatMarkdown';
import { HandoffPeek } from './HandoffPeek';
import { HandoffStatus } from './HandoffStatus';
import { ChoiceAnswerStatus, ChoicePromptStatus } from './ChoicePromptStatus';

function isHandoffToolEcho(content: string): boolean {
  return /^Handed off to .+\./i.test(content.trim());
}

function isCreateBotToolEcho(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed.startsWith('{')) return false;
  try {
    const parsed = JSON.parse(trimmed) as { tool?: string; ok?: boolean };
    return parsed.tool === 'create_bot' && parsed.ok === true;
  } catch {
    return false;
  }
}

function isPinToolEcho(content: string, toolName: string): boolean {
  if (toolName !== 'pin_artifact' && toolName !== 'pin_chart') return false;
  const trimmed = content.trim();
  if (!trimmed.startsWith('{')) return false;
  try {
    const parsed = JSON.parse(trimmed) as { ok?: boolean; messageId?: string };
    return parsed.ok === true && typeof parsed.messageId === 'string';
  } catch {
    return false;
  }
}

function isRawSystemBlob(content: string): boolean {
  if (
    parseHandoffNotice(content) ||
    parseBotCreatedNotice(content) ||
    parseArtifactPinNotice(content) ||
    parseChoicePromptNotice(content) ||
    parseChoiceAnswerNotice(content)
  ) {
    return false;
  }
  const trimmed = content.trim();
  if (/^\[routine:[^\]]+\] scheduled run$/i.test(trimmed)) return false;
  if (/^\[routine:[^\]]+\] (created|updated|deleted)\b/i.test(trimmed)) return false;
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

/** Legacy synthetic wait copy — approval cards own that state now. */
function isApprovalWaitBubble(content: string): boolean {
  return /^Waiting for your approval:/i.test(content.trim());
}

type TranscriptRow =
  | { kind: 'message'; message: Message }
  | {
      kind: 'tool_group';
      id: string;
      messages: Message[];
      toolName: string;
    };

function buildTranscriptRows(
  messages: Message[],
  toolNameByCallId: Map<string, string>,
): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  for (const message of messages) {
    if (message.role === 'tool') {
      const toolName = message.toolCallId
        ? (toolNameByCallId.get(message.toolCallId) ?? '')
        : '';
      const prev = rows[rows.length - 1];
      if (prev?.kind === 'tool_group' && prev.toolName === toolName && toolName) {
        prev.messages.push(message);
        continue;
      }
      rows.push({
        kind: 'tool_group',
        id: message.id,
        messages: [message],
        toolName,
      });
      continue;
    }
    rows.push({ kind: 'message', message });
  }
  return rows;
}

export function ChatTranscript({
  messages,
  botName: _botName,
  accent,
  botId: _botId,
  thinking,
  thinkingLabel = 'Thinking',
  bots = [],
  onOpenBot,
}: {
  messages: Message[];
  botName?: string | null;
  accent: string;
  botId?: string;
  thinking?: boolean;
  /** Accessible + visible status while the bot is thinking/working. */
  thinkingLabel?: string;
  bots?: Bot[];
  onOpenBot?: (botId: string) => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [peek, setPeek] = useState<HandoffNotice | null>(null);

  const toolNameByCallId = useMemo(() => {
    const map = new Map<string, string>();
    for (const message of messages) {
      if (message.role !== 'assistant' || !message.toolCalls?.length) continue;
      for (const call of message.toolCalls) {
        map.set(call.id, call.name);
      }
    }
    return map;
  }, [messages]);

  const choiceAnswers = useMemo(() => indexChoiceAnswers(messages), [messages]);

  const visible = useMemo(
    () =>
      collapseHandoffNotices(
        messages.filter((message) => {
          if (message.role === 'system' && isRawSystemBlob(message.content)) return false;
          if (message.role === 'assistant') {
            const trimmed = message.content.trim();
            if (!trimmed || isApprovalWaitBubble(trimmed)) return false;
          }
          if (message.role !== 'tool') return true;
          const toolName = message.toolCallId
            ? (toolNameByCallId.get(message.toolCallId) ?? '')
            : '';
          if (
            isHandoffToolEcho(message.content) ||
            isCreateBotToolEcho(message.content) ||
            isPinToolEcho(message.content, toolName) ||
            parseHandoffNotice(message.content)
          ) {
            return false;
          }
          // Successful tool chips are noise in the transcript (assistant already narrates).
          // Keep failures visible so the user can see what blocked.
          const view = toolResultView(message.content, toolName);
          if (!view.isError) return false;
          return true;
        }),
        (message) => message.role === 'system',
      ),
    [messages, toolNameByCallId],
  );

  const rows = useMemo(
    () => buildTranscriptRows(visible, toolNameByCallId),
    [visible, toolNameByCallId],
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [rows.length, thinking, thinkingLabel]);

  return (
    <div className="transcript">
      <div className="transcript-column">
        {rows.map((row, index) => {
          const message = row.kind === 'message' ? row.message : row.messages[0]!;
          const prevRow = index > 0 ? rows[index - 1] : undefined;
          const prevMessage = prevRow
            ? prevRow.kind === 'message'
              ? prevRow.message
              : prevRow.messages[0]
            : undefined;
          const timeLabel =
            prevMessage && shouldShowChatTimeSeparator(prevMessage.createdAt, message.createdAt)
              ? formatChatTimeSeparator(message.createdAt)
              : null;
          const timeSep = timeLabel ? (
            <div className="transcript-time-sep" role="separator" aria-label={timeLabel}>
              {timeLabel}
            </div>
          ) : null;

          if (row.kind === 'tool_group') {
            const primary = row.messages[0]!;
            const view = toolResultView(primary.content, row.toolName);
            const count = row.messages.length;
            const summary =
              count > 1 ? `${view.summary} · ${count}` : view.summary;
            return (
              <Fragment key={row.id}>
                {timeSep}
                <div className="message message-tool message-enter">
                  <details className="tool-accordion">
                    <summary className="tool-summary">
                      <span className="tool-summary-text">{summary}</span>
                    </summary>
                    {count === 1 ? (
                      view.technical ? (
                        <details className="tool-tech">
                          <summary className="tool-tech-summary">Technical details</summary>
                          <pre className="tool-output">
                            <code>{view.detail}</code>
                          </pre>
                        </details>
                      ) : (
                        <div className="tool-output tool-output-plain">
                          <ChatMarkdown content={view.detail} />
                        </div>
                      )
                    ) : (
                      <div className="tool-group-list">
                        {row.messages.map((item, i) => {
                          const itemView = toolResultView(item.content, row.toolName);
                          return (
                            <details key={item.id} className="tool-tech">
                              <summary className="tool-tech-summary">
                                {i + 1}. {itemView.summary}
                              </summary>
                              {itemView.technical ? (
                                <pre className="tool-output">
                                  <code>{itemView.detail}</code>
                                </pre>
                              ) : (
                                <div className="tool-output tool-output-plain">
                                  <ChatMarkdown content={itemView.detail} />
                                </div>
                              )}
                            </details>
                          );
                        })}
                      </div>
                    )}
                  </details>
                </div>
              </Fragment>
            );
          }

          const isUser = message.role === 'user';
          const isSystem = message.role === 'system';

          if (isSystem) {
            const handoff = parseHandoffNotice(message.content);
            if (handoff) {
              return (
                <Fragment key={message.id}>
                  {timeSep}
                  <HandoffStatus notice={handoff} onOpen={setPeek} />
                </Fragment>
              );
            }
            const created = parseBotCreatedNotice(message.content);
            if (created) {
              return (
                <Fragment key={message.id}>
                  {timeSep}
                  <BotCreatedStatus notice={created} onOpenBot={onOpenBot} />
                </Fragment>
              );
            }
            const pinned = parseArtifactPinNotice(message.content);
            if (pinned) {
              return (
                <Fragment key={message.id}>
                  {timeSep}
                  <ArtifactPinStatus notice={pinned} />
                </Fragment>
              );
            }
            const choicePrompt = parseChoicePromptNotice(message.content);
            if (choicePrompt) {
              return (
                <Fragment key={message.id}>
                  {timeSep}
                  <div className="message message-system message-enter">
                    <ChoicePromptStatus
                      notice={choicePrompt}
                      selectedOption={choiceAnswers.get(choicePrompt.id)}
                    />
                  </div>
                </Fragment>
              );
            }
            const choiceAnswer = parseChoiceAnswerNotice(message.content);
            if (choiceAnswer) {
              return (
                <Fragment key={message.id}>
                  {timeSep}
                  <div className="message message-system message-enter">
                    <ChoiceAnswerStatus notice={choiceAnswer} />
                  </div>
                </Fragment>
              );
            }
          }

          const className = isSystem
            ? 'message message-system message-enter'
            : isUser
              ? 'message message-user message-enter'
              : 'message message-enter';
          const bodyClass = isSystem
            ? 'message-body message-body-system message-body-md'
            : isUser
              ? 'message-body message-body-user'
              : 'message-body message-body-md';

          return (
            <Fragment key={message.id}>
              {timeSep}
              <div className={className}>
                <div className={bodyClass} style={isUser ? { background: accent } : undefined}>
                  {isUser ? message.content : <ChatMarkdown content={message.content} />}
                </div>
              </div>
            </Fragment>
          );
        })}
        {thinking ? (
          <div className="message message-enter" aria-live="polite">
            <div className="message-body typing-status">
              <div className="typing-dots" aria-label={thinkingLabel}>
                <span />
                <span />
                <span />
              </div>
              <span className="typing-status-label">{thinkingLabel}…</span>
            </div>
          </div>
        ) : null}
        <div ref={bottomRef} />
      </div>

      {peek ? (
        <HandoffPeek
          notice={peek}
          bots={bots}
          onClose={() => setPeek(null)}
          onOpenBot={(botId) => {
            onOpenBot?.(botId);
            setPeek(null);
          }}
        />
      ) : null}
    </div>
  );
}
