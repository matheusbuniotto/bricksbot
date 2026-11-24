import { describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { attachmentConfig } from '../../../shared/chat/attachments';
import type { Bot, Message } from '../../../shared/chat/types';
import { BotDetailsSheet } from './BotDetailsSheet';
import { ChatComposer } from './ChatComposer';
import { ChatTranscript, StarterPrompts } from './ChatTranscript';

const noop = async () => {};

describe('composer', () => {
  const render = (attachments: ReturnType<typeof attachmentConfig> | null, chatId: string | null = 'chat-1') =>
    renderToString(
      <ChatComposer accent="#333" chatId={chatId} attachments={attachments} onSend={noop} onStop={noop} />
    );

  it('shows a paperclip that accepts exactly the allowed types when attachments are on', () => {
    const html = render(attachmentConfig(true));
    expect(html).toContain('aria-label="Attach files"');
    expect(html).toContain('accept=".csv,.tsv,.xlsx,.xls,.pdf"');
    expect(html).toContain('up to 25.0 MB');
    expect(html).not.toContain('disabled=""><svg');
  });

  it('has no paperclip when attachments are off or not loaded', () => {
    expect(render(attachmentConfig(false))).not.toContain('Attach files');
    expect(render(null)).not.toContain('Attach files');
  });

  it('keeps the paperclip disabled until there is a chat to attach to', () => {
    expect(render(attachmentConfig(true), null)).toMatch(/<button[^>]*aria-label="Attach files"[^>]*disabled=""/);
  });
});

describe('transcript', () => {
  it('shows a download chip for each file on the user message', () => {
    const html = renderToString(
      <ChatTranscript
        accent="#333"
        botName="Primary"
        streamingText=""
        liveTools={[]}
        thinking={false}
        thinkingLabel="Thinking"
        messages={[
          {
            id: 'm1',
            chatId: 'chat-1',
            role: 'user',
            content: 'sum the ids',
            createdAt: '2026-11-20T10:00:00.000Z',
            attachments: [{ id: 'a1', name: 'sales.csv', kind: 'csv', sizeBytes: 2048 }],
          },
        ]}
      />
    );
    expect(html).toContain('href="/api/chats/chat-1/attachments/a1/content"');
    expect(html).toContain('sales.csv');
  });
});

describe('starter prompts', () => {
  const transcript = (props: { messages?: Message[]; onStarterPrompt?: (prompt: string) => void }) =>
    renderToString(
      <ChatTranscript accent="#333" messages={props.messages ?? []} onStarterPrompt={props.onStarterPrompt} />
    );

  it('offers samples prompts only in an empty chat that can send', () => {
    const html = transcript({ onStarterPrompt: () => {} });
    expect(html).toContain('samples.nyctaxi');
    expect(html).toContain('samples.tpch');
    expect(transcript({})).not.toContain('starter-prompt');
    const message: Message = {
      id: 'm1',
      chatId: 'c',
      role: 'user',
      content: 'hi',
      createdAt: '2026-11-20T10:00:00.000Z',
    };
    expect(transcript({ messages: [message], onStarterPrompt: () => {} })).not.toContain('starter-prompt');
  });

  it('sends the prompt on click', () => {
    const sent: string[] = [];
    const list = StarterPrompts({ onPick: (prompt) => sent.push(prompt) });
    const buttons = (list.props as { children: ReactElement<{ children: string; onClick: () => void }>[] }).children;
    buttons[1].props.onClick();
    expect(sent).toEqual([buttons[1].props.children]);
    expect(sent[0]).toContain('samples.nyctaxi');
  });
});

describe('library', () => {
  const bot: Bot = {
    id: 'bot-1',
    name: 'Analyst',
    spaceId: 's1',
    ownerId: 'u1',
    avatarLabel: '1.2.0.0',
    isPrimary: false,
    isShared: false,
    presence: 'online',
    sortOrder: 0,
    archivedAt: null,
    createdAt: '2026-11-01T00:00:00.000Z',
  };
  const sheet = (props: { chatId?: string | null; attachments?: ReturnType<typeof attachmentConfig> }) =>
    renderToString(
      <BotDetailsSheet
        bot={bot}
        messages={[]}
        routines={[]}
        routineBusyId={null}
        lastWebhookSecret={null}
        width={360}
        minWidth={280}
        maxWidth={720}
        onWidthChange={() => {}}
        onCreateRoutine={noop}
        onUpdateRoutine={noop}
        onRunRoutine={noop}
        onDeleteRoutine={noop}
        onClose={() => {}}
        onChangeLook={() => {}}
        initialTab="library"
        {...props}
      />
    );

  it('offers an Uploads tab when attachments are on', () => {
    const html = sheet({ chatId: 'chat-1', attachments: attachmentConfig(true) });
    expect(html).toContain('aria-label="Library sections"');
    expect(html).toContain('>Uploads<');
  });

  it('keeps the plain Library when attachments are off or there is no chat', () => {
    expect(sheet({ chatId: 'chat-1', attachments: attachmentConfig(false) })).not.toContain('Uploads');
    expect(sheet({ attachments: attachmentConfig(true) })).not.toContain('Uploads');
  });
});
