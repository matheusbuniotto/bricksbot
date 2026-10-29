import { useEffect, useState } from 'react';
import type { Bot, Message } from '../../../shared/chat/types';
import {
  handoffPeekBotId,
  sliceHandoffThread,
  type HandoffNotice,
} from '../../../shared/chat/handoff-notice';
import { fetchBotChat } from '../lib/chat-api';
import { BotFace, botColor } from './BotFace';
import { ChatMarkdown } from './ChatMarkdown';

function previewBody(message: Message): string {
  if (message.role === 'tool') {
    // Peek is for the handoff conversation, not tool plumbing.
    return '';
  }
  return message.content;
}

export function HandoffPeek({
  notice,
  bots,
  onClose,
  onOpenBot,
}: {
  notice: HandoffNotice;
  bots: Bot[];
  onClose: () => void;
  onOpenBot: (botId: string) => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const peekBotId = handoffPeekBotId(notice);
  const openBotId = notice.targetBotId || peekBotId;
  const target = bots.find((bot) => bot.id === notice.targetBotId) ?? null;
  const sender = bots.find((bot) => bot.id === notice.senderBotId) ?? null;
  const targetAccent = botColor(notice.targetBotId || notice.targetName, false);
  const senderAccent = botColor(notice.senderBotId || 'primary', true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      if (!peekBotId) {
        if (!cancelled) {
          setMessages([]);
          setLoading(false);
          setError(
            notice.replyPreview
              ? null
              : 'This older handoff has no linked bot chat.',
          );
        }
        return;
      }
      try {
        const data = await fetchBotChat(peekBotId);
        if (cancelled) return;
        const thread = sliceHandoffThread(data.messages, notice).filter(
          (m) => m.role !== 'tool' || !m.content.startsWith('Handed off'),
        );
        setMessages(thread);
      } catch (err) {
        if (!cancelled) {
          setMessages([]);
          setError(
            notice.replyPreview
              ? null
              : err instanceof Error
                ? err.message
                : 'Unable to load bot chat',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [peekBotId, notice]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const showPreviewFallback = !loading && messages.length === 0 && Boolean(notice.replyPreview);

  return (
    <div className="handoff-peek-backdrop" role="presentation" onClick={onClose}>
      <div
        className="handoff-peek"
        role="dialog"
        aria-modal="true"
        aria-label={`Chat between ${notice.senderName || 'Primary'} and ${notice.targetName}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="handoff-peek-header">
          <div className="handoff-pair-pill">
            <BotFace color={senderAccent} size={22} />
            <span>{sender?.name ?? (notice.senderName || 'Primary')}</span>
            <span className="handoff-pair-arrow" aria-hidden="true">
              ↔
            </span>
            <BotFace color={targetAccent} size={22} />
            <span>{target?.name ?? notice.targetName}</span>
          </div>
          <button type="button" className="handoff-peek-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {notice.brief ? (
          <p className="handoff-peek-brief">
            Brief: <span>{notice.brief}</span>
          </p>
        ) : null}

        <div className="handoff-peek-body">
          {loading ? <p className="handoff-peek-muted">Loading…</p> : null}
          {error ? <p className="handoff-peek-error">{error}</p> : null}
          {showPreviewFallback ? (
            <>
              {notice.brief ? (
                <div className="handoff-peek-msg handoff-peek-msg-user">
                  <div
                    className="handoff-peek-bubble handoff-peek-bubble-user"
                    style={{ background: targetAccent }}
                  >
                    {notice.brief}
                  </div>
                </div>
              ) : null}
              <div className="handoff-peek-msg">
                <div className="handoff-peek-bubble handoff-peek-bubble-md">
                  <ChatMarkdown content={notice.replyPreview ?? ''} />
                </div>
              </div>
              {peekBotId ? (
                <p className="handoff-peek-muted">Live thread unavailable (bot may have been removed).</p>
              ) : null}
            </>
          ) : null}
          {!loading && !error && !showPreviewFallback && messages.length === 0 ? (
            <p className="handoff-peek-muted">No messages in this handoff thread yet.</p>
          ) : null}
          {!loading
            ? messages
                .filter((message) => message.role === 'user' || message.role === 'assistant')
                .map((message) => {
                  const isUser = message.role === 'user';
                  const body = previewBody(message);
                  if (!body) return null;
                  return (
                    <div
                      key={message.id}
                      className={isUser ? 'handoff-peek-msg handoff-peek-msg-user' : 'handoff-peek-msg'}
                    >
                      <div
                        className={
                          isUser
                            ? 'handoff-peek-bubble handoff-peek-bubble-user'
                            : 'handoff-peek-bubble handoff-peek-bubble-md'
                        }
                        style={isUser ? { background: targetAccent } : undefined}
                      >
                        {isUser ? body : <ChatMarkdown content={body} />}
                      </div>
                    </div>
                  );
                })
            : null}
        </div>

        <div className="handoff-peek-actions">
          {openBotId ? (
            <button
              type="button"
              className="handoff-peek-open"
              onClick={() => {
                onOpenBot(openBotId);
                onClose();
              }}
            >
              Open {notice.targetName}
            </button>
          ) : null}
          <button type="button" className="handoff-peek-dismiss" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
