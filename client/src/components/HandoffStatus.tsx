import type { HandoffNotice } from '../../../shared/chat/handoff-notice';
import { BotFace, botColor } from './BotFace';

export function HandoffStatus({ notice, onOpen }: { notice: HandoffNotice; onOpen: (notice: HandoffNotice) => void }) {
  const accent = botColor(notice.targetBotId || notice.targetName, notice.targetName === 'Primary');
  const canPeek = Boolean(notice.targetBotId);
  const count = notice.messageCount && notice.messageCount > 0 ? notice.messageCount : null;

  let label: string;
  if (notice.direction === 'thread' && count != null) {
    label = `${count} message${count === 1 ? '' : 's'} with`;
  } else if (notice.direction === 'received') {
    label = 'Message from';
  } else {
    label = 'Sent message to';
  }

  return (
    <div className="message message-system message-handoff-tight message-enter">
      <button
        type="button"
        className={canPeek ? 'handoff-status handoff-status-clickable' : 'handoff-status'}
        onClick={() => {
          if (canPeek) onOpen(notice);
        }}
        disabled={!canPeek}
        title={canPeek ? `View chat with ${notice.targetName}` : undefined}
      >
        <span className="handoff-status-label">{label}</span>
        <BotFace color={accent} size={18} botId={notice.targetBotId} />
        <span className="handoff-status-name">{notice.targetName}</span>
      </button>
    </div>
  );
}
