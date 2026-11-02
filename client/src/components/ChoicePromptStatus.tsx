import type { ChoiceAnswerNotice, ChoicePromptNotice } from '../../../shared/chat/choice-notice';
import { choiceAnswerPreviewLine } from '../../../shared/chat/choice-notice';

export function ChoicePromptStatus({
  notice,
  selectedOption,
}: {
  notice: ChoicePromptNotice;
  selectedOption?: string;
}) {
  return (
    <div className="choice-transcript" role="group" aria-label="Choice prompt">
      <p className="choice-transcript-prompt">{notice.prompt}</p>
      <ul className="choice-transcript-options">
        {notice.options.map((option) => {
          const picked = selectedOption === option;
          return (
            <li
              key={option}
              className={
                picked ? 'choice-transcript-option choice-transcript-option-picked' : 'choice-transcript-option'
              }
            >
              {option}
              {picked ? <span className="choice-transcript-picked-mark"> ✓</span> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function ChoiceAnswerStatus({ notice }: { notice: ChoiceAnswerNotice }) {
  return (
    <div className="choice-answer-notice" role="status">
      {choiceAnswerPreviewLine(notice)}
    </div>
  );
}
