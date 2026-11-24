import { Readable } from 'node:stream';
import { describe, expect, test } from 'vitest';
import type { Attachment } from '../../../shared/chat/attachments.js';
import { MemoryAttachmentStore } from '../../attachments/memory-store.js';
import type { RunContext } from '../../../shared/runs/types.js';
import { createReadAttachmentTool } from './read-attachment.js';

const ctx = { chatId: 'chat-1', bot: null, userId: 'alice' };

async function toolWith(files: Array<Partial<Attachment> & { body?: string; unsent?: boolean }>, maxChars?: number) {
  const store = new MemoryAttachmentStore();
  const bodies = new Map<string, string>();
  for (const [index, file] of files.entries()) {
    const created = await store.create({
      id: `id-${index}`,
      chatId: 'chat-1',
      userId: 'alice',
      name: 'a.csv',
      kind: 'csv',
      sizeBytes: file.body?.length ?? 0,
      volumePath: `/Volumes/c/s/v/${index}`,
      ...file,
    });
    if (!file.unsent) await store.attach('chat-1', 'alice', [created.id], `message-${index}`);
    bodies.set(created.id, file.body ?? '');
  }
  return createReadAttachmentTool({
    store,
    read: (attachment) => Promise.resolve(Readable.from([Buffer.from(bodies.get(attachment.id) ?? '')])),
    maxChars,
  });
}

describe('read_attachment', () => {
  test('returns the text of a csv by name', async () => {
    const tool = await toolWith([{ body: 'id,name\n1,ada\n' }]);
    expect(await tool.execute({ name: 'a.csv' }, ctx)).toContain('id,name\n1,ada');
  });

  test('the newest file wins a name clash, and an id works too', async () => {
    const tool = await toolWith([{ body: 'old\n' }, { body: 'new\n' }]);
    expect(await tool.execute({ name: 'a.csv' }, ctx)).toContain('new');
    expect(await tool.execute({ name: 'id-0' }, ctx)).toContain('old');
  });

  test('an upload that was never sent with a message is not found', async () => {
    const tool = await toolWith([{ body: 'draft\n', unsent: true }]);
    expect(await tool.execute({ name: 'a.csv' }, ctx)).toContain('no attachment named');
    expect(await tool.execute({ name: 'id-0' }, ctx)).toContain('no attachment named');
  });

  test('a handoff turn reads the files of the chat the person attached them in', async () => {
    const tool = await toolWith([{ body: 'id\n1\n' }]);
    const handoff = { ...ctx, chatId: 'handoff-chat', attachmentChatId: 'chat-1' };
    expect(await tool.execute({ name: 'a.csv' }, handoff)).toContain('id\n1');
    expect(await tool.execute({ name: 'a.csv' }, { ...handoff, attachmentChatId: undefined })).toContain(
      'no attachment named'
    );
  });

  test('a file that fits whole is not labelled as the start', async () => {
    const tool = await toolWith([{ body: 'id\n1\n', sizeBytes: 5 }]);
    expect(await tool.execute({ name: 'a.csv' }, ctx)).not.toContain('start of file');
  });

  test('cuts a long file and says it is the start', async () => {
    const tool = await toolWith([{ body: 'x'.repeat(500), sizeBytes: 500 }], 10);
    const text = await tool.execute({ name: 'a.csv' }, ctx);
    expect(text).toContain('(start of file)');
    expect(text).toContain('[truncated]');
    expect(text).not.toContain('x'.repeat(11));
  });

  test('points excel and pdf at read_files instead of dumping bytes', async () => {
    const tool = await toolWith([{ name: 'book.xlsx', kind: 'excel', body: 'PK' }]);
    expect(await tool.execute({ name: 'book.xlsx' }, ctx)).toMatch(/read_files\('\/Volumes\/c\/s\/v\/0'\)/);
  });

  test('an unknown name, another user and another chat find nothing', async () => {
    const tool = await toolWith([{ body: 'a' }]);
    expect(await tool.execute({ name: 'nope.csv' }, ctx)).toContain('no attachment named');
    expect(await tool.execute({ name: 'a.csv' }, { ...ctx, userId: 'mallory' })).toContain('no attachment named');
    expect(await tool.execute({ name: 'a.csv' }, { ...ctx, chatId: 'chat-2' })).toContain('no attachment named');
  });

  test('a failing read comes back as an error line', async () => {
    const store = new MemoryAttachmentStore();
    await store.create({
      id: 'id-0',
      chatId: 'chat-1',
      userId: 'alice',
      name: 'a.csv',
      kind: 'csv',
      sizeBytes: 1,
      volumePath: '/Volumes/x',
    });
    await store.attach('chat-1', 'alice', ['id-0'], 'message-0');
    const tool = createReadAttachmentTool({
      store,
      read: () => Promise.reject(new Error('Volume request failed (403)')),
    });
    expect(await tool.execute({ name: 'a.csv' }, ctx)).toBe('read_attachment error: Volume request failed (403)');
  });

  test('refuses routine runs and anonymous callers before reading', async () => {
    const tool = await toolWith([{ body: 'a' }]);
    const routine = { ...ctx, run: { routine: true } as RunContext };
    expect(tool.preflight({ name: 'a.csv' }, routine)).toMatch(/routine/);
    expect(tool.preflight({ name: 'a.csv' }, { ...ctx, userId: undefined })).toMatch(/signed-in/);
    expect(tool.preflight({}, ctx)).toMatch(/file name/);
    expect(tool.preflight({ name: 'a.csv' }, ctx)).toBeNull();
    expect(await tool.execute({ name: 'a.csv' }, routine)).toMatch(/^read_attachment error: .*routine/);
  });
});
