import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Users, X } from 'lucide-react';
import type { Space, SpaceMember, SpaceRole } from '../../../shared/chat/types';
import { addSpaceMember, fetchSpaceMembers } from '../lib/chat-api';
import { Select } from './Select';

const ROLE_OPTIONS: Array<{ value: SpaceRole; label: string }> = [
  { value: 'viewer', label: 'Viewer — see shared bots' },
  { value: 'member', label: 'Member — use shared bots' },
  { value: 'admin', label: 'Admin — invite others' },
];

function roleLabel(role: SpaceRole): string {
  if (role === 'admin') return 'Admin';
  if (role === 'viewer') return 'Viewer';
  return 'Member';
}

export function SpaceMembersDialog({
  space,
  isOpen,
  onClose,
}: {
  space: Space | null;
  isOpen: boolean;
  onClose: () => void;
}) {
  const [members, setMembers] = useState<SpaceMember[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<SpaceRole>('member');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!space) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSpaceMembers(space.id);
      setMembers(data.members);
      setCanManage(data.canManage);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load members');
      setMembers([]);
      setCanManage(false);
    } finally {
      setLoading(false);
    }
  }, [space]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      void load();
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, load]);

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    if (!space || !canManage) return;
    const trimmed = userId.trim().toLowerCase();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      await addSpaceMember(space.id, trimmed, role);
      setUserId('');
      setRole('member');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to add member');
    } finally {
      setSubmitting(false);
    }
  }

  if (!isOpen || !space) return null;

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="dialog space-members-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="space-members-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-header-row">
          <h2 id="space-members-title">
            <Users size={18} aria-hidden /> Members — {space.name}
          </h2>
          <button type="button" className="dialog-close-btn" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <p className="dialog-note">
          Invite teammates by Databricks user email. Shared bots in this section become visible to members; Primary
          stays private.
        </p>

        {error ? <p className="chat-error">{error}</p> : null}

        {loading ? (
          <p className="dialog-note">Loading…</p>
        ) : (
          <ul className="space-members-list" aria-label="Space members">
            {members.length === 0 ? (
              <li className="space-members-empty">No members yet</li>
            ) : (
              members.map((member) => (
                <li key={`${member.spaceId}:${member.userId}`} className="space-members-row">
                  <span className="space-members-user">{member.userId}</span>
                  <span className="space-members-role">{roleLabel(member.role)}</span>
                  {member.userId === space.ownerId ? <span className="space-members-owner">Owner</span> : null}
                </li>
              ))
            )}
          </ul>
        )}

        {canManage ? (
          <form className="space-members-form" onSubmit={(event) => void handleAdd(event)}>
            <label className="dialog-field">
              User email
              <input
                type="email"
                autoComplete="off"
                placeholder="teammate@company.com"
                value={userId}
                onChange={(event) => setUserId(event.target.value)}
                required
              />
            </label>
            <label className="dialog-field">
              Role
              <Select
                value={role}
                onChange={(value) => setRole(value as SpaceRole)}
                options={ROLE_OPTIONS}
                ariaLabel="Member role"
              />
            </label>
            <div className="dialog-actions">
              <button type="submit" className="dialog-primary" disabled={submitting || !userId.trim()}>
                {submitting ? 'Adding…' : 'Add member'}
              </button>
            </div>
          </form>
        ) : (
          <p className="dialog-note">Only space owners and admins can invite people.</p>
        )}
      </div>
    </div>
  );
}
