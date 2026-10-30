import { describe, expect, test } from 'vitest';
import type { Message } from '../../../shared/chat/types';
import { serializeArtifactPinNotice } from '../../../shared/chat/artifact-pin-notice';
import { serializeHandoffNotice } from '../../../shared/chat/handoff-notice';
import { lastUserFacingPreview, toolLabel, toolResultView } from './user-facing';

function msg(role: Message['role'], content: string): Message {
  return {
    id: '1',
    chatId: 'c',
    role,
    content,
    createdAt: new Date().toISOString(),
  };
}

describe('user-facing', () => {
  test('toolLabel hides snake_case ids', () => {
    expect(toolLabel('handoff_to_bot')).toBe('Message another bot');
    expect(toolLabel('sql_query')).toBe('SQL query');
  });

  test('lastUserFacingPreview surfaces artifact pin summary', () => {
    const notice = serializeArtifactPinNotice({
      kind: 'artifact_pin',
      title: 'Rows',
      artifactKind: 'sql',
      body: 'SELECT 1',
      summary: 'Sample ok',
      pinnedByBotId: 'b',
      pinnedByName: 'Analyst',
    });
    expect(
      lastUserFacingPreview([msg('user', 'hello'), msg('system', notice)]),
    ).toBe('Pinned: Sample ok');
  });

  test('lastUserFacingPreview skips handoff JSON blobs', () => {
    const notice = serializeHandoffNotice({
      kind: 'handoff',
      direction: 'thread',
      targetBotId: 'p',
      targetName: 'Primary',
      targetChatId: 'c',
      senderBotId: 'h',
      senderName: 'HandoffQA',
      brief: 'say BANANA',
      messageCount: 2,
      replyPreview: 'BANANA',
      threadBotId: 'h',
    });
    expect(
      lastUserFacingPreview([
        msg('user', 'From Primary: say BANANA'),
        msg('assistant', 'BANANA'),
        msg('system', notice),
      ]),
    ).toBe('2 messages with Primary');
  });

  test('toolResultView surfaces errors without raw JSON', () => {
    const view = toolResultView(JSON.stringify({ tool: 'web_fetch', error: 'blocked host' }));
    expect(view.summary).toBe('Web fetch failed');
    expect(view.detail).toBe('blocked host');
    expect(view.isError).toBe(true);
    expect(view.technical).toBe(false);
  });

  test('toolResultView uses tool name hint when payload omits tool id', () => {
    const save = toolResultView(
      JSON.stringify({ ok: true, name: 'MetaSmoke', id: 's1' }),
      'save_skill',
    );
    expect(save.summary).toBe('Save skill: MetaSmoke');
    expect(save.technical).toBe(true);

    const activate = toolResultView(
      JSON.stringify({
        ok: true,
        name: 'MetaSmoke',
        instructions: 'reply METASMKE_OK',
        resources: ['SKILL.md'],
      }),
      'activate_skill',
    );
    expect(activate.summary).toBe('Activate skill: MetaSmoke');
    expect(activate.technical).toBe(true);
  });
});
