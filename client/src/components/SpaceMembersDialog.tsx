import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Users, X } from 'lucide-react';
import type { Space, SpaceMember, SpaceRole, WorkspaceUser } from '../../../shared/chat/types';
import { addSpaceMember, fetchSpaceMembers, removeSpaceMember, searchWorkspaceUsers } from '../lib/chat-api';
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
  onLeft,
}: {
  space: Space | null;
  isOpen: boolean;
  onClose: () => void;
  /** Called after the caller leaves the space, so the roster can drop it. */
  onLeft?: (spaceId: string) => void | Promise<void>;
}) {
  const [members, setMembers] = useState<SpaceMember[]>([]);
  /** null = not loaded yet (do not show invite vs deny). */
  const [canManage, setCanManage] = useState<boolean | null>(null);
  const [callerId, setCallerId] = useState<string | null>(null);
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<SpaceRole>('member');
  const [submitting, setSubmitting] = useState(false);

  const [suggestions, setSuggestions] = useState<WorkspaceUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const selectedUserRef = useRef<string | null>(null);
  const dropdownOpenRef = useRef(dropdownOpen);
  dropdownOpenRef.current = dropdownOpen;

  const load = useCallback(async () => {
    if (!space) return;
    setLoading(true);
    setCanManage(null);
    setError(null);
    try {
      const data = await fetchSpaceMembers(space.id);
      setMembers(data.members);
      setCanManage(data.canManage);
      setCallerId(data.callerId);
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
      if (event.key === 'Escape') {
        if (dropdownOpenRef.current) {
          setDropdownOpen(false);
          return;
        }
        onClose();
      }
    }
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      // Synchronously enter loading before paint so we never flash the deny copy.
      setLoading(true);
      setCanManage(null);
      setMembers([]);
      setSuggestions([]);
      setDropdownOpen(false);
      void load();
    } else {
      setLoading(false);
      setCanManage(null);
      setMembers([]);
      setError(null);
      setSuggestions([]);
      setDropdownOpen(false);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, load]);

  useEffect(() => {
    if (!isOpen || !space || !canManage) {
      setSuggestions([]);
      setDropdownOpen(false);
      return;
    }
    const trimmed = userId.trim();
    if (trimmed.length < 2 || selectedUserRef.current === trimmed.toLowerCase()) {
      setSuggestions([]);
      setDropdownOpen(false);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void (async () => {
        setSearching(true);
        try {
          const results = await searchWorkspaceUsers(space.id, trimmed, controller.signal);
          setSuggestions(results);
          setActiveIndex(results.length > 0 ? 0 : -1);
          setDropdownOpen(results.length > 0);
        } catch {
          if (!controller.signal.aborted) {
            setSuggestions([]);
            setDropdownOpen(false);
          }
        } finally {
          if (!controller.signal.aborted) {
            setSearching(false);
          }
        }
      })();
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [userId, isOpen, space, canManage]);

  function selectSuggestion(user: WorkspaceUser) {
    selectedUserRef.current = user.userName.toLowerCase();
    setUserId(user.userName);
    setSuggestions([]);
    setDropdownOpen(false);
    setActiveIndex(-1);
  }

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape' && dropdownOpen) {
      event.preventDefault();
      setDropdownOpen(false);
      return;
    }
    if (!dropdownOpen || suggestions.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1));
    } else if (event.key === 'Enter') {
      if (activeIndex >= 0 && activeIndex < suggestions.length) {
        event.preventDefault();
        selectSuggestion(suggestions[activeIndex]);
      }
    }
  }

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
      setSuggestions([]);
      setDropdownOpen(false);
      setActiveIndex(-1);
      selectedUserRef.current = null;
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to add member');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemove(member: SpaceMember) {
    if (!space) return;
    const isLeaving = member.userId === callerId;
    const prompt = isLeaving
      ? `Leave ${space.name}? You will lose access to its shared bots.`
      : `Remove ${member.userId} from ${space.name}?`;
    if (!window.confirm(prompt)) return;
    setRemovingUserId(member.userId);
    setError(null);
    try {
      await removeSpaceMember(space.id, member.userId);
      if (isLeaving) {
        onClose();
        await onLeft?.(space.id);
        return;
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to remove member');
    } finally {
      setRemovingUserId(null);
    }
  }

  function removeLabel(member: SpaceMember): string | null {
    if (!space || member.userId === space.ownerId) return null;
    if (member.userId === callerId) return 'Leave';
    return canManage ? 'Remove' : null;
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
              members.map((member) => {
                const action = removeLabel(member);
                return (
                  <li key={`${member.spaceId}:${member.userId}`} className="space-members-row">
                    <span className="space-members-user">{member.userId}</span>
                    <span className="space-members-role">{roleLabel(member.role)}</span>
                    {member.userId === space.ownerId ? <span className="space-members-owner">Owner</span> : null}
                    {action ? (
                      <button
                        type="button"
                        className="space-members-remove"
                        disabled={removingUserId !== null}
                        onClick={() => void handleRemove(member)}
                      >
                        {removingUserId === member.userId ? '…' : action}
                      </button>
                    ) : null}
                  </li>
                );
              })
            )}
          </ul>
        )}

        {loading || canManage === null ? null : canManage ? (
          <form className="space-members-form" onSubmit={(event) => void handleAdd(event)}>
            <div className="dialog-field space-members-autocomplete">
              <label htmlFor="space-member-email">User email</label>
              <div className="space-members-input-wrap">
                <input
                  id="space-member-email"
                  type="email"
                  autoComplete="off"
                  placeholder="teammate@company.com"
                  value={userId}
                  onChange={(event) => {
                    selectedUserRef.current = null;
                    setUserId(event.target.value);
                  }}
                  onKeyDown={handleInputKeyDown}
                  onFocus={() => {
                    if (suggestions.length > 0 && selectedUserRef.current !== userId.trim().toLowerCase()) {
                      setDropdownOpen(true);
                    }
                  }}
                  required
                />
                {searching ? <span className="space-members-searching">Searching…</span> : null}
              </div>
              {dropdownOpen && suggestions.length > 0 ? (
                <ul className="space-members-suggestions" role="listbox" aria-label="Suggested workspace users">
                  {suggestions.map((suggestion, index) => {
                    const isActive = index === activeIndex;
                    return (
                      <li
                        key={suggestion.id}
                        role="option"
                        aria-selected={isActive}
                        className={`space-members-suggestion ${isActive ? 'is-active' : ''}`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          selectSuggestion(suggestion);
                        }}
                        onMouseEnter={() => setActiveIndex(index)}
                      >
                        <span className="space-members-suggestion-name">{suggestion.displayName}</span>
                        <span className="space-members-suggestion-email">{suggestion.userName}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
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
