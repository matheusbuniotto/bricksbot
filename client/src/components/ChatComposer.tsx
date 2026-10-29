import { ArrowUp } from 'lucide-react';
import { useRef, useState } from 'react';

export function ChatComposer({
  disabled,
  placeholder,
  accent,
  onSend,
}: {
  disabled?: boolean;
  placeholder?: string;
  accent: string;
  onSend: (content: string) => Promise<void>;
}) {
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const label = placeholder ?? 'Message';

  async function submit() {
    const content = value.trim();
    if (!content || sending || disabled) return;
    setValue('');
    setSending(true);
    try {
      await onSend(content);
    } catch {
      setValue((current) => current || content);
    } finally {
      setSending(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <textarea
        ref={inputRef}
        value={value}
        rows={1}
        placeholder={label}
        aria-label={label}
        disabled={disabled}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void submit();
          }
        }}
      />
      <button
        type="submit"
        className="composer-send"
        aria-label="Send"
        disabled={disabled || !value.trim()}
        style={{ background: accent }}
      >
        <ArrowUp size={18} strokeWidth={2} />
      </button>
    </form>
  );
}
