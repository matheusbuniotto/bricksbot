import { useEffect, useMemo, type ReactNode } from 'react';
import {
  type BotConfig,
  SHAPES,
  COLORS,
  HAT_NAMES,
  GLASSES_NAMES,
  renderBot,
  hatChip,
  glassesChip,
  attachMouseFollow,
} from './bricksbot-avatar';

const Html = ({ html }: { html: string }) => <span className="bot-svg-wrap" dangerouslySetInnerHTML={{ __html: html }} />;

export function BotAvatar({ config, size = 48 }: { config: BotConfig; size?: number }) {
  const html = useMemo(
    () => renderBot(config, size),
    [config.shape, config.color, config.hat, config.glasses, size]
  );
  return <Html html={html} />;
}

export function useMouseFollow() {
  useEffect(() => attachMouseFollow(), []);
}

export function BotPicker({
  value,
  onChange,
  children,
}: {
  value: BotConfig;
  onChange: (v: BotConfig) => void;
  children?: ReactNode;
}) {
  const set = (p: Partial<BotConfig>) => onChange({ ...value, ...p });
  return (
    <div className="bot-picker-container">
      <div className="bot-picker-preview">
        <BotAvatar config={value} size={120} />
      </div>

      {children}

      <div role="radiogroup" aria-label="Shape" className="grid5">
        {SHAPES.map((_, i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={value.shape === i}
            aria-label={`Shape ${i + 1}`}
            onClick={() => set({ shape: i })}
          >
            <BotAvatar config={{ ...value, shape: i }} size={46} />
          </button>
        ))}
      </div>

      <div role="radiogroup" aria-label="Color" className="dots">
        {COLORS.map(([face], i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={value.color === i}
            aria-label={`Color ${i + 1}`}
            style={{ background: face }}
            onClick={() => set({ color: i })}
          />
        ))}
      </div>

      <div className="bot-picker-row">
        <span className="bot-picker-label">Hat</span>
        <div role="radiogroup" aria-label="Hat" className="chips">
          {HAT_NAMES.map((name, i) => (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={value.hat === i}
              aria-label={name}
              onClick={() => set({ hat: i })}
            >
              {i ? <Html html={hatChip(i, value.color)} /> : <span>None</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="bot-picker-row">
        <span className="bot-picker-label">Glasses</span>
        <div role="radiogroup" aria-label="Glasses" className="chips">
          {GLASSES_NAMES.map((name, i) => (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={value.glasses === i}
              aria-label={name}
              onClick={() => set({ glasses: i })}
            >
              {i ? <Html html={glassesChip(i, value.color)} /> : <span>None</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
