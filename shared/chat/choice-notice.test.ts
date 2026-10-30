import { describe, expect, test } from 'vitest';
import {
  choiceAnswerPreviewLine,
  indexChoiceAnswers,
  normalizeOptions,
  parseChoiceAnswerNotice,
  parseChoicePromptNotice,
  serializeChoiceAnswerNotice,
  serializeChoicePromptNotice,
} from './choice-notice.js';

describe('choice-notice', () => {
  test('round-trips choice prompt and answer notices', () => {
    const prompt = serializeChoicePromptNotice({
      kind: 'choice_prompt',
      id: 'c1',
      toolCallId: 'call_1',
      prompt: 'Which warehouse?',
      options: ['prod', 'dev'],
    });
    expect(parseChoicePromptNotice(prompt)).toEqual({
      kind: 'choice_prompt',
      id: 'c1',
      toolCallId: 'call_1',
      prompt: 'Which warehouse?',
      options: ['prod', 'dev'],
    });

    const answer = serializeChoiceAnswerNotice({
      kind: 'choice_answer',
      choiceId: 'c1',
      prompt: 'Which warehouse?',
      selectedOption: 'prod',
    });
    const parsed = parseChoiceAnswerNotice(answer);
    expect(parsed?.selectedOption).toBe('prod');
    expect(choiceAnswerPreviewLine(parsed!)).toBe('Sua resposta: prod');
  });

  test('normalizeOptions enforces 2–5 unique non-empty strings', () => {
    expect(normalizeOptions(['a'])).toBeNull();
    expect(normalizeOptions(['a', 'a'])).toBeNull();
    expect(normalizeOptions(['one', 'two', 'three', 'four', 'five', 'six'])).toBeNull();
    expect(normalizeOptions(['  x  ', 'y'])).toEqual(['x', 'y']);
  });

  test('indexChoiceAnswers collects answers from system rows', () => {
    const answer = serializeChoiceAnswerNotice({
      kind: 'choice_answer',
      choiceId: 'c9',
      prompt: 'Pick',
      selectedOption: 'B',
    });
    const map = indexChoiceAnswers([{ role: 'system', content: answer }]);
    expect(map.get('c9')).toBe('B');
  });
});
