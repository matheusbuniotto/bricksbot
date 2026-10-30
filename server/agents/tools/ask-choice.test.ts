import { describe, expect, test } from 'vitest';
import { ASK_CHOICE_TOOL_NAME, createAskChoiceTool, planAskChoice } from './ask-choice.js';

describe('ask_choice', () => {
  test('plans valid prompts and options', () => {
    expect(planAskChoice({ prompt: 'Pick one', options: ['A', 'B'] })).toEqual({
      ok: true,
      prompt: 'Pick one',
      options: ['A', 'B'],
    });
  });

  test('rejects invalid option lists', () => {
    expect(planAskChoice({ prompt: 'x', options: ['only'] }).ok).toBe(false);
    expect(planAskChoice({ prompt: '', options: ['a', 'b'] }).ok).toBe(false);
  });

  test('preflight requires an active bot', () => {
    const tool = createAskChoiceTool();
    expect(tool.preflight({ prompt: 'Q', options: ['a', 'b'] }, { chatId: 'c', bot: null })).toMatch(
      /active Bot/i,
    );
    expect(
      tool.preflight(
        { prompt: 'Q', options: ['a', 'b'] },
        { chatId: 'c', bot: { id: 'b1', name: 'Ana', isPrimary: false } as never },
      ),
    ).toBeNull();
  });

  test('tool name is stable for registration', () => {
    expect(ASK_CHOICE_TOOL_NAME).toBe('ask_choice');
  });
});
