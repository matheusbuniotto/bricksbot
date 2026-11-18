import { useEffect } from 'react';
import type { ApprovalDecision, ApprovalRequest } from '../../../shared/agents/types';
import { approvalTitle, isOnceOnlyApproval } from '../lib/user-facing';
import { isTypingTarget } from '../lib/keyboard';

function readStr(val: unknown): string {
  return typeof val === 'string' ? val : '';
}

function baseName(rawPath: string): string {
  const clean = rawPath.trim().replace(/\\/g, '/');
  const parts = clean.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? clean;
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

  if (name === 'volume_write') {
    const relative = readStr(args.relative_path);
    const resolved = readStr(args.resolved_path);
    const botName = readStr(args.bot_name);
    const bytes = typeof args.byte_size === 'number' ? args.byte_size : Number(args.byte_size);
    const remaining = typeof args.remaining_bytes === 'number' ? args.remaining_bytes : Number(args.remaining_bytes);
    return (
      <div className="approval-details">
        {botName ? <span className="approval-chip">{botName}</span> : null}
        {relative ? <span className="approval-path">{relative}</span> : null}
        {resolved ? <span className="approval-path">{resolved}</span> : null}
        {Number.isFinite(bytes) ? <span className="approval-target">{bytes} bytes</span> : null}
        {Number.isFinite(remaining) ? <span className="approval-target">{remaining} bytes left</span> : null}
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

  if (name === 'ask_choice') {
    const prompt = readStr(args.prompt);
    const options = Array.isArray(args.options)
      ? args.options.filter((value): value is string => typeof value === 'string')
      : [];
    return (
      <div className="approval-details">
        {prompt ? <p className="approval-brief">{prompt}</p> : null}
        {options.length > 0 ? (
          <ul className="approval-kv">
            {options.map((option) => (
              <li key={option}>
                <span className="approval-kv-value">{option}</span>
              </li>
            ))}
          </ul>
        ) : null}
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

  if (name === 'schedule_routine') {
    const routineName = readStr(args.name) || 'routine';
    const cron = readStr(args.cron);
    const prompt = readStr(args.prompt);
    return (
      <div className="approval-details">
        <span className="approval-chip">{routineName}</span>
        {cron ? <span className="approval-target font-mono">{cron}</span> : null}
        {prompt ? <p className="approval-brief">&ldquo;{prompt}&rdquo;</p> : null}
      </div>
    );
  }

  if (name === 'update_routine') {
    const label = readStr(args.new_name) || readStr(args.name) || readStr(args.routine_id) || 'routine';
    const cron = readStr(args.cron);
    const prompt = readStr(args.prompt);
    const enabled = args.enabled === undefined ? '' : args.enabled ? 'enable' : 'pause';
    return (
      <div className="approval-details">
        <span className="approval-chip">{label}</span>
        {cron ? <span className="approval-target font-mono">{cron}</span> : null}
        {enabled ? <span className="approval-target">{enabled}</span> : null}
        {prompt ? <p className="approval-brief">&ldquo;{prompt}&rdquo;</p> : null}
      </div>
    );
  }

  if (name === 'delete_routine') {
    const label = readStr(args.name) || readStr(args.routine_id) || 'routine';
    return (
      <div className="approval-details">
        <span className="approval-chip">Delete {label}</span>
      </div>
    );
  }

  if (name === 'python_exec') {
    const code = readStr(args.code);
    return (
      <div className="approval-details">
        <pre className="approval-code-block">
          <code>{code}</code>
        </pre>
      </div>
    );
  }

  if (name === 'sandbox_exec') {
    const command = readStr(args.command);
    return (
      <div className="approval-details">
        <pre className="approval-code-block">
          <code>{command}</code>
        </pre>
      </div>
    );
  }

  if (name === 'sandbox_upload') {
    const dest = baseName(readStr(args.destination) || 'file');
    return (
      <div className="approval-details">
        <span className="approval-chip">Write {dest}</span>
      </div>
    );
  }

  if (name === 'sandbox_download') {
    const src = baseName(readStr(args.source) || 'file');
    return (
      <div className="approval-details">
        <span className="approval-chip">Read {src}</span>
      </div>
    );
  }

  if (name === 'sandbox_save_artifact') {
    const file = baseName(readStr(args.source_path) || 'artifact');
    const volumePath = readStr(args.volume_path);
    return (
      <div className="approval-details">
        <span className="approval-chip">{file}</span>
        {volumePath ? <span className="approval-path">{volumePath}</span> : null}
      </div>
    );
  }

  if (name === 'sandbox_delete') {
    return (
      <div className="approval-details">
        <span className="approval-chip">Delete sandbox</span>
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
      if (isTypingTarget(event.target)) return;

      const key = event.key.toLowerCase();
      const onceOnly = isOnceOnlyApproval(firstApproval.toolCall.name);
      if (onceOnly) {
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

  if (!firstApproval || approvals.length === 0) return null;

  const sameToolPending = approvals.filter((item) => item.toolCall.name === firstApproval.toolCall.name).length;
  const otherPending = approvals.length - 1;
  const onceOnly = isOnceOnlyApproval(firstApproval.toolCall.name);

  return (
    <div className="approvals" role="region" aria-label="Approval requests">
      <article key={firstApproval.id} className="approval-card" aria-busy={busyId === firstApproval.id}>
        <div className="approval-header">
          <span className="approval-tag">Approval needed</span>
          <p className="approval-title">{approvalTitle(firstApproval.toolCall.name)}</p>
          {sameToolPending > 1 ? (
            <p className="approval-queue">
              {sameToolPending} similar requests in this turn
              {onceOnly ? ' — Once applies to this one' : ' — Always allow clears all of them'}
            </p>
          ) : otherPending > 0 ? (
            <p className="approval-queue">
              {otherPending} more approval{otherPending === 1 ? '' : 's'} waiting after this
            </p>
          ) : null}
        </div>

        {renderToolDetails(firstApproval.toolCall)}

        <div className="approval-actions">
          {!onceOnly ? (
            <button
              type="button"
              className="approval-btn approval-btn-always"
              disabled={busyId === firstApproval.id}
              onClick={() => void onDecide(firstApproval.id, 'all_the_time')}
              title="Approve this execution and future calls for this tool in this chat"
            >
              <span className="approval-key">A</span>
              <div className="approval-btn-labels">
                <span className="approval-main-label">Always allow</span>
                <span className="approval-sub-label">
                  {sameToolPending > 1
                    ? `All ${sameToolPending} now + auto-approve upcoming`
                    : 'All the time (auto-approve upcoming)'}
                </span>
              </div>
            </button>
          ) : null}

          <button
            type="button"
            className="approval-btn approval-btn-once"
            disabled={busyId === firstApproval.id}
            onClick={() => void onDecide(firstApproval.id, 'once')}
            title="Approve only this execution"
          >
            <span className="approval-key">{onceOnly ? 'A' : 'B'}</span>
            <div className="approval-btn-labels">
              <span className="approval-main-label">Once</span>
              <span className="approval-sub-label">Just this once (ask again next time)</span>
            </div>
          </button>

          <button
            type="button"
            className="approval-btn approval-btn-deny"
            disabled={busyId === firstApproval.id}
            onClick={() => void onDecide(firstApproval.id, 'denied')}
            title="Deny tool execution"
          >
            <span className="approval-key">{onceOnly ? 'B' : 'C'}</span>
            <div className="approval-btn-labels">
              <span className="approval-main-label">Not approve</span>
              <span className="approval-sub-label">Cancel action</span>
            </div>
          </button>
        </div>
      </article>
    </div>
  );
}
