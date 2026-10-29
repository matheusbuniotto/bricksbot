import { useEffect, useState } from 'react';
import type { Bot, Message } from '../../../shared/chat/types';
import type { HandoffNotice } from '../../../shared/chat/handoff-notice';
import { fetchBotChat } from '../lib/chat-api';
import { BotFace, botColor } from './BotFace';

function previewBody(message: Message): string {
  if (message.role === 'tool') {
    try {
      const parsed = JSON.parse(message.content) as { error?: string };
      if (parsed.error) return parsed.error;
    } catch {
      // plain tool output
    }
    return message.content.slice(0, 400);
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

  const target = bots.find((bot) => bot.id === notice.targetBotId) ?? null;
  const sender = bots.find((bot) => bot.id === notice.senderBotId) ?? null;
  const targetAccent = botColor(notice.targetBotId || notice.targetName, false);
  const senderAccent = botColor(notice.senderBotId || 'primary', true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      if (!notice.targetBotId) {
        if (!cancelled) {
          setMessages([]);
          setLoading(false);
          setError('This older handoff has no linked bot chat.');
        }
        return;
      }
      try {
        const data = await fetchBotChat(notice.targetBotId);
        if (!cancelled) setMessages(data.messages.filter((m) => m.role !== 'tool' || !m.content.startsWith('Handed off')));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load bot chat');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [notice.targetBotId]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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
          {!loading && !error && messages.length === 0 ? (
            <p className="handoff-peek-muted">No messages in {notice.targetName}&rsquo;s chat yet.</p>
          ) : null}
          {!loading
            ? messages.map((message) => {
                const isUser = message.role === 'user';
                return (
                  <div
                    key={message.id}
                    className={isUser ? 'handoff-peek-msg handoff-peek-msg-user' : 'handoff-peek-msg'}
                  >
                    <div
                      className={isUser ? 'handoff-peek-bubble handoff-peek-bubble-user' : 'handoff-peek-bubble'}
                      style={isUser ? { background: targetAccent } : undefined}
                    >
                      {previewBody(message)}
                    </div>
                  </div>
                );
              })
            : null}
        </div>

        <div className="handoff-peek-actions">
          {notice.targetBotId ? (
            <button
              type="button"
              className="handoff-peek-open"
              onClick={() => {
                onOpenBot(notice.targetBotId);
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
