const PALETTE = [
  'oklch(0.58 0.22 25)',
  'oklch(0.55 0.19 255)',
  'oklch(0.56 0.14 155)',
  'oklch(0.64 0.15 55)',
  'oklch(0.55 0.16 310)',
  'oklch(0.62 0.17 350)',
];

export function botColor(id: string, isPrimary: boolean): string {
  if (isPrimary) return 'oklch(0.55 0.2 255)';
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

export function BotFace({ color, size }: { color: string; size: number }) {
  return (
    <svg className="bot-face" width={size} height={size} viewBox="0 0 68 68" aria-hidden="true">
      <circle cx="34" cy="34" r="34" fill={color} />
      <rect x="22" y="20" width="8" height="28" rx="4" fill="white" />
      <rect x="38" y="20" width="8" height="28" rx="4" fill="white" />
    </svg>
  );
}
