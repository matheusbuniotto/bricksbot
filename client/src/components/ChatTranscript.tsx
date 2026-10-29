import { useEffect, useMemo, useRef, useState } from 'react';
import {
  collapseHandoffNotices,
  parseHandoffNotice,
  type HandoffNotice,
} from '../../../shared/chat/handoff-notice';
import type { Bot, Message } from '../../../shared/chat/types';
import { toolResultView } from '../lib/user-facing';
import { BotFace } from './BotFace';
import { ChatMarkdown } from './ChatMarkdown';
import { HandoffPeek } from './HandoffPeek';
import { HandoffStatus } from './HandoffStatus';

function isHandoffToolEcho(content: string): boolean {
  return /^Handed off to .+\./i.test(content.trim());
}

function isRawSystemBlob(content: string): boolean {
  if (parseHandoffNotice(content)) return false;
  const trimmed = content.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

export function ChatTranscript({
  messages,
  botName,
  accent,
  botId,
  thinking,
  bots = [],
  onOpenBot,
}: {
  messages: Message[];
  botName: string | null;
  accent: string;
  botId?: string;
  thinking?: boolean;
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

  const visible = useMemo(
    () =>
      collapseHandoffNotices(
        messages.filter((message) => {
          if (message.role !== 'tool') return true;
          if (isHandoffToolEcho(message.content) || parseHandoffNotice(message.content)) return false;
          return true;
        }),
        (message) => message.role === 'system',
      ),
    [messages],
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [visible.length, thinking]);

  if (messages.length === 0) {
    return (
      <div className="transcript transcript-empty">
        {botName ? <BotFace color={accent} size={96} botId={botId} track /> : null}
        <p className="transcript-empty-name">{botName ?? 'No bot selected'}</p>
      </div>
    );
  }

  return (
    <div className="transcript">
      <div className="transcript-column">
        {visible.map((message) => {
          const isUser = message.role === 'user';
          const isSystem = message.role === 'system';
          const isTool = message.role === 'tool';

          if (isSystem) {
            const handoff = parseHandoffNotice(message.content);
            if (handoff) {
              return <HandoffStatus key={message.id} notice={handoff} onOpen={setPeek} />;
            }
            if (isRawSystemBlob(message.content)) return null;
          }

          if (isTool) {
            const toolName = message.toolCallId
              ? (toolNameByCallId.get(message.toolCallId) ?? '')
              : '';
            const view = toolResultView(message.content, toolName);
            return (
              <div key={message.id} className="message message-tool message-enter">
                <details className="tool-accordion">
                  <summary className="tool-summary">
                    <span className="tool-summary-text">{view.summary}</span>
                  </summary>
                  {view.technical ? (
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
                  )}
                </details>
              </div>
            );
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
            <div key={message.id} className={className}>
              <div className={bodyClass} style={isUser ? { background: accent } : undefined}>
                {isUser ? message.content : <ChatMarkdown content={message.content} />}
              </div>
            </div>
          );
        })}
        {thinking ? (
          <div className="message message-enter" aria-live="polite">
            <div className="message-body typing-dots" aria-label="Thinking">
              <span />
              <span />
              <span />
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
