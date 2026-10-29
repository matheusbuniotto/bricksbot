import { useEffect } from 'react';
import type { ApprovalDecision, ApprovalRequest } from '../../../shared/agents/types';
import { approvalTitle } from '../lib/user-facing';

function readStr(val: unknown): string {
  return typeof val === 'string' ? val : '';
}

function renderToolDetails(toolCall: ApprovalRequest['toolCall']) {
  const { name, arguments: args } = toolCall;

  if (name === 'sql_query') {
    const statement = readStr(args.statement);
    return (
      <div className="approval-details">
        <pre className="approval-code-block">
          <code>{statement}</code>
        </pre>
      </div>
    );
  }

  if (name === 'lakehouse_catalog') {
    const action = readStr(args.action);
    const catalog = readStr(args.catalog);
    const schema = readStr(args.schema);
    const table = readStr(args.table);
    const parts = [catalog, schema, table].filter(Boolean).join(' / ');
    return (
      <div className="approval-details">
        {action ? <span className="approval-chip">{action}</span> : null}
        {parts ? <span className="approval-target">{parts}</span> : null}
      </div>
    );
  }

  if (name === 'volume_read') {
    const path = readStr(args.path);
    return (
      <div className="approval-details">
        <span className="approval-path">{path}</span>
      </div>
    );
  }

  if (name === 'web_fetch' && typeof args.url === 'string') {
    return (
      <div className="approval-details">
        <span className="approval-url">{args.url}</span>
      </div>
    );
  }

  if (name === 'handoff_to_bot') {
    const target = readStr(args.bot_name) || readStr(args.bot_id) || 'teammate';
    const brief = readStr(args.brief);
    return (
      <div className="approval-details">
        <span className="approval-chip">To {target}</span>
        {brief ? <p className="approval-brief">&ldquo;{brief}&rdquo;</p> : null}
      </div>
    );
  }

  if (name === 'create_bot') {
    const botName = readStr(args.name) || 'new bot';
    const job = readStr(args.job);
    const section = readStr(args.section_name) || readStr(args.space_id);
    return (
      <div className="approval-details">
        <span className="approval-chip">{botName}</span>
        {section ? <span className="approval-target">{section}</span> : null}
        {job ? <p className="approval-brief">&ldquo;{job}&rdquo;</p> : null}
      </div>
    );
  }

  const entries = Object.entries(args).filter(([, value]) => value != null && value !== '');
  if (entries.length === 0) return null;

  return (
    <div className="approval-details">
      <ul className="approval-kv">
        {entries.map(([key, value]) => (
          <li key={key}>
            <span className="approval-kv-key">{key.replace(/_/g, ' ')}</span>
            <span className="approval-kv-value">
              {typeof value === 'string' ? value : Array.isArray(value) ? value.join(', ') : String(value)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ApprovalCards({
  approvals,
  busyId,
  onDecide,
}: {
  approvals: ApprovalRequest[];
  busyId: string | null;
  onDecide: (id: string, decision: ApprovalDecision) => Promise<void>;
}) {
  const firstApproval = approvals[0];

  useEffect(() => {
    if (!firstApproval || busyId) return;

    function handleKeyDown(event: KeyboardEvent) {
      // Don't intercept if user is typing in an input or textarea
      const target = event.target as HTMLElement | null;
      if (
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      const askEveryTime = firstApproval.toolCall.name === 'create_bot';
      if (askEveryTime) {
        if (key === 'a' || key === '1') {
          event.preventDefault();
          void onDecide(firstApproval.id, 'once');
        } else if (key === 'b' || key === '2' || key === 'c' || key === '3' || key === 'escape') {
          event.preventDefault();
          void onDecide(firstApproval.id, 'denied');
        }
        return;
      }
      if (key === 'a' || key === '1') {
        event.preventDefault();
        void onDecide(firstApproval.id, 'all_the_time');
      } else if (key === 'b' || key === '2') {
        event.preventDefault();
        void onDecide(firstApproval.id, 'once');
      } else if (key === 'c' || key === '3' || key === 'escape') {
        event.preventDefault();
        void onDecide(firstApproval.id, 'denied');
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [firstApproval, busyId, onDecide]);

  if (approvals.length === 0) return null;

  return (
    <div className="approvals" role="region" aria-label="Approval requests">
      {approvals.map((approval) => (
        <article key={approval.id} className="approval-card" aria-busy={busyId === approval.id}>
          <div className="approval-header">
            <span className="approval-tag">Approval needed</span>
            <p className="approval-title">{approvalTitle(approval.toolCall.name)}</p>
          </div>

          {renderToolDetails(approval.toolCall)}

          <div className="approval-actions">
            {approval.toolCall.name !== 'create_bot' ? (
              <button
                type="button"
                className="approval-btn approval-btn-always"
                disabled={busyId === approval.id}
                onClick={() => void onDecide(approval.id, 'all_the_time')}
                title="Approve this execution and future calls for this tool in this chat"
              >
                <span className="approval-key">A</span>
                <div className="approval-btn-labels">
                  <span className="approval-main-label">Always allow</span>
                  <span className="approval-sub-label">All the time (auto-approve upcoming)</span>
                </div>
              </button>
            ) : null}

            <button
              type="button"
              className="approval-btn approval-btn-once"
              disabled={busyId === approval.id}
              onClick={() => void onDecide(approval.id, 'once')}
              title="Approve only this execution"
            >
              <span className="approval-key">{approval.toolCall.name === 'create_bot' ? 'A' : 'B'}</span>
              <div className="approval-btn-labels">
                <span className="approval-main-label">Once</span>
                <span className="approval-sub-label">Just this once (ask again next time)</span>
              </div>
            </button>

            <button
              type="button"
              className="approval-btn approval-btn-deny"
              disabled={busyId === approval.id}
              onClick={() => void onDecide(approval.id, 'denied')}
              title="Deny tool execution"
            >
              <span className="approval-key">{approval.toolCall.name === 'create_bot' ? 'B' : 'C'}</span>
              <div className="approval-btn-labels">
                <span className="approval-main-label">Not approve</span>
                <span className="approval-sub-label">Cancel action</span>
              </div>
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}
