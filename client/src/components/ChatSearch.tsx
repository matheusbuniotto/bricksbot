import { useEffect, useState } from 'react';
import { MIN_SEARCH_LENGTH } from '../../../shared/chat/search';
import type { Bot, SearchHit } from '../../../shared/chat/types';
import { searchChats } from '../lib/chat-api';
import { formatChatTimeSeparator } from '../lib/chat-time';

const TYPING_PAUSE_MS = 200;

/** Cmd-K: find a conversation by what was said in it. */
export function ChatSearch({
  bots,
  onOpen,
  onClose,
}: {
  bots: Bot[];
  onOpen: (hit: SearchHit) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const text = query.trim();
  const shown = text.length < MIN_SEARCH_LENGTH ? [] : hits;

  useEffect(() => {
    if (text.length < MIN_SEARCH_LENGTH) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchChats(text, controller.signal).then(
        (found) => {
          setHits(found);
          setActive(0);
          setError(null);
        },
        (err) => {
          if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Search failed');
        }
      );
    }, TYPING_PAUSE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [text]);

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') onClose();
    else if (event.key === 'ArrowDown') setActive((index) => Math.min(index + 1, shown.length - 1));
    else if (event.key === 'ArrowUp') setActive((index) => Math.max(index - 1, 0));
    else if (event.key === 'Enter' && shown[active]) onOpen(shown[active]);
    else return;
    event.preventDefault();
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="dialog chat-search" role="dialog" aria-label="Search conversations" onKeyDown={onKeyDown}>
        <input
          autoFocus
          value={query}
          placeholder="Search conversations"
          aria-label="Search conversations"
          onChange={(event) => setQuery(event.target.value)}
        />
        {error ? <p className="dialog-note">{error}</p> : null}
        {!error && text.length >= MIN_SEARCH_LENGTH && shown.length === 0 ? (
          <p className="dialog-note">No conversations found</p>
        ) : null}
        <ul className="chat-search-results">
          {shown.map((hit, index) => (
            <li key={hit.chatId}>
              <button
                type="button"
                className={index === active ? 'chat-search-hit is-active' : 'chat-search-hit'}
                onMouseEnter={() => setActive(index)}
                onClick={() => onOpen(hit)}
              >
                <span className="chat-history-title">
                  {hit.chatTitle}
                  <span className="chat-history-kind">{bots.find((bot) => bot.id === hit.botId)?.name ?? ''}</span>
                </span>
                <span className="chat-history-meta">
                  {hit.role === 'user' ? 'You' : 'Bot'}: {hit.snippet}
                  {' · '}
                  {formatChatTimeSeparator(hit.createdAt) ?? ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
