import { afterEach, describe, expect, test, vi } from 'vitest';
import { attachmentConfig } from '../../../shared/chat/attachments';
import { attachmentProblem, deleteAttachment, formatBytes, listAttachments, uploadAttachment } from './attachments-api';

const config = attachmentConfig(true);
const file = (name: string, size = 10) => new File([new Uint8Array(size)], name);

describe('attachmentProblem', () => {
  test('accepts the allowed types', () => {
    for (const name of ['a.csv', 'A.TSV', 'b.xlsx', 'c.xls', 'd.pdf']) {
      expect(attachmentProblem(file(name), config, 0), name).toBeNull();
    }
  });

  test('refuses other types, empty and oversized files, and a sixth file', () => {
    expect(attachmentProblem(file('a.html'), config, 0)).toMatch(/only csv, tsv, xlsx, xls, pdf/);
    expect(attachmentProblem(file('noextension'), config, 0)).toMatch(/only/);
    expect(attachmentProblem(file('a.csv', 0), config, 0)).toMatch(/empty/);
    expect(attachmentProblem(file('a.csv', config.maxBytes + 1), config, 0)).toMatch(/over 25.0 MB/);
    expect(attachmentProblem(file('a.csv'), config, 5)).toMatch(/At most 5/);
  });
});

test('formatBytes', () => {
  expect([formatBytes(12), formatBytes(2048), formatBytes(3 * 1024 * 1024)]).toEqual(['12 B', '2 KB', '3.0 MB']);
});

describe('attachment requests', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('upload sends the raw file with its name in the query', async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      return Promise.resolve(Response.json({ attachment: { id: 'a1', name: 'q3 sales.csv' } }, { status: 201 }));
    });
    const f = file('q3 sales.csv');
    expect(await uploadAttachment('chat-1', f)).toMatchObject({ id: 'a1' });
    expect(calls[0][0]).toBe('/api/chats/chat-1/attachments?name=q3%20sales.csv');
    expect(calls[0][1]).toMatchObject({ method: 'POST', body: f });
  });

  test('surfaces the server message when an upload is refused', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(Response.json({ error: 'Quota exceeded' }, { status: 413 })));
    await expect(uploadAttachment('chat-1', file('a.csv'))).rejects.toThrow('Quota exceeded');
  });

  test('list and delete hit the chat routes', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', (url: string) => {
      urls.push(url);
      return Promise.resolve(Response.json({ attachments: [], ok: true }));
    });
    expect(await listAttachments('chat-1')).toEqual([]);
    await deleteAttachment('chat-1', 'a1');
    expect(urls).toEqual(['/api/chats/chat-1/attachments', '/api/chats/chat-1/attachments/a1/delete']);
  });
});
