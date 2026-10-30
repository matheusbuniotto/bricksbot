/** Structured artifact pin notice stored in system message content. */

export type ArtifactPinKind = 'note' | 'sql' | 'volume_path' | 'link';

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
    const parsed = JSON.parse(trimmed) as Partial<ArtifactPinNotice>;
    if (parsed.kind !== 'artifact_pin' || !parsed.title) return null;
    const artifactKind = parsed.artifactKind;
    if (
      artifactKind !== 'note' &&
      artifactKind !== 'sql' &&
      artifactKind !== 'volume_path' &&
      artifactKind !== 'link'
    ) {
      return null;
    }
    const body = typeof parsed.body === 'string' ? parsed.body : '';
    return {
      kind: 'artifact_pin',
      title: parsed.title,
      artifactKind,
      body,
      summary: typeof parsed.summary === 'string' ? parsed.summary : undefined,
      pinnedByBotId: typeof parsed.pinnedByBotId === 'string' ? parsed.pinnedByBotId : '',
      pinnedByName: typeof parsed.pinnedByName === 'string' ? parsed.pinnedByName : '',
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
