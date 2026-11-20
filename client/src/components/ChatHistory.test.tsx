import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { Chat } from '../../../shared/chat/types';
import { ChatHistory } from './ChatHistory';

const chat = (fields: Partial<Chat> & Pick<Chat, 'id' | 'title'>): Chat => ({
  botId: 'bot-1',
  kind: 'user',
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-01T10:00:00.000Z',
  lastPreview: '',
  ...fields,
});

describe('ChatHistory', () => {
  const noop = () => {};
  const render = (chats: Chat[]) =>
    renderToString(
      <ChatHistory chats={chats} currentChatId="c1" onOpen={noop} onRename={noop} onArchive={noop} onClose={noop} />
    );

  it('lists chats, marks the open one, and labels routine and handoff chats', () => {
    const html = render([
      chat({ id: 'c1', title: 'Q3 revenue', lastPreview: 'EMEA leads' }),
      chat({ id: 'c2', title: 'Routine: Nightly', kind: 'routine' }),
      chat({ id: 'c3', title: 'Analyst (handoffs)', kind: 'handoff' }),
    ]);
    expect(html).toContain('Q3 revenue');
    expect(html).toContain('EMEA leads');
    expect(html).toContain('chat-history-row is-current');
    expect(html).toContain('>Routine</span>');
    expect(html).toContain('>Handoffs</span>');
  });

  it('offers rename and archive only for chats people opened', () => {
    const html = render([
      chat({ id: 'c1', title: 'Mine' }),
      chat({ id: 'c2', title: 'Routine: Nightly', kind: 'routine' }),
    ]);
    expect(html).toContain('aria-label="Rename Mine"');
    expect(html).toContain('aria-label="Archive Mine"');
    expect(html).not.toContain('Archive Routine: Nightly');
  });

  it('says so when there are no chats', () => {
    expect(render([])).toContain('No chats yet');
  });
});
