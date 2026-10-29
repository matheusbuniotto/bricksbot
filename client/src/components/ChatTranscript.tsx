import { useEffect, useMemo, useRef, useState } from 'react';
import {
  collapseHandoffNotices,
  parseHandoffNotice,
  type HandoffNotice,
} from '../../../shared/chat/handoff-notice';
import type { Bot, Message } from '../../../shared/chat/types';
import { BotFace } from './BotFace';
import { HandoffPeek } from './HandoffPeek';
import { HandoffStatus } from './HandoffStatus';

function isHandoffToolEcho(content: string): boolean {
  return /^Handed off to .+\./i.test(content.trim());
}

export function ChatTranscript({
  messages,
  botName,
  accent,
  thinking,
  bots = [],
  onOpenBot,
}: {
  messages: Message[];
  botName: string | null;
  accent: string;
  thinking?: boolean;
  bots?: Bot[];
  onOpenBot?: (botId: string) => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [peek, setPeek] = useState<HandoffNotice | null>(null);

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
        {botName ? <BotFace color={accent} size={96} /> : null}
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
          }

          if (isTool) {
            let isError = false;
            let toolName = '';
            try {
              const parsed = JSON.parse(message.content) as { error?: string; tool?: string };
              if (parsed.error) isError = true;
              if (parsed.tool) toolName = parsed.tool;
            } catch {
              // Plain output
            }

            return (
              <div key={message.id} className="message message-tool message-enter">
                <details className="tool-accordion">
                  <summary className="tool-summary">
                    <span className="tool-summary-text">
                      {isError ? 'Action denied / error' : 'Tool execution'}
                    </span>
                    {toolName ? <code className="tool-summary-name">{toolName}</code> : null}
                  </summary>
                  <pre className="tool-output">
                    <code>{message.content}</code>
                  </pre>
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
            ? 'message-body message-body-system'
            : isUser
              ? 'message-body message-body-user'
              : 'message-body';

          return (
            <div key={message.id} className={className}>
              <div className={bodyClass} style={isUser ? { background: accent } : undefined}>
                {message.content}
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
