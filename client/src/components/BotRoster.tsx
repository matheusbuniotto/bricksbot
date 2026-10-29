import { Select } from './Select';
import {
  ArchiveRestore,
  Copy,
  EyeOff,
  FolderInput,
  MoreHorizontal,
  Moon,
  Pencil,
  Plus,
  Search,
  Sun,
  Trash2,
  Palette,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Bot, Space } from '../../../shared/chat/types';
import type { Theme } from '../lib/theme';
import { BOT_COLORS, BOT_SHAPES, BotFace, botColor, botLook, encodeLook } from './BotFace';

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

type MenuState =
  | { kind: 'bot'; botId: string; x: number; y: number }
  | { kind: 'move'; botId: string; x: number; y: number }
  | null;

function LookPicker({
  shape,
  color,
  onShape,
  onColor,
}: {
  shape: number;
  color: number;
  onShape: (index: number) => void;
  onColor: (index: number) => void;
}) {
  return (
    <>
      <div className="bot-creator-preview">
        <BotFace key={`${shape}-${color}`} color={BOT_COLORS[color].value} size={120} shape={shape} entering />
      </div>
      <div className="bot-shape-grid" role="radiogroup" aria-label="Bot shape">
        {BOT_SHAPES.map((spec, index) => (
          <button
            key={spec.id}
            type="button"
            role="radio"
            aria-checked={index === shape}
            aria-label={spec.id}
            className="bot-pick"
            onClick={() => onShape(index)}
          >
            <BotFace color={BOT_COLORS[color].value} size={44} shape={index} />
          </button>
        ))}
      </div>
      <div className="bot-color-grid" role="radiogroup" aria-label="Bot color">
        {BOT_COLORS.map((c, index) => (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={index === color}
            aria-label={c.label}
            className="bot-swatch"
            style={{ background: c.value }}
            onClick={() => onColor(index)}
          />
        ))}
      </div>
    </>
  );
}

type DragPayload = { botId: string };

