import type { ArtifactPinNotice } from '../../../shared/chat/artifact-pin-notice';
import { ArtifactRender } from './ArtifactRender';

const KIND_LABELS: Record<ArtifactPinNotice['artifactKind'], string> = {
  note: 'Note',
  sql: 'SQL',
  volume_path: 'Volume',
  link: 'Link',
  table: 'Table',
  chart: 'Chart',
  mermaid: 'Diagram',
};

export function ArtifactPinStatus({ notice }: { notice: ArtifactPinNotice }) {
  const preview = notice.summary?.trim() || notice.title.trim();
  const kindLabel = KIND_LABELS[notice.artifactKind];

  return (
    <div className="message message-system message-handoff-tight message-enter artifact-pin">
      <div className="handoff-status" title={notice.body.slice(0, 500)}>
        <span className="handoff-status-label">Pinned</span>
        <span className="handoff-status-meta">{kindLabel}</span>
        <span className="handoff-status-name">{preview}</span>
      </div>
      <ArtifactRender notice={notice} />
    </div>
  );
}
