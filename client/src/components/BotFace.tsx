import { useState } from 'react';

/**
 * Bot looks: a body shape + color, persisted in the bot's 2-char `avatarLabel`
 * (shape letter + color letter, both lowercase). Legacy labels fall back to a
 * deterministic look derived from the bot id.
 */

type ShapeSpec =
  | { kind: 'lobed'; id: string; letter: string; lobes: number; amp: number; rotDeg: number }
  | { kind: 'superellipse'; id: string; letter: string; power: number };

const lobed = (id: string, letter: string, lobes: number, amp: number, rotDeg: number): ShapeSpec => ({
  kind: 'lobed',
  id,
  letter,
  lobes,
  amp,
  rotDeg,
});

export const BOT_SHAPES: readonly ShapeSpec[] = [
  lobed('round', 'a', 0, 0, 0),
  lobed('blob', 'b', 5, 0.11, -90),
  { kind: 'superellipse', id: 'squircle', letter: 'c', power: 3.2 },
  lobed('sparkle', 'd', 4, 0.2, -45),
  lobed('cloud', 'e', 6, 0.07, -90),
  lobed('clover', 'f', 4, 0.1, 0),
  lobed('flower', 'g', 8, 0.07, 0),
  lobed('star', 'h', 6, 0.15, -90),
  { kind: 'superellipse', id: 'gem', letter: 'i', power: 1.6 },
  lobed('pebble', 'j', 3, 0.1, -90),
  lobed('fuzz', 'k', 11, 0.05, -90),
  lobed('wobble', 'l', 7, 0.09, -90),
];

interface BotColor {
  readonly id: string;
  readonly value: string;
  readonly label: string;
}

export const BOT_COLORS: readonly BotColor[] = [
  { id: 'a', value: 'oklch(0.25 0.01 260)', label: 'Black' },
  { id: 'b', value: 'oklch(0.48 0.09 55)', label: 'Brown' },
  { id: 'c', value: 'oklch(0.62 0.23 25)', label: 'Red' },
  { id: 'd', value: 'oklch(0.67 0.2 45)', label: 'Orange' },
  { id: 'e', value: 'oklch(0.76 0.17 75)', label: 'Amber' },
  { id: 'f', value: 'oklch(0.66 0.19 150)', label: 'Green' },
  { id: 'g', value: 'oklch(0.69 0.12 180)', label: 'Teal' },
  { id: 'h', value: 'oklch(0.6 0.22 255)', label: 'Blue' },
  { id: 'i', value: 'oklch(0.58 0.23 295)', label: 'Purple' },
  { id: 'j', value: 'oklch(0.64 0.24 355)', label: 'Pink' },
  { id: 'k', value: 'oklch(0.6 0 0)', label: 'Gray' },
];

export interface BotLook {
  shape: number;
  color: number;
}

export function encodeLook({ shape, color }: BotLook): string {
  const shapeLetter = BOT_SHAPES[shape]?.letter ?? BOT_SHAPES[0].letter;
  const colorId = BOT_COLORS[color]?.id ?? BOT_COLORS[0].id;
  return `${shapeLetter}${colorId}`;
}

export function decodeLook(label: string | undefined): BotLook | null {
  if (label?.length !== 2) return null;
  const shape = BOT_SHAPES.findIndex((spec) => spec.letter === label[0]);
  const color = BOT_COLORS.findIndex((c) => c.id === label[1]);
  return shape >= 0 && color >= 0 ? { shape, color } : null;
}

function hashId(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash;
}

const labels = new Map<string, string>();
const primaryIds = new Set<string>();

/** Called by the app whenever the roster changes so any BotFace can resolve its look by bot id. */
export function registerBotLooks(bots: { id: string; avatarLabel: string; isPrimary?: boolean }[]) {
  for (const bot of bots) {
    labels.set(bot.id, bot.avatarLabel);
    if (bot.isPrimary) primaryIds.add(bot.id);
  }
}

export function botLook(id: string, isPrimary: boolean): BotLook {
  const stored = decodeLook(labels.get(id));
  if (stored) return stored;
  if (isPrimary || primaryIds.has(id)) return { shape: 0, color: 7 };
  const hash = hashId(id);
  // Skip black/gray defaults so auto-assigned bots always look lively.
  const lively = [2, 3, 4, 5, 6, 7, 8, 9];
  return { shape: hash % BOT_SHAPES.length, color: lively[(hash >>> 4) % lively.length] };
}

export function botColor(id: string, isPrimary: boolean): string {
  return BOT_COLORS[botLook(id, isPrimary).color].value;
}

function shapePoint(spec: ShapeSpec, t: number): readonly [number, number] {
  switch (spec.kind) {
    case 'superellipse': {
      const c = Math.cos(t);
      const s = Math.sin(t);
      const exp = 2 / spec.power;
      return [50 + 46 * Math.sign(c) * Math.abs(c) ** exp, 50 + 46 * Math.sign(s) * Math.abs(s) ** exp];
    }
    case 'lobed': {
      const wave = (Math.cos(spec.lobes * t + (spec.rotDeg * Math.PI) / 180) + 1) / 2;
      const r = 46 * (1 - spec.amp + spec.amp * 2 * wave);
      return [50 + r * Math.cos(t), 50 + r * Math.sin(t)];
    }
    default: {
      const _exhaustive: never = spec;
      return _exhaustive;
    }
  }
}

function shapePath(spec: ShapeSpec): string {
  const steps = 240;
  const commands = Array.from({ length: steps }, (_, i) => {
    const [x, y] = shapePoint(spec, (i / steps) * Math.PI * 2);
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
  });
  return `${commands.join('')}Z`;
}

const PATHS = BOT_SHAPES.map(shapePath);

const freshIds = new Set<string>();

/** Marks a bot so its face plays the entrance animation the first time it mounts. */
export function markBotFresh(id: string) {
  freshIds.add(id);
}

export function BotFace({
  color,
  size,
  botId,
  shape,
  thinking = false,
  entering = false,
}: {
  color: string;
  size: number;
  /** Resolves the persisted shape for this bot. */
  botId?: string;
  /** Explicit shape index (used by the creator preview); wins over botId. */
  shape?: number;
  thinking?: boolean;
  /** Plays the one-shot entrance animation (creator preview). */
  entering?: boolean;
}) {
  const [fresh] = useState(() => (botId ? freshIds.delete(botId) : false));
  const index = shape ?? (botId ? botLook(botId, false).shape : 0);
  return (
    <svg
      className={`bot-face${thinking ? ' is-thinking' : ''}${entering || fresh ? ' is-entering' : ''}`}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-hidden="true"
      shapeRendering="geometricPrecision"
    >
      <g className="bot-face-body">
        <path d={PATHS[index] ?? PATHS[0]} fill={color} />
        <g className="bot-face-eyes">
          <line className="bot-eye" x1="40.5" y1="40" x2="40.5" y2="56" />
          <line className="bot-eye" x1="59.5" y1="40" x2="59.5" y2="56" />
        </g>
      </g>
    </svg>
  );
}
