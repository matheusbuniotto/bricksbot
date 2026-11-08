import { useEffect } from 'react';
import type { PendingChoice } from '../../../shared/chat/choice-notice';
import { isTypingTarget } from '../lib/keyboard';

export function ChoiceCards({
  chatId,
  choices,
  busyId,
  onSelect,
}: {
  chatId: string | null;
  choices: PendingChoice[];
  busyId: string | null;
  onSelect: (choiceId: string, selectedOption: string) => Promise<void>;
}) {
  const first = choices[0];

  useEffect(() => {
    if (!first || busyId) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (isTypingTarget(event.target)) return;

      const index = Number.parseInt(event.key, 10);
      if (index >= 1 && index <= first.options.length) {
        event.preventDefault();
        void onSelect(first.id, first.options[index - 1]);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [first, busyId, onSelect]);

  if (!chatId || choices.length === 0) return null;

  return (
    <div className="choices" role="region" aria-label="Choice prompts">
      {choices.map((choice) => (
        <article key={choice.id} className="choice-card" aria-busy={busyId === choice.id}>
          <div className="choice-header">
            <span className="choice-tag">Your choice</span>
            <p className="choice-title">{choice.prompt}</p>
          </div>
          <div className="choice-actions">
            {choice.options.map((option, index) => (
              <button
                key={option}
                type="button"
                className="choice-btn"
                disabled={busyId === choice.id}
                onClick={() => void onSelect(choice.id, option)}
                title={`Option ${index + 1}`}
              >
                <span className="choice-key">{index + 1}</span>
                <span className="choice-label">{option}</span>
              </button>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}
