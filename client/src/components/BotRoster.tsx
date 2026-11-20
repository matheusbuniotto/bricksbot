import { Select } from './Select';
import {
  ArchiveRestore,
  ChevronRight,
  Copy,
  EyeOff,
  FolderInput,
  Gauge,
  Grid2x2Plus,
  MoreHorizontal,
  Moon,
  Pencil,
  Plus,
  Search,
  Share2,
  Store,
  Sun,
  Trash2,
  Palette,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Bot, MarketplaceBot, Space } from '../../../shared/chat/types';
import type { Theme } from '../lib/theme';
import { presenceTooltip, rosterPreviewForPresence } from '../lib/user-facing';
import { ConnectorsDialog } from './ConnectorsDialog';
import { UsageDialog } from './UsagePanel';
import { SpaceMembersDialog } from './SpaceMembersDialog';
import { BotFace, botColor, botLook, decodeLook, encodeLook, COLORS, DEFAULT_BOT, type BotConfig } from './BotFace';
import { BotPicker } from './BotPicker';

type MenuState =
  | { kind: 'bot'; botId: string; x: number; y: number }
  | { kind: 'move'; botId: string; x: number; y: number }
  | null;

const NO_SECTION = '__none';

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
  archivedBots = [],
  marketplaceBots = [],
  previews = {},
  selectedBotId,
  createOpen,
  marketplaceOpen = false,
  connectorsOpen: connectorsOpenControlled,
  theme,
  onThemeChange,
  onCreateOpenChange,
  onMarketplaceOpenChange,
  onConnectorsOpenChange,
  onSelectBot,
  onCreateBot,
  onInstallMarketplaceBot,
  onToggleShareBot,
  onLeaveSpace,
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
  marketplaceBots?: MarketplaceBot[];
  previews: Record<string, string>;
  selectedBotId: string | null;
  createOpen: boolean;
  marketplaceOpen?: boolean;
  /** Controlled connectors dialog; falls back to local state when omitted. */
  connectorsOpen?: boolean;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  onCreateOpenChange: (open: boolean) => void;
  onMarketplaceOpenChange?: (open: boolean) => void;
  onConnectorsOpenChange?: (open: boolean) => void;
  onSelectBot: (botId: string) => void | Promise<void>;
  onCreateBot: (
    name: string,
    spaceId: string | null,
    avatarLabel?: string,
    description?: string
  ) => void | Promise<void>;
  onInstallMarketplaceBot?: (botId: string, spaceId: string | null) => void | Promise<void>;
  onToggleShareBot?: (botId: string, isShared: boolean) => void | Promise<void>;
  onLeaveSpace?: (spaceId: string) => void | Promise<void>;
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
  const [botDescription, setBotDescription] = useState('');
  const [editLook, setEditLook] = useState<{ botId: string; config: BotConfig } | null>(null);
  const [lookConfig, setLookConfig] = useState<BotConfig>(() => ({ ...DEFAULT_BOT }));
  const [botSpaceId, setBotSpaceId] = useState<string>('');
  const [menu, setMenu] = useState<MenuState>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [membersSpaceId, setMembersSpaceId] = useState<string | null>(null);
  const membersSpace = membersSpaceId ? (spaces.find((space) => space.id === membersSpaceId) ?? null) : null;
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [pendingDropBotId, setPendingDropBotId] = useState<string | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [connectorsOpenLocal, setConnectorsOpenLocal] = useState(false);
  const connectorsOpen = connectorsOpenControlled ?? connectorsOpenLocal;
  const setConnectorsOpen = onConnectorsOpenChange ?? setConnectorsOpenLocal;
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

  const defaultSpaceId = bots.find((bot) => bot.id === selectedBotId)?.spaceId ?? spaces[0]?.id ?? NO_SECTION;

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
    setBotDescription('');
    setLookConfig({ ...DEFAULT_BOT });
    setBotSpaceId(defaultSpaceId);
    onCreateOpenChange(true);
  }

  function openChangeLook(bot: Bot) {
    setEditLook({ botId: bot.id, config: { ...botLook(bot.id, bot.isPrimary) } });
    setMenu(null);
  }

  function openBotMenu(botId: string, event: React.MouseEvent | React.KeyboardEvent) {
    event.preventDefault();
    event.stopPropagation();
    let x = 0;
    let y = 0;
    if ('clientX' in event && typeof event.clientX === 'number') {
      x = event.clientX;
      y = event.clientY;
    } else if (event.currentTarget instanceof HTMLElement) {
      const rect = event.currentTarget.getBoundingClientRect();
      x = rect.left;
      y = rect.bottom;
    }
    setMenu({ kind: 'bot', botId, x, y });
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
      ? ([...bots, ...archivedBots].find((bot) => bot.id === menu.botId) ?? null)
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
        {onMarketplaceOpenChange ? (
          <button
            type="button"
            className="icon-button"
            aria-label="Marketplace"
            title="Bot Marketplace"
            aria-pressed={marketplaceOpen}
            onClick={() => onMarketplaceOpenChange(true)}
          >
            <Store size={18} strokeWidth={1.75} />
          </button>
        ) : null}
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
        renamingId === primary.id ? (
          <form
            className="roster-primary is-renaming"
            onSubmit={(event) => {
              event.preventDefault();
              void commitRename();
            }}
          >
            <BotFace color={botColor(primary.id, true)} size={64} botId={primary.id} />
            <input
              ref={renameRef}
              value={renameValue}
              aria-label="Rename bot"
              onChange={(event) => setRenameValue(event.target.value)}
              onBlur={() => void commitRename()}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setRenamingId(null);
              }}
            />
          </form>
        ) : (
          <button
            type="button"
            className="roster-primary"
            aria-current={primary.id === selectedBotId ? 'true' : undefined}
            onClick={() => void onSelectBot(primary.id)}
            onContextMenu={(event) => openBotMenu(primary.id, event)}
          >
            <BotFace
              color={botColor(primary.id, true)}
              size={64}
              botId={primary.id}
              presence={primary.presence}
              title={presenceTooltip(primary.presence)}
            />
            <span>{primary.name}</span>
          </button>
        )
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
              className={dropTarget === '__new' ? 'roster-section-add is-drop-target' : 'roster-section-add'}
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
          return (
            <section
              key={section.id}
              className={dropTarget === section.id ? 'roster-section is-drop-target' : 'roster-section'}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setDropTarget(section.id);
              }}
              onDragLeave={() => setDropTarget((prev) => (prev === section.id ? null : prev))}
              onDrop={(event) => void handleDropOnSection(section.id, section.bots.length, event)}
            >
              <div className="roster-section-heading">
                <button
                  type="button"
                  className="roster-section-name"
                  aria-expanded={!isCollapsed}
                  onClick={() => setCollapsed((prev) => ({ ...prev, [section.id]: !prev[section.id] }))}
                >
                  <ChevronRight className="roster-section-chevron" size={14} strokeWidth={2} aria-hidden="true" />
                  <span className="roster-section-label">{section.name}</span>
                  {isCollapsed ? <span className="roster-section-count">{section.bots.length}</span> : null}
                </button>
                {section.id !== '__none' ? (
                  <button
                    type="button"
                    className="roster-section-share"
                    aria-label={`Share ${section.name}`}
                    title="Space members"
                    onClick={(event) => {
                      event.stopPropagation();
                      setMembersSpaceId(section.id);
                    }}
                  >
                    <Users size={14} strokeWidth={2} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
              {isCollapsed ? null : (
                <>
                  {createOpen && (botSpaceId || defaultSpaceId) === section.id ? (
                    <div className="roster-bot-row is-creating-highlight" aria-hidden="true">
                      <div className="roster-bot">
                        <BotFace config={lookConfig} size={34} />
                        <span className="roster-bot-copy">
                          <span className="roster-bot-name">{botName.trim() || 'New Bot'}</span>
                          <span className="roster-bot-preview">Creating…</span>
                        </span>
                      </div>
                    </div>
                  ) : null}
                  {section.bots.length === 0 && !(createOpen && (botSpaceId || defaultSpaceId) === section.id) ? (
                    <p className="roster-section-empty">No bots</p>
                  ) : null}
                  {section.bots.map((bot, index) => {
                    const selected = bot.id === selectedBotId;
                    const preview = rosterPreviewForPresence(bot.presence, previews?.[bot.id] ?? '');
                    const isRenaming = renamingId === bot.id;
                    return (
                      <div
                        key={bot.id}
                        className={
                          dropTarget === `${section.id}:${index}` ? 'roster-bot-row is-drop-target' : 'roster-bot-row'
                        }
                        draggable={!isRenaming}
                        onDragStart={(event) => {
                          event.dataTransfer.setData(
                            'application/x-bricksbot-bot',
                            JSON.stringify({ botId: bot.id } satisfies DragPayload)
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
                            <BotFace
                              color={botColor(bot.id, false)}
                              size={34}
                              botId={bot.id}
                              track={bot.id === selectedBotId}
                              presence={bot.presence}
                              title={presenceTooltip(bot.presence)}
                            />
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
                            <BotFace
                              color={botColor(bot.id, false)}
                              size={34}
                              botId={bot.id}
                              track={bot.id === selectedBotId}
                              presence={bot.presence}
                              title={presenceTooltip(bot.presence)}
                            />
                            <span className="roster-bot-copy">
                              <span className="roster-bot-name">
                                {bot.name}
                                {bot.isShared ? (
                                  <span className="roster-bot-shared-badge" title="Compartilhado no Marketplace">
                                    Shared
                                  </span>
                                ) : null}
                              </span>
                              <span className="roster-bot-preview">{preview || 'No messages'}</span>
                            </span>
                            <span
                              className="roster-bot-more"
                              onClick={(event) => openBotMenu(bot.id, event)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  openBotMenu(bot.id, event);
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
                  })}
                </>
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
                  const preview = rosterPreviewForPresence(bot.presence, previews[bot.id] ?? '');
                  return (
                    <button
                      key={bot.id}
                      type="button"
                      className={selected ? 'roster-bot is-selected is-archived' : 'roster-bot is-archived'}
                      aria-current={selected ? 'true' : undefined}
                      onClick={() => void onSelectBot(bot.id)}
                      onContextMenu={(event) => openBotMenu(bot.id, event)}
                    >
                      <BotFace
                        color={botColor(bot.id, false)}
                        size={34}
                        botId={bot.id}
                        track={bot.id === selectedBotId}
                        presence={bot.presence}
                        title={presenceTooltip(bot.presence)}
                      />
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

      <div className="roster-user-footer">
        <div className="roster-user-info">
          <div className="roster-user-avatar" aria-hidden="true">
            <span className="roster-user-initials">MB</span>
          </div>
          <span className="roster-user-name">Matheus Buniotto</span>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="roster-connectors-btn"
            aria-label="Usage and budgets"
            title="Usage and budgets"
            aria-haspopup="dialog"
            aria-expanded={usageOpen}
            onClick={() => setUsageOpen(true)}
          >
            <Gauge size={19} strokeWidth={1.9} />
          </button>
          <button
            type="button"
            className="roster-connectors-btn"
            aria-label="Connect apps"
            title="Connect apps"
            aria-haspopup="dialog"
            aria-expanded={connectorsOpen}
            onClick={() => setConnectorsOpen(true)}
          >
            <Grid2x2Plus size={19} strokeWidth={1.9} />
          </button>
        </div>
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
              <button type="button" role="menuitem" onClick={() => openChangeLook(menuBot)}>
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
              {!menuBot.isPrimary && onToggleShareBot ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    const nextShared = !menuBot.isShared;
                    setMenu(null);
                    void onToggleShareBot(menuBot.id, nextShared);
                  }}
                >
                  <Share2 size={16} /> {menuBot.isShared ? 'Remove from Marketplace' : 'Share in Marketplace'}
                </button>
              ) : null}
              <button type="button" role="menuitem" onClick={() => startRename(menuBot)}>
                <Pencil size={16} /> Rename Bot
              </button>
              <button type="button" role="menuitem" onClick={() => openChangeLook(menuBot)}>
                <Palette size={16} /> Change look
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
              const selected = botSpaceId || defaultSpaceId;
              if (!name) return;
              void onCreateBot(
                name,
                selected === NO_SECTION ? null : selected,
                encodeLook(lookConfig),
                botDescription.trim() || undefined
              );
              onCreateOpenChange(false);
            }}
          >
            <div className="dialog-header-row">
              <h2 id="create-bot-title">Create new Bot</h2>
              <button
                type="button"
                className="dialog-close-btn"
                aria-label="Close"
                onClick={() => onCreateOpenChange(false)}
              >
                <X size={18} />
              </button>
            </div>
            <BotPicker value={lookConfig} onChange={setLookConfig}>
              <input
                autoFocus
                value={botName}
                placeholder="Name your Bot"
                aria-label="Name your Bot"
                onChange={(event) => setBotName(event.target.value)}
              />
            </BotPicker>
            <div className="dialog-field">
              Bot instructions (optional)
              <textarea
                className="dialog-textarea"
                rows={2}
                value={botDescription}
                placeholder="Define the bot's role, rules, or persona"
                aria-label="Bot instructions"
                onChange={(event) => setBotDescription(event.target.value)}
              />
            </div>
            <div className="dialog-field">
              Section
              <Select
                value={botSpaceId || defaultSpaceId}
                onChange={setBotSpaceId}
                options={[
                  ...spaces.map((space) => ({ value: space.id, label: space.name })),
                  { value: NO_SECTION, label: 'No section' },
                ]}
              />
            </div>
            {onMarketplaceOpenChange ? (
              <button
                type="button"
                className="dialog-link-btn"
                onClick={() => {
                  onCreateOpenChange(false);
                  onMarketplaceOpenChange(true);
                }}
              >
                Explore Bot Marketplace →
              </button>
            ) : null}
            <div className="dialog-actions">
              <button type="button" onClick={() => onCreateOpenChange(false)}>
                Cancel
              </button>
              <button
                type="submit"
                className="dialog-primary"
                disabled={!botName.trim()}
                style={
                  botName.trim()
                    ? {
                        background: COLORS[lookConfig.color]?.[0] ?? COLORS[7][0],
                        color: '#fff',
                        borderColor: 'transparent',
                      }
                    : undefined
                }
              >
                Create
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {editLook ? (
        <div className="dialog-backdrop" role="presentation" onClick={() => setEditLook(null)}>
          <div className="dialog" role="dialog" aria-label="Change look" onClick={(event) => event.stopPropagation()}>
            <div className="dialog-header-row">
              <h2>Change look</h2>
              <button type="button" className="dialog-close-btn" aria-label="Close" onClick={() => setEditLook(null)}>
                <X size={18} />
              </button>
            </div>
            <BotPicker value={editLook.config} onChange={(config) => setEditLook({ ...editLook, config })} />
            <div className="dialog-actions">
              <button type="button" onClick={() => setEditLook(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="dialog-primary"
                style={{
                  background: COLORS[editLook.config.color]?.[0] ?? COLORS[7][0],
                  color: '#fff',
                  borderColor: 'transparent',
                }}
                onClick={() => {
                  void onChangeLook(editLook.botId, encodeLook(editLook.config));
                  setEditLook(null);
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {marketplaceOpen && onMarketplaceOpenChange ? (
        <div className="dialog-backdrop" role="presentation" onClick={() => onMarketplaceOpenChange(false)}>
          <div
            className="dialog marketplace-dialog"
            role="dialog"
            aria-labelledby="marketplace-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dialog-header-row">
              <h2 id="marketplace-dialog-title">Bot Marketplace</h2>
              <button
                type="button"
                className="dialog-close-btn"
                aria-label="Close"
                onClick={() => onMarketplaceOpenChange(false)}
              >
                <X size={18} />
              </button>
            </div>
            <p className="dialog-note">
              Bots are personal by default. When using a Marketplace Bot, you receive its behavior, instructions, and
              skills in a 100% private chat.
            </p>
            <div className="dialog-field">
              Add to section:
              <Select
                value={botSpaceId || defaultSpaceId}
                onChange={setBotSpaceId}
                options={[
                  ...spaces.map((space) => ({ value: space.id, label: space.name })),
                  { value: NO_SECTION, label: 'No section' },
                ]}
              />
            </div>
            <div className="marketplace-list">
              {marketplaceBots.length === 0 ? (
                <div className="marketplace-empty">
                  <p>No bots published to the Marketplace yet.</p>
                  <p className="marketplace-empty-sub">
                    Share one of your bots from the actions menu or details sheet to make it available to teammates.
                  </p>
                </div>
              ) : (
                marketplaceBots.map((mBot) => {
                  const mLook = decodeLook(mBot.avatarLabel) ?? { ...DEFAULT_BOT };
                  return (
                    <div key={mBot.id} className="marketplace-card">
                      <div className="marketplace-card-header">
                        <BotFace config={mLook} size={40} />
                        <div className="marketplace-card-info">
                          <span className="marketplace-card-name">{mBot.name}</span>
                          <span className="marketplace-card-owner">by {mBot.ownerId}</span>
                        </div>
                      </div>
                      <p className="marketplace-card-desc">{mBot.description || 'No additional description'}</p>
                      {mBot.skillNames.length > 0 ? (
                        <div className="marketplace-skills">
                          {mBot.skillNames.map((skill) => (
                            <span key={skill} className="marketplace-skill-chip">
                              {skill}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      <button
                        type="button"
                        className="marketplace-install-btn"
                        aria-label={`Use ${mBot.name}`}
                        onClick={() => {
                          const targetSpace =
                            (botSpaceId || defaultSpaceId) === NO_SECTION ? null : botSpaceId || defaultSpaceId;
                          if (onInstallMarketplaceBot) {
                            void onInstallMarketplaceBot(mBot.id, targetSpace);
                          }
                          onMarketplaceOpenChange(false);
                        }}
                      >
                        Use Bot
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      ) : null}

      <UsageDialog isOpen={usageOpen} onClose={() => setUsageOpen(false)} />

      <ConnectorsDialog
        isOpen={connectorsOpen}
        onClose={() => setConnectorsOpen(false)}
        onOpenMarketplace={() => onMarketplaceOpenChange?.(true)}
        botId={selectedBotId}
        botName={bots.find((bot) => bot.id === selectedBotId)?.name}
      />

      <SpaceMembersDialog
        space={membersSpace}
        isOpen={membersSpaceId !== null}
        onClose={() => setMembersSpaceId(null)}
        onLeft={onLeaveSpace}
      />
    </aside>
  );
}
