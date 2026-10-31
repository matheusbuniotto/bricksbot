/** Structured artifact pin notice stored in system message content. */

export const ARTIFACT_PIN_KINDS = [
  'note',
  'sql',
  'volume_path',
  'link',
  'table',
  'chart',
  'mermaid',
] as const;

export type ArtifactPinKind = (typeof ARTIFACT_PIN_KINDS)[number];

/** Max body chars per pin kind. Charts and tables carry data; everything else stays short. */
export const ARTIFACT_BODY_LIMITS: Record<ArtifactPinKind, number> = {
  note: 8_000,
  sql: 8_000,
  volume_path: 8_000,
  link: 8_000,
  table: 64_000,
  chart: 64_000,
  mermaid: 16_000,
};

export interface ArtifactPinNotice {
  kind: 'artifact_pin';
  title: string;
  artifactKind: ArtifactPinKind;
  body: string;
  summary?: string;
  pinnedByBotId: string;
  pinnedByName: string;
}

export function serializeArtifactPinNotice(notice: ArtifactPinNotice): string {
  return JSON.stringify(notice);
}

export function parseArtifactPinNotice(content: string): ArtifactPinNotice | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!('kind' in parsed) || parsed.kind !== 'artifact_pin') return null;
    if (!('title' in parsed) || typeof parsed.title !== 'string' || !parsed.title) return null;
    if (!('artifactKind' in parsed) || typeof parsed.artifactKind !== 'string') return null;
    const artifactKind = parsed.artifactKind as ArtifactPinKind;
    if (!ARTIFACT_PIN_KINDS.includes(artifactKind)) return null;
    const body = 'body' in parsed && typeof parsed.body === 'string' ? parsed.body : '';
    return {
      kind: 'artifact_pin',
      title: parsed.title,
      artifactKind,
      body,
      summary: 'summary' in parsed && typeof parsed.summary === 'string' ? parsed.summary : undefined,
      pinnedByBotId:
        'pinnedByBotId' in parsed && typeof parsed.pinnedByBotId === 'string'
          ? parsed.pinnedByBotId
          : '',
      pinnedByName:
        'pinnedByName' in parsed && typeof parsed.pinnedByName === 'string'
          ? parsed.pinnedByName
          : '',
    };
  } catch {
    return null;
  }
}

/** One-line transcript / roster preview for a pin. */
export function artifactPinPreviewLine(notice: ArtifactPinNotice): string {
  const line = notice.summary?.trim() || notice.title.trim();
  return line ? `Pinned: ${line}` : 'Pinned finding';
}
