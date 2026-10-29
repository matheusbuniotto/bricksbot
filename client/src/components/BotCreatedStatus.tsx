import type { BotCreatedNotice } from '../../../shared/chat/bot-created-notice';
import { BotFace, botColor } from './BotFace';

export function BotCreatedStatus({
  notice,
  onOpenBot,
}: {
  notice: BotCreatedNotice;
  onOpenBot?: (botId: string) => void;
}) {
  const accent = botColor(notice.botId || notice.name, false);
  const canOpen = Boolean(notice.botId && onOpenBot);

  return (
    <div className="message message-system message-handoff-tight message-enter">
      <button
        type="button"
        className={canOpen ? 'handoff-status handoff-status-clickable' : 'handoff-status'}
        onClick={() => {
          if (canOpen) onOpenBot?.(notice.botId);
        }}
        disabled={!canOpen}
        title={canOpen ? `Open ${notice.name}` : undefined}
      >
        <span className="handoff-status-label">Created Bot</span>
        <BotFace color={accent} size={18} botId={notice.botId} />
        <span className="handoff-status-name">{notice.name}</span>
      </button>
    </div>
  );
}