function readDragPayload(event: React.DragEvent): DragPayload | null {
  try {
    const raw = event.dataTransfer.getData('application/x-bricksbot-bot');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DragPayload;
    return typeof parsed.botId === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

export function BotRoster({
  spaces,
  bots,
  archivedBots,
  previews,
  selectedBotId,
  createOpen,
  theme,
  onThemeChange,
  onCreateOpenChange,
  onSelectBot,
  onCreateBot,
  onCreateSpace,
  onRenameBot,
  onChangeLook,
  onMoveBot,
  onArchiveBot,
  onUnarchiveBot,
  onDeleteBot,
}: {
  spaces: Space[];
  bots: Bot[];
  archivedBots: Bot[];
  previews: Record<string, string>;
  selectedBotId: string | null;
  createOpen: boolean;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  onCreateOpenChange: (open: boolean) => void;
  onSelectBot: (botId: string) => void | Promise<void>;
  onCreateBot: (name: string, spaceId: string, avatarLabel?: string) => void | Promise<void>;
  onCreateSpace: (name: string) => void | Promise<string | void>;
  onRenameBot: (botId: string, name: string) => void | Promise<void>;
  onChangeLook: (botId: string, avatarLabel: string) => void | Promise<void>;
  onMoveBot: (botId: string, spaceId: string | null, index: number) => void | Promise<void>;
  onArchiveBot: (botId: string) => void | Promise<void>;
  onUnarchiveBot: (botId: string) => void | Promise<void>;
  onDeleteBot: (botId: string) => void | Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [namingSection, setNamingSection] = useState(false);
  const [sectionName, setSectionName] = useState('');
  const [botName, setBotName] = useState('');
  const [editLook, setEditLook] = useState<{ botId: string; shape: number; color: number } | null>(null);
  const [lookShape, setLookShape] = useState(1);
  const [lookColor, setLookColor] = useState(6);
  const [botSpaceId, setBotSpaceId] = useState<string>('');
  const [menu, setMenu] = useState<MenuState>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [pendingDropBotId, setPendingDropBotId] = useState<string | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const renameRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const primary = bots.find((bot) => bot.isPrimary) ?? null;
  const needle = query.trim().toLowerCase();

  const sections = useMemo(() => {
    const grouped = spaces.map((space) => ({
      id: space.id,
      name: space.name,
      bots: bots.filter((bot) => bot.spaceId === space.id && !bot.isPrimary),
    }));
    const unsectioned = bots.filter((bot) => bot.spaceId == null && !bot.isPrimary);
    grouped.push({ id: '__none', name: 'No section', bots: unsectioned });
    if (!needle) return grouped;
    return grouped
      .map((section) => ({
        ...section,
        bots: section.bots.filter((bot) => {
          const preview = previews[bot.id] ?? '';
          return bot.name.toLowerCase().includes(needle) || preview.toLowerCase().includes(needle);
        }),
      }))
      .filter((section) => section.bots.length > 0 || section.id !== '__none');
  }, [bots, needle, previews, spaces]);

  const archivedVisible = useMemo(() => {
    if (!needle) return archivedBots;
    return archivedBots.filter((bot) => {
      const preview = previews[bot.id] ?? '';
      return bot.name.toLowerCase().includes(needle) || preview.toLowerCase().includes(needle);
    });
  }, [archivedBots, needle, previews]);

  const primaryVisible =
    primary != null &&
    (!needle ||
      primary.name.toLowerCase().includes(needle) ||
      (previews[primary.id] ?? '').toLowerCase().includes(needle));

  const defaultSpaceId = bots.find((bot) => bot.id === selectedBotId)?.spaceId ?? spaces[0]?.id ?? '';

  useEffect(() => {
    if (renamingId) renameRef.current?.focus();
  }, [renamingId]);

  useEffect(() => {
    if (!menu) return;
    function onPointerDown(event: MouseEvent) {
      if (menuRef.current?.contains(event.target as Node)) return;
      setMenu(null);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenu(null);
    }
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  function openCreate() {
    setBotName('');
    setBotSpaceId(defaultSpaceId);
    onCreateOpenChange(true);
  }

  function openBotMenu(botId: string, event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ kind: 'bot', botId, x: event.clientX, y: event.clientY });
  }

  function startRename(bot: Bot) {
    setMenu(null);
    setRenamingId(bot.id);
    setRenameValue(bot.name);
  }

  async function commitRename() {
    if (!renamingId) return;
    const name = renameValue.trim();
    const current = [...bots, ...archivedBots].find((bot) => bot.id === renamingId);
    setRenamingId(null);
    if (!name || !current || name === current.name) return;
    await onRenameBot(renamingId, name);
  }

  function spaceIdFromSection(sectionId: string): string | null {
    return sectionId === '__none' || sectionId === '__new' ? null : sectionId;
  }

  async function handleDropOnSection(sectionId: string, index: number, event: React.DragEvent) {
    event.preventDefault();
    setDropTarget(null);
    const payload = readDragPayload(event);
    if (!payload) return;
    if (sectionId === '__new') {
      setPendingDropBotId(payload.botId);
      setNamingSection(true);
      setSectionName('');
      return;
    }
    await onMoveBot(payload.botId, spaceIdFromSection(sectionId), index);
  }

  async function createSectionFromForm() {
    const name = sectionName.trim();
    if (!name) return;
    const spaceId = await onCreateSpace(name);
    setSectionName('');
    setNamingSection(false);
    if (pendingDropBotId && typeof spaceId === 'string') {
      await onMoveBot(pendingDropBotId, spaceId, 0);
    }
    setPendingDropBotId(null);
  }

  const menuBot =
    menu && (menu.kind === 'bot' || menu.kind === 'move')
      ? [...bots, ...archivedBots].find((bot) => bot.id === menu.botId) ?? null
      : null;

  return (
    <aside className="roster" aria-label="Bots">
      <div className="roster-tools">
        <button
          type="button"
          className="theme-switch"
          role="switch"
          aria-checked={theme === 'light'}
          aria-label={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
          title={theme === 'light' ? 'Light theme' : 'Dark theme'}
          onClick={() => onThemeChange(theme === 'light' ? 'dark' : 'light')}
        >
          {theme === 'light' ? <Sun size={18} strokeWidth={1.75} /> : <Moon size={18} strokeWidth={1.75} />}
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Search"
          aria-pressed={searchOpen}
          onClick={() => setSearchOpen((open) => !open)}
        >
          <Search size={18} strokeWidth={1.75} />
        </button>
        <button type="button" className="icon-button" aria-label="New bot" onClick={openCreate}>
          <Plus size={18} strokeWidth={1.75} />
        </button>
      </div>

      {searchOpen ? (
        <input
          className="roster-search"
          autoFocus
          value={query}
          placeholder="Search"
          aria-label="Search"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setQuery('');
              setSearchOpen(false);
            }
          }}
        />
      ) : null}

      {primaryVisible && primary ? (
        <button
          type="button"
          className="roster-primary"
          aria-current={primary.id === selectedBotId ? 'true' : undefined}
          onClick={() => void onSelectBot(primary.id)}
          onContextMenu={(event) => openBotMenu(primary.id, event)}
        >
          <BotFace color={botColor(primary.id, true)} size={68} botId={primary.id} thinking={primary.presence === 'thinking' || primary.presence === 'working'} />
          <span>{primary.name}</span>
        </button>
      ) : null}

      <div className="roster-scroll">
        {!needle ? (
          namingSection ? (
            <form
              className="roster-section-form"
              onSubmit={(event) => {
                event.preventDefault();
                void createSectionFromForm();
              }}
            >
              <input
                autoFocus
                value={sectionName}
                placeholder="Section name"
                aria-label="Section name"
                onChange={(event) => setSectionName(event.target.value)}
              />
              <button type="submit">Create</button>
              <button
                type="button"
                aria-label="Cancel"
                onClick={() => {
                  setNamingSection(false);
                  setSectionName('');
                  setPendingDropBotId(null);
                }}
              >
                <X size={14} />
              </button>
            </form>
          ) : (
            <button
              type="button"
              className={
                dropTarget === '__new' ? 'roster-section-add is-drop-target' : 'roster-section-add'
              }
              onClick={() => setNamingSection(true)}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setDropTarget('__new');
              }}
              onDragLeave={() => setDropTarget((prev) => (prev === '__new' ? null : prev))}
              onDrop={(event) => void handleDropOnSection('__new', 0, event)}
            >
              <span>New section</span>
              <span>Drag Bots here</span>
            </button>
          )
        ) : null}

        {sections.map((section) => {
          const isCollapsed = collapsed[section.id] === true && !needle;
          const hideEmptyUnsectioned = section.id === '__none' && section.bots.length === 0 && !needle;
          if (hideEmptyUnsectioned) return null;
          return (
            <section
              key={section.id}
              className={
                dropTarget === section.id ? 'roster-section is-drop-target' : 'roster-section'
              }
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setDropTarget(section.id);
              }}
              onDragLeave={() => setDropTarget((prev) => (prev === section.id ? null : prev))}
              onDrop={(event) => void handleDropOnSection(section.id, section.bots.length, event)}
            >
              <button
                type="button"
                className="roster-section-name"
                aria-expanded={!isCollapsed}
                onClick={() => setCollapsed((prev) => ({ ...prev, [section.id]: !prev[section.id] }))}
              >
                {section.name}
              </button>
              {isCollapsed ? null : section.bots.length === 0 ? (
                <p className="roster-section-empty">No bots</p>
              ) : (
                section.bots.map((bot, index) => {
                  const selected = bot.id === selectedBotId;
                  const live = bot.presence === 'thinking' || bot.presence === 'working';
                  const preview = live ? 'Thinking…' : oneLine(previews[bot.id] ?? '');
                  const isRenaming = renamingId === bot.id;
                  return (
                    <div
                      key={bot.id}
                      className={
                        dropTarget === `${section.id}:${index}`
                          ? 'roster-bot-row is-drop-target'
                          : 'roster-bot-row'
                      }
                      draggable={!isRenaming}
                      onDragStart={(event) => {
                        event.dataTransfer.setData(
                          'application/x-bricksbot-bot',
                          JSON.stringify({ botId: bot.id } satisfies DragPayload),
                        );
                        event.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragEnd={() => setDropTarget(null)}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        event.dataTransfer.dropEffect = 'move';
                        setDropTarget(`${section.id}:${index}`);
                      }}
                      onDrop={(event) => {
                        event.stopPropagation();
                        void handleDropOnSection(section.id, index, event);
                      }}
                    >
                      {isRenaming ? (
                        <form
                          className="roster-bot is-renaming"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void commitRename();
                          }}
                        >
                          <BotFace color={botColor(bot.id, false)} size={44} botId={bot.id} thinking={bot.presence === 'thinking' || bot.presence === 'working'} />
                          <input
                            ref={renameRef}
                            value={renameValue}
                            aria-label="Rename bot"
                            onChange={(event) => setRenameValue(event.target.value)}
                            onBlur={() => void commitRename()}
                            onKeyDown={(event) => {
                              if (event.key === 'Escape') {
                                setRenamingId(null);
                              }
                            }}
                          />
                        </form>
                      ) : (
                        <button
                          type="button"
                          className={selected ? 'roster-bot is-selected' : 'roster-bot'}
                          aria-current={selected ? 'true' : undefined}
                          onClick={() => void onSelectBot(bot.id)}
                          onDoubleClick={() => startRename(bot)}
                          onContextMenu={(event) => openBotMenu(bot.id, event)}
                        >
                          <BotFace color={botColor(bot.id, false)} size={44} botId={bot.id} thinking={bot.presence === 'thinking' || bot.presence === 'working'} />
                          <span className="roster-bot-copy">
                            <span className="roster-bot-name">{bot.name}</span>
                            <span className="roster-bot-preview">{preview || 'No messages'}</span>
                          </span>
                          <span
                            className="roster-bot-more"
                            onClick={(event) => openBotMenu(bot.id, event)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                openBotMenu(bot.id, event as unknown as React.MouseEvent);
                              }
                            }}
                            role="button"
                            tabIndex={0}
                            aria-label={`Actions for ${bot.name}`}
                          >
                            <MoreHorizontal size={16} />
                          </span>
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </section>
          );
        })}

        {archivedVisible.length > 0 || archivedBots.length > 0 ? (
          <section className="roster-section roster-archived">
            <button
              type="button"
              className="roster-section-name"
              aria-expanded={archivedOpen}
              onClick={() => setArchivedOpen((open) => !open)}
            >
              Archived{archivedBots.length > 0 ? ` (${archivedBots.length})` : ''}
            </button>
            {archivedOpen
              ? archivedVisible.map((bot) => {
                  const selected = bot.id === selectedBotId;
                  const preview = oneLine(previews[bot.id] ?? '');
                  return (
                    <button
                      key={bot.id}
                      type="button"
                      className={selected ? 'roster-bot is-selected is-archived' : 'roster-bot is-archived'}
                      aria-current={selected ? 'true' : undefined}
                      onClick={() => void onSelectBot(bot.id)}
                      onContextMenu={(event) => openBotMenu(bot.id, event)}
                    >
                      <BotFace color={botColor(bot.id, false)} size={44} botId={bot.id} thinking={bot.presence === 'thinking' || bot.presence === 'working'} />
                      <span className="roster-bot-copy">
                        <span className="roster-bot-name">{bot.name}</span>
                        <span className="roster-bot-preview">{preview || 'Archived'}</span>
                      </span>
                    </button>
                  );
                })
              : null}
          </section>
        ) : null}
      </div>

      {menu && menuBot ? (
        <div
          ref={menuRef}
          className="roster-menu"
          style={{ left: Math.min(menu.x, window.innerWidth - 240), top: Math.min(menu.y, window.innerHeight - 280) }}
          role="menu"
        >
          {menu.kind === 'move' ? (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(null);
                  setPendingDropBotId(menuBot.id);
                  setNamingSection(true);
                }}
              >
                <FolderInput size={16} /> New section…
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(null);
                  void onMoveBot(menuBot.id, null, 0);
                }}
              >
                <FolderInput size={16} /> No section
              </button>
              <div className="roster-menu-sep" />
              {spaces.map((space) => (
                <button
                  key={space.id}
                  type="button"
                  role="menuitem"
                  disabled={menuBot.spaceId === space.id}
                  onClick={() => {
                    setMenu(null);
                    void onMoveBot(menuBot.id, space.id, 0);
                  }}
                >
                  <FolderInput size={16} /> {space.name}
                </button>
              ))}
            </>
          ) : menuBot.archivedAt ? (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(null);
                  void onUnarchiveBot(menuBot.id);
                }}
              >
                <ArchiveRestore size={16} /> Show in sidebar
              </button>
              <button type="button" role="menuitem" onClick={() => startRename(menuBot)}>
                <Pencil size={16} /> Rename Bot
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  const look = botLook(menuBot.id, menuBot.isPrimary);
                  setEditLook({ botId: menuBot.id, shape: look.shape, color: look.color });
                  setMenu(null);
                }}
              >
                <Palette size={16} /> Change look
              </button>
              <div className="roster-menu-sep" />
              <button
                type="button"
                role="menuitem"
                className="is-danger"
                onClick={() => {
                  setMenu(null);
                  if (window.confirm(`Delete ${menuBot.name}? This cannot be undone.`)) {
                    void onDeleteBot(menuBot.id);
                  }
                }}
              >
                <Trash2 size={16} /> Delete
              </button>
            </>
          ) : (
            <>
              {!menuBot.isPrimary ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => setMenu({ kind: 'move', botId: menuBot.id, x: menu.x, y: menu.y })}
                >
                  <FolderInput size={16} /> Move to
                </button>
              ) : null}
              <button type="button" role="menuitem" onClick={() => startRename(menuBot)}>
                <Pencil size={16} /> Rename Bot
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  void navigator.clipboard?.writeText(menuBot.id);
                  setMenu(null);
                }}
              >
                <Copy size={16} /> Copy Bot ID
              </button>
              {!menuBot.isPrimary ? (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenu(null);
                      void onArchiveBot(menuBot.id);
                    }}
                  >
                    <EyeOff size={16} /> Hide from sidebar
                  </button>
                  <div className="roster-menu-sep" />
                  <button
                    type="button"
                    role="menuitem"
                    className="is-danger"
                    onClick={() => {
                      setMenu(null);
                      if (window.confirm(`Delete ${menuBot.name}? This cannot be undone.`)) {
                        void onDeleteBot(menuBot.id);
                      }
                    }}
                  >
                    <Trash2 size={16} /> Delete
                  </button>
                </>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {createOpen ? (
        <div className="dialog-backdrop" role="presentation" onClick={() => onCreateOpenChange(false)}>
          <form
            className="dialog"
            role="dialog"
            aria-labelledby="create-bot-title"
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              const name = botName.trim();
              const spaceId = botSpaceId || defaultSpaceId;
              if (!name || !spaceId) return;
              void onCreateBot(name, spaceId, encodeLook({ shape: lookShape, color: lookColor }));
              onCreateOpenChange(false);
            }}
          >
            <h2 id="create-bot-title">Create new Bot</h2>
            <LookPicker shape={lookShape} color={lookColor} onShape={setLookShape} onColor={setLookColor} />
            <input
              autoFocus
              value={botName}
              placeholder="Name your Bot"
              aria-label="Name your Bot"
              onChange={(event) => setBotName(event.target.value)}
            />
            {spaces.length > 1 ? (
              <div className="dialog-field">
                Section
                <Select
                  value={botSpaceId || defaultSpaceId}
                  onChange={setBotSpaceId}
                  options={spaces.map((space) => ({ value: space.id, label: space.name }))}
                />
              </div>
            ) : null}
            {spaces.length === 0 ? <p className="dialog-note">Create a section before adding a bot.</p> : null}
            <div className="dialog-actions">
              <button type="button" onClick={() => onCreateOpenChange(false)}>
                Cancel
              </button>
              <button type="submit" className="dialog-primary" disabled={!botName.trim() || spaces.length === 0}>
                Create
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {editLook ? (
        <div className="dialog-backdrop" role="presentation" onClick={() => setEditLook(null)}>
          <div className="dialog" role="dialog" aria-label="Change look" onClick={(event) => event.stopPropagation()}>
            <h2>Change look</h2>
            <LookPicker
              shape={editLook.shape}
              color={editLook.color}
              onShape={(shape) => setEditLook({ ...editLook, shape })}
              onColor={(color) => setEditLook({ ...editLook, color })}
            />
            <div className="dialog-actions">
              <button type="button" onClick={() => setEditLook(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="dialog-primary"
                onClick={() => {
                  void onChangeLook(editLook.botId, encodeLook(editLook));
                  setEditLook(null);
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}

    </aside>
  );
}
