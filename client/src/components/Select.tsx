import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export type SelectOption = { value: string; label: string };

/** Themed dropdown (native <select> popups can't follow the app UI). */
export function Select({
  value,
  options,
  onChange,
  ariaLabel,
  disabled,
  className,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`select ${className ?? ''}`}>
      <button
        type="button"
        className="field select-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="select-value">{selected?.label ?? 'Select…'}</span>
        <ChevronDown size={16} className="select-chevron" aria-hidden />
      </button>
      {open ? (
        <div className="select-menu" role="listbox">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={option.value === value ? 'is-selected' : undefined}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <span>{option.label}</span>
              {option.value === value ? <Check size={14} aria-hidden /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
