import { Archive, Pencil } from 'lucide-react';
import { useState } from 'react';
import type { Chat, ChatKind } from '../../../shared/chat/types';
import { formatChatTimeSeparator } from '../lib/chat-time';

const KIND_LABELS: Partial<Record<ChatKind, string>> = { routine: 'Routine', handoff: 'Handoffs' };

/** The bot's chats, newest first; routine and handoff chats are labeled and stay (they cannot be archived). */
export function ChatHistory({
  chats,
  currentChatId,
  onOpen,
  onRename,
  onArchive,
  onClose,
}: {
  chats: Chat[];
  currentChatId: string | null;
  onOpen: (chat: Chat) => void;
  onRename: (chat: Chat, title: string) => void;
  onArchive: (chat: Chat) => void;
  onClose: () => void;
}) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  function commitRename(chat: Chat) {
    setRenamingId(null);
    const title = draft.trim();
    if (title && title !== chat.title) onRename(chat, title);
  }

  return (
    <>
      <button type="button" className="chat-history-backdrop" aria-label="Close history" onClick={onClose} />
      <div
        className="chat-history"
        role="dialog"
        aria-label="Chat history"
        onKeyDown={(event) => event.key === 'Escape' && onClose()}
      >
        {chats.length === 0 ? <p className="chat-history-empty">No chats yet</p> : null}
        <ul>
          {chats.map((chat) => {
            const isUserChat = (chat.kind ?? 'user') === 'user';
            const kindLabel = KIND_LABELS[chat.kind ?? 'user'];
            return (
              <li
                key={chat.id}
                className={chat.id === currentChatId ? 'chat-history-row is-current' : 'chat-history-row'}
              >
                {renamingId === chat.id ? (
                  <input
                    autoFocus
                    value={draft}
                    aria-label="Rename chat"
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={() => commitRename(chat)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') commitRename(chat);
                      if (event.key === 'Escape') {
                        event.stopPropagation();
                        setRenamingId(null);
                      }
                    }}
                  />
                ) : (
                  <button type="button" className="chat-history-open" onClick={() => onOpen(chat)}>
                    <span className="chat-history-title">
                      {kindLabel ? <span className="chat-history-kind">{kindLabel}</span> : null}
                      {chat.title}
                    </span>
                    <span className="chat-history-meta">
                      {formatChatTimeSeparator(chat.updatedAt) ?? ''}
                      {chat.lastPreview ? ` · ${chat.lastPreview}` : ''}
                    </span>
                  </button>
                )}
                {isUserChat && renamingId !== chat.id ? (
                  <span className="chat-history-actions">
                    <button
                      type="button"
                      aria-label={`Rename ${chat.title}`}
                      onClick={() => {
                        setDraft(chat.title);
                        setRenamingId(chat.id);
                      }}
                    >
                      <Pencil size={14} strokeWidth={1.75} />
                    </button>
                    <button type="button" aria-label={`Archive ${chat.title}`} onClick={() => onArchive(chat)}>
                      <Archive size={14} strokeWidth={1.75} />
                    </button>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}
