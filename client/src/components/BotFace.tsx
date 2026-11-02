import { useRef, useMemo, useSyncExternalStore } from 'react';
import type { Presence } from '../../../shared/chat/types';
import { type BotConfig, DEFAULT_BOT, COLORS, SHAPES, renderBot, decodeBot, encodeBot } from './bricksbot-avatar';

export {
  type BotConfig,
  DEFAULT_BOT,
  SHAPES,
  COLORS,
  COLOR_NAMES,
  HAT_NAMES,
  GLASSES_NAMES,
  encodeBot,
  decodeBot,
  renderBot,
  attachMouseFollow,
} from './bricksbot-avatar';

export type BotLook = BotConfig;
export const encodeLook = encodeBot;

/** Legacy blob looks used lowercase shape letter (a–l) + color letter (a–k). */
const LEGACY_SHAPE = 'abcdefghijkl';
const LEGACY_COLOR = 'abcdefghijk';

export const decodeLook = (s: string | undefined): BotLook | null => {
  if (!s) return null;
  if (s.includes('.')) {
    const parts = s.split('.');
    if (parts.length === 4 && parts.every((p) => p !== '' && !Number.isNaN(Number(p)))) {
      return decodeBot(s);
    }
    return null;
  }
  // Migrate prior 2-char avatarLabel → brick config (hat/glasses none).
  if (s.length === 2) {
    const shape = LEGACY_SHAPE.indexOf(s[0]!);
    const color = LEGACY_COLOR.indexOf(s[1]!);
    if (shape >= 0 && shape < SHAPES.length && color >= 0 && color < COLORS.length) {
      return { shape, color, hat: 0, glasses: 0 };
    }
  }
  return null;
};

function hashId(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash;
}

const labels = new Map<string, string>();
const primaryIds = new Set<string>();
const listeners = new Set<() => void>();
let notifyScheduled = false;

function subscribeLookChanges(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Called by the app whenever the roster changes so any BotFace can resolve its look by bot id. */
export function registerBotLooks(bots: { id: string; avatarLabel: string; isPrimary?: boolean }[]) {
  let changed = false;
  for (const bot of bots) {
    if (labels.get(bot.id) !== bot.avatarLabel) {
      labels.set(bot.id, bot.avatarLabel);
      changed = true;
    }
    if (bot.isPrimary && !primaryIds.has(bot.id)) {
      primaryIds.add(bot.id);
      changed = true;
    }
  }
  if (changed && listeners.size > 0 && !notifyScheduled) {
    notifyScheduled = true;
    queueMicrotask(() => {
      notifyScheduled = false;
      for (const listener of listeners) listener();
    });
  }
}

export function botLook(id: string, isPrimary: boolean): BotLook {
  const stored = decodeLook(labels.get(id));
  if (stored) return stored;
  if (isPrimary || primaryIds.has(id)) return { ...DEFAULT_BOT };
  const hash = hashId(id);
  // Lively colors (skip 0 black and 10 gray for auto-assigned bots)
  const lively = [2, 3, 4, 5, 6, 7, 8, 9];
  return {
    shape: hash % 15,
    color: lively[(hash >>> 4) % lively.length],
    hat: 0,
    glasses: 0,
  };
}

export function botColor(id: string, isPrimary: boolean): string {
  const look = botLook(id, isPrimary);
  return COLORS[look.color]?.[0] ?? COLORS[7][0];
}

const freshIds = new Set<string>();

/** Marks a bot so its face plays the entrance animation the first time it mounts. */
export function markBotFresh(id: string) {
  freshIds.add(id);
}

export function BotFace({
  size,
  botId,
  shape,
  color,
  config,
  thinking = false,
  presence,
  entering = false,
  track = false,
  title,
}: {
  color?: string;
  size: number;
  /** Resolves the persisted shape for this bot. */
  botId?: string;
  /** Explicit shape index; wins over botId. */
  shape?: number;
  /** Explicit BotConfig; wins over botId and shape. */
  config?: BotConfig;
  /** @deprecated Prefer `presence`. Kept for call sites that only know thinking/working. */
  thinking?: boolean;
  presence?: Presence;
  /** Plays the one-shot entrance animation (creator preview). */
  entering?: boolean;
  /** Eyes/body follow the pointer. */
  track?: boolean;
  title?: string;
}) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const playEnter = entering || (botId != null && freshIds.delete(botId));

  const storedLabel = useSyncExternalStore(
    subscribeLookChanges,
    () => (botId ? labels.get(botId) : undefined),
    () => (botId ? labels.get(botId) : undefined)
  );
  const isPrimary = useSyncExternalStore(
    subscribeLookChanges,
    () => (botId ? primaryIds.has(botId) : false),
    () => (botId ? primaryIds.has(botId) : false)
  );

  const resolvedConfig = useMemo<BotConfig>(() => {
    if (config) return config;
    const base = { ...(botId ? botLook(botId, isPrimary) : DEFAULT_BOT) };
    if (shape !== undefined) base.shape = shape;
    return base;
  }, [config, botId, shape, storedLabel, isPrimary]);

  const svgHtml = useMemo(
    () => renderBot(resolvedConfig, size),
    [resolvedConfig.shape, resolvedConfig.color, resolvedConfig.hat, resolvedConfig.glasses, size]
  );

  // color/track kept for call-site compatibility (global mouse-follow + config-driven color).
  void color;
  void track;

  const resolvedPresence = presence ?? (thinking ? 'thinking' : 'online');

  const presenceClass = useMemo(() => {
    if (resolvedPresence === 'waiting') return ' is-waiting';
    if (resolvedPresence === 'blocked') return ' is-blocked';
    if (resolvedPresence === 'thinking' || resolvedPresence === 'working') return ' is-thinking';
    return '';
  }, [resolvedPresence]);

  return (
    <span
      ref={containerRef}
      className={`bot-face-wrapper${presenceClass}${playEnter ? ' is-entering' : ''}`}
      title={title}
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: svgHtml }}
    />
  );
}
