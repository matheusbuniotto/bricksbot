import { describe, expect, test } from 'vitest';
import { ASK_CHOICE_TOOL_NAME, askChoiceToolDefinition, createAskChoiceTool, planAskChoice } from './ask-choice.js';

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

  test('rejects plain yes/no confirmations but allows real choices', () => {
    expect(planAskChoice({ prompt: 'Proceed?', options: ['Yes', 'No'] }).ok).toBe(false);
    expect(planAskChoice({ prompt: 'Proceed?', options: ['Yes, create them', 'Cancel'] }).ok).toBe(true);
    expect(planAskChoice({ prompt: 'Which?', options: ['Yes', 'Weekly report'] }).ok).toBe(true);
  });

  test('description tells the model not to confirm actions', () => {
    expect(askChoiceToolDefinition.description).toMatch(/Never use it to confirm an action/);
  });

  test('preflight requires an active bot', () => {
    const tool = createAskChoiceTool();
    expect(tool.preflight({ prompt: 'Q', options: ['a', 'b'] }, { chatId: 'c', bot: null })).toMatch(/active Bot/i);
    expect(
      tool.preflight(
        { prompt: 'Q', options: ['a', 'b'] },
        { chatId: 'c', bot: { id: 'b1', name: 'Ana', isPrimary: false } as never }
      )
    ).toBeNull();
  });

  test('tool name is stable for registration', () => {
    expect(ASK_CHOICE_TOOL_NAME).toBe('ask_choice');
  });
});
