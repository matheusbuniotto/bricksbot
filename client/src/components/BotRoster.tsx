import { Moon, Plus, Search, Sun, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Bot, Space } from '../../../shared/chat/types';
import type { Theme } from '../lib/theme';
import { BotFace, botColor } from './BotFace';

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function BotRoster({
  spaces,
  bots,
  previews,
  selectedBotId,
  createOpen,
  theme,
  onThemeChange,
  onCreateOpenChange,
  onSelectBot,
  onCreateBot,
  onCreateSpace,
}: {
  spaces: Space[];
  bots: Bot[];
  previews: Record<string, string>;
  selectedBotId: string | null;
  createOpen: boolean;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  onCreateOpenChange: (open: boolean) => void;
  onSelectBot: (botId: string) => void | Promise<void>;
  onCreateBot: (name: string, spaceId: string) => void | Promise<void>;
  onCreateSpace: (name: string) => void | Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [namingSection, setNamingSection] = useState(false);
  const [sectionName, setSectionName] = useState('');
  const [botName, setBotName] = useState('');
  const [botSpaceId, setBotSpaceId] = useState<string>('');

  const primary = bots.find((bot) => bot.isPrimary) ?? null;
  const needle = query.trim().toLowerCase();

  const sections = useMemo(() => {
    const grouped = spaces.map((space) => ({
      id: space.id,
      name: space.name,
      bots: bots.filter((bot) => bot.spaceId === space.id && !bot.isPrimary),
    }));
    const unsectioned = bots.filter((bot) => bot.spaceId == null && !bot.isPrimary);
    if (unsectioned.length > 0) {
      grouped.push({ id: '__none', name: 'Unassigned', bots: unsectioned });
    }
    if (!needle) return grouped;
    return grouped
      .map((section) => ({
        ...section,
        bots: section.bots.filter((bot) => {
          const preview = previews[bot.id] ?? '';
          return bot.name.toLowerCase().includes(needle) || preview.toLowerCase().includes(needle);
        }),
      }))
      .filter((section) => section.bots.length > 0);
  }, [bots, needle, previews, spaces]);

  const primaryVisible =
    primary != null &&
    (!needle ||
      primary.name.toLowerCase().includes(needle) ||
      (previews[primary.id] ?? '').toLowerCase().includes(needle));

  const defaultSpaceId = bots.find((bot) => bot.id === selectedBotId)?.spaceId ?? spaces[0]?.id ?? '';

  function openCreate() {
    setBotName('');
    setBotSpaceId(defaultSpaceId);
    onCreateOpenChange(true);
  }

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
        >
          <BotFace color={botColor(primary.id, true)} size={68} />
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
                const name = sectionName.trim();
                if (!name) return;
                void onCreateSpace(name);
                setSectionName('');
                setNamingSection(false);
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
                }}
              >
                <X size={14} />
              </button>
            </form>
          ) : (
            <button type="button" className="roster-section-add" onClick={() => setNamingSection(true)}>
              <span>New section</span>
              <span>Organize Bots here</span>
            </button>
          )
        ) : null}

        {sections.map((section) => {
          const isCollapsed = collapsed[section.id] === true && !needle;
          return (
            <section key={section.id} className="roster-section">
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
                section.bots.map((bot) => {
                  const selected = bot.id === selectedBotId;
                  const live = bot.presence === 'thinking' || bot.presence === 'working';
                  const preview = live ? 'Thinking…' : oneLine(previews[bot.id] ?? '');
                  return (
                    <button
                      key={bot.id}
                      type="button"
                      className={selected ? 'roster-bot is-selected' : 'roster-bot'}
                      aria-current={selected ? 'true' : undefined}
                      onClick={() => void onSelectBot(bot.id)}
                    >
                      <BotFace color={botColor(bot.id, false)} size={44} />
                      <span className="roster-bot-copy">
                        <span className="roster-bot-name">{bot.name}</span>
                        <span className="roster-bot-preview">{preview || 'No messages'}</span>
                      </span>
                    </button>
                  );
                })
              )}
            </section>
          );
        })}
      </div>

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
              void onCreateBot(name, spaceId);
              onCreateOpenChange(false);
            }}
          >
            <h2 id="create-bot-title">Create new Bot</h2>
            <input
              autoFocus
              value={botName}
              placeholder="Name your Bot"
              aria-label="Name your Bot"
              onChange={(event) => setBotName(event.target.value)}
            />
            {spaces.length > 1 ? (
              <label className="dialog-field">
                Section
                <select value={botSpaceId || defaultSpaceId} onChange={(event) => setBotSpaceId(event.target.value)}>
                  {spaces.map((space) => (
                    <option key={space.id} value={space.id}>
                      {space.name}
                    </option>
                  ))}
                </select>
              </label>
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
    </aside>
  );
}
