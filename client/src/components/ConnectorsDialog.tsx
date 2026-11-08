import { useState, useEffect, useMemo, useCallback, type FormEvent, type ReactNode } from 'react';
import {
  X,
  Search,
  Check,
  ExternalLink,
  Sparkles,
  Flame,
  Globe,
  Terminal,
  MessageSquare,
  BookOpen,
  Layers,
  GitBranch,
  FileText,
  HardDrive,
  Mail,
  RotateCw,
  Plus,
  Trash2,
  Wand2,
} from 'lucide-react';
import {
  AVAILABLE_DATABRICKS_MCPS,
  BUILTIN_PLUGIN_MCPS,
  type DatabricksMcpApp,
} from '../../../shared/agents/mcp-types.js';
import type { BotSkill } from '../../../shared/agents/memory/types.js';
import { SKILL_PACK_CATALOG, type SkillPackCatalogEntry } from '../../../shared/agents/skill-packs.js';
import { deleteSkill, fetchSkills, importSkill, installSkillPack } from '../lib/memory-api.js';
import { connectMcp, disconnectMcp, fetchMcps, registerCustomMcp, removeCustomMcp } from '../lib/chat-api.js';

export type ConnectorApp = DatabricksMcpApp;

export const DEFAULT_VIABLE_MCPS: ConnectorApp[] = AVAILABLE_DATABRICKS_MCPS.filter((app) => app.isViable !== false);
export const CONNECTOR_APPS: ConnectorApp[] = DEFAULT_VIABLE_MCPS;

const STORAGE_KEY = 'bricksbot.connected_apps';

function readConnectedApps(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as string[];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function saveConnectedApps(set: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
  } catch {}
}

function summarizeSkillBody(body: string): string {
  const trimmed = body.trim();
  if (trimmed.startsWith('---')) {
    const endIdx = trimmed.indexOf('\n---', 3);
    if (endIdx !== -1) {
      const frontmatter = trimmed.slice(3, endIdx);
      const descMatch = frontmatter.match(/^\s*description\s*:\s*(.+)$/m);
      if (descMatch?.[1]) {
        return descMatch[1].trim().replace(/^['"]|['"]$/g, '');
      }
    }
  }
  const withoutFrontmatter = trimmed.replace(/^---[\s\S]*?\n---\s*/, '');
  const firstLine = withoutFrontmatter
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith('#'));
  return firstLine ?? '';
}

const CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'lakehouse', label: 'Lakehouse' },
  { id: 'productivity', label: 'Productivity' },
  { id: 'communication', label: 'Communication' },
  { id: 'compute', label: 'Code' },
  { id: 'search', label: 'Search' },
  { id: 'custom', label: 'Custom' },
  { id: 'skills', label: 'Skills' },
] as const;

export function ConnectorsDialog({
  isOpen,
  onClose,
  onOpenMarketplace,
  botId,
  botName,
}: {
  isOpen: boolean;
  onClose: () => void;
  onOpenMarketplace?: () => void;
  /** Selected bot; enables the Skills tab (per-bot installable skills). */
  botId?: string | null;
  botName?: string;
}) {
  const [apps, setApps] = useState<ConnectorApp[]>(DEFAULT_VIABLE_MCPS);
  const [connectedIds, setConnectedIds] = useState<Set<string>>(() => readConnectedApps());
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [showAddCustom, setShowAddCustom] = useState<boolean>(false);
  const [customService, setCustomService] = useState<string>('');
  const [customName, setCustomName] = useState<string>('');
  const [submittingCustom, setSubmittingCustom] = useState<boolean>(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [skills, setSkills] = useState<BotSkill[]>([]);
  const [skillUrl, setSkillUrl] = useState<string>('');

  const isSkillsTab = activeCategory === 'skills';

  const loadSkills = useCallback(async () => {
    if (!botId) {
      setSkills([]);
      return;
    }
    try {
      setSkills(await fetchSkills(botId));
    } catch {
      setSkills([]);
    }
  }, [botId]);

  useEffect(() => {
    if (isOpen) void loadSkills();
  }, [isOpen, loadSkills]);

  const handleImportSkill = async (e: FormEvent) => {
    e.preventDefault();
    const url = skillUrl.trim();
    if (!url || !botId) return;
    setSubmittingCustom(true);
    setAddError(null);
    try {
      const skill = await importSkill(botId, url);
      setSkills((prev) => [...prev.filter((s) => s.name !== skill.name), skill]);
      setSkillUrl('');
      setShowAddCustom(false);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to import skill');
    } finally {
      setSubmittingCustom(false);
    }
  };

  const handleRemoveSkill = async (skill: BotSkill) => {
    if (!botId) return;
    try {
      await deleteSkill(botId, skill.id);
      setSkills((prev) => prev.filter((s) => s.id !== skill.id));
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to remove skill');
    }
  };

  const handleToggleSkillPack = async (pack: SkillPackCatalogEntry) => {
    if (!botId || togglingId) return;
    const existing = skills.find((s) => s.name.toLowerCase() === pack.name.toLowerCase());
    setTogglingId(`pack:${pack.name}`);
    setAddError(null);
    try {
      if (existing) {
        await deleteSkill(botId, existing.id);
        setSkills((prev) => prev.filter((s) => s.id !== existing.id));
      } else {
        const installed = await installSkillPack(botId, pack.name);
        setSkills((prev) => [...prev.filter((s) => s.name !== installed.name), installed]);
        if (pack.companionMcpService) {
          const companionApp =
            apps.find((a) => a.service === pack.companionMcpService) ??
            BUILTIN_PLUGIN_MCPS.find((a) => a.service === pack.companionMcpService);
          if (companionApp && !connectedIds.has(companionApp.id)) {
            const updated = await connectMcp(companionApp.service);
            setConnectedIds((prev) => {
              const next = new Set(prev);
              next.add(updated.id);
              saveConnectedApps(next);
              return next;
            });
            setApps((prev) => {
              const without = prev.filter((a) => a.service !== updated.service);
              return [...without, { ...updated, connected: true }];
            });
          }
        }
      }
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to update skill pack');
    } finally {
      setTogglingId(null);
    }
  };

  const applyServerConnected = useCallback((list: ConnectorApp[]) => {
    const next = new Set(list.filter((app) => app.connected).map((app) => app.id));
    setConnectedIds(next);
    saveConnectedApps(next);
  }, []);

  const loadMcps = useCallback(
    async (refresh = false) => {
      setLoading(true);
      setAddError(null);
      try {
        const data = await fetchMcps(refresh);
        if (Array.isArray(data) && data.length > 0) {
          const viable = data.filter((item) => item.isViable !== false);
          const byService = new Map<string, ConnectorApp>();
          for (const item of [...viable, ...BUILTIN_PLUGIN_MCPS]) {
            if (!byService.has(item.service)) {
              byService.set(item.service, item);
            }
          }
          const storedIds = readConnectedApps();
          const merged: ConnectorApp[] = [];
          for (const item of byService.values()) {
            if (!item.connected && storedIds.has(item.id)) {
              try {
                const reconnected = await connectMcp(item.service);
                merged.push({ ...reconnected, connected: true });
                continue;
              } catch {
                // Keep server state if auto-reconnect fails
              }
            }
            merged.push(item);
          }
          setApps(merged);
          applyServerConnected(merged);
        }
      } catch {
      } finally {
        setLoading(false);
      }
    },
    [applyServerConnected]
  );

  useEffect(() => {
    void loadMcps(false);
  }, [loadMcps]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      void loadMcps(false);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, loadMcps]);

  const toggleConnect = async (app: ConnectorApp) => {
    if (togglingId) return;
    const currentlyConnected = connectedIds.has(app.id);
    setTogglingId(app.id);
    setAddError(null);
    try {
      if (currentlyConnected) {
        await disconnectMcp(app.service);
        setConnectedIds((prev) => {
          const next = new Set(prev);
          next.delete(app.id);
          saveConnectedApps(next);
          return next;
        });
        setApps((prev) => prev.map((item) => (item.id === app.id ? { ...item, connected: false } : item)));
      } else {
        const updated = await connectMcp(app.service);
        setConnectedIds((prev) => {
          const next = new Set(prev);
          next.add(updated.id);
          saveConnectedApps(next);
          return next;
        });
        setApps((prev) =>
          prev.map((item) => (item.service === updated.service ? { ...updated, connected: true } : item))
        );
      }
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to update MCP connection');
    } finally {
      setTogglingId(null);
    }
  };

  const handleAddCustom = async (e: FormEvent) => {
    e.preventDefault();
    const service = customService.trim();
    if (!service) return;
    setSubmittingCustom(true);
    setAddError(null);
    try {
      const created = await registerCustomMcp(service, {
        name: customName.trim() || undefined,
      });
      setApps((prev) => [...prev.filter((a) => a.service !== created.service), { ...created, connected: true }]);
      setConnectedIds((prev) => {
        const next = new Set(prev);
        next.add(created.id);
        saveConnectedApps(next);
        return next;
      });
      setCustomService('');
      setCustomName('');
      setShowAddCustom(false);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to register MCP service');
    } finally {
      setSubmittingCustom(false);
    }
  };

  const handleDeleteCustom = async (serviceName: string, id: string) => {
    try {
      await removeCustomMcp(serviceName);
      setApps((prev) => prev.filter((a) => a.service !== serviceName));
      setConnectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        saveConnectedApps(next);
        return next;
      });
    } catch {}
  };

  const filteredApps = useMemo(() => {
    let list = apps.filter((app) => app.isViable !== false);
    if (activeCategory === '__connected') {
      list = list.filter((app) => connectedIds.has(app.id));
    } else if (activeCategory === 'custom') {
      list = list.filter((app) => app.source === 'custom' || !app.service.startsWith('system.ai'));
    } else if (activeCategory !== 'all') {
      list = list.filter((app) => app.category === activeCategory);
    }
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (app) =>
          app.name.toLowerCase().includes(q) ||
          app.description.toLowerCase().includes(q) ||
          app.service.toLowerCase().includes(q) ||
          app.categoryLabel.toLowerCase().includes(q) ||
          app.tools.some((t) => t.toLowerCase().includes(q))
      );
    }
    return list;
  }, [apps, activeCategory, connectedIds, searchQuery]);

  const recommendedApps = useMemo(() => {
    const recommended = filteredApps.filter((app) => app.recommended);
    return recommended.length > 0 ? recommended : filteredApps;
  }, [filteredApps]);

  const connectedList = useMemo(() => {
    return apps.filter((app) => connectedIds.has(app.id));
  }, [apps, connectedIds]);

  const isBrowsingAll = activeCategory === 'all' && !searchQuery.trim();
  const displayApps = isBrowsingAll ? recommendedApps : filteredApps;

  if (!isOpen) return null;

  const renderIcon = (app: ConnectorApp) => {
    const iconStyle = { background: app.iconBg, color: app.iconColor };
    const props = { size: 18, strokeWidth: 2.2 } as const;
    let icon: ReactNode;
    switch (app.iconType) {
      case 'databricks':
        icon = <Flame {...props} />;
        break;
      case 'genie':
        icon = <Sparkles {...props} />;
        break;
      case 'search':
        icon = <Globe {...props} />;
        break;
      case 'code':
        icon = <Terminal {...props} />;
        break;
      case 'slack':
        icon = <MessageSquare {...props} />;
        break;
      case 'confluence':
        icon = <BookOpen {...props} />;
        break;
      case 'jira':
        icon = <Layers {...props} />;
        break;
      case 'github':
        icon = <GitBranch {...props} />;
        break;
      case 'notion':
        icon = <FileText {...props} />;
        break;
      case 'google-drive':
        icon = <HardDrive {...props} />;
        break;
      case 'm365':
        icon = <Mail {...props} />;
        break;
      default:
        return (
          <div className="connector-card-icon connector-card-icon-letter" style={iconStyle}>
            <span>{app.name.charAt(0)}</span>
          </div>
        );
    }
    return (
      <div className="connector-card-icon" style={iconStyle}>
        {icon}
      </div>
    );
  };

  const renderCard = (app: ConnectorApp) => {
    const isConnected = connectedIds.has(app.id);
    const isCustom =
      app.source === 'custom' || (!app.service.startsWith('system.ai') && !app.service.startsWith('plugin.'));

    return (
      <div key={app.id} className="connector-card">
        <div className="connector-card-main">
          {renderIcon(app)}
          <span className="connector-card-name">{app.name}</span>
        </div>

        <div className="connector-card-actions">
          {isCustom ? (
            <button
              type="button"
              className="connector-remove-btn"
              title={`Remove ${app.name}`}
              aria-label={`Remove ${app.name}`}
              onClick={() => handleDeleteCustom(app.service, app.id)}
            >
              <Trash2 size={14} />
            </button>
          ) : null}

          <button
            type="button"
            className={isConnected ? 'connector-action-btn is-connected' : 'connector-action-btn'}
            onClick={() => void toggleConnect(app)}
            disabled={togglingId === app.id}
            aria-label={isConnected ? `Disconnect ${app.name}` : `Connect ${app.name}`}
          >
            {togglingId === app.id ? (
              <>
                <RotateCw size={14} className="spin" />
                <span>{isConnected ? 'Disconnecting…' : 'Connecting…'}</span>
              </>
            ) : isConnected ? (
              <>
                <Check size={14} strokeWidth={2.5} />
                <span>Connected</span>
              </>
            ) : (
              <span>Connect</span>
            )}
          </button>
        </div>
      </div>
    );
  };

  const skillQuery = searchQuery.trim().toLowerCase();
  const catalogNames = new Set(SKILL_PACK_CATALOG.map((p) => p.name.toLowerCase()));
  const filteredCatalogPacks = skillQuery
    ? SKILL_PACK_CATALOG.filter(
        (p) =>
          p.name.toLowerCase().includes(skillQuery) ||
          p.title.toLowerCase().includes(skillQuery) ||
          p.description.toLowerCase().includes(skillQuery)
      )
    : SKILL_PACK_CATALOG;
  const filteredCustomSkills = (
    skillQuery
      ? skills.filter((s) => s.name.toLowerCase().includes(skillQuery) || s.body.toLowerCase().includes(skillQuery))
      : skills
  ).filter((s) => !catalogNames.has(s.name.toLowerCase()));

  const renderSkillPackCard = (pack: SkillPackCatalogEntry) => {
    const installed = skills.some((s) => s.name.toLowerCase() === pack.name.toLowerCase());
    const busy = togglingId === `pack:${pack.name}`;
    return (
      <div key={pack.name} className="connector-card connector-card-skill">
        <div className="connector-card-main">
          <div className="connector-card-icon" style={{ background: '#7c3aed', color: '#ffffff' }}>
            <Wand2 size={18} strokeWidth={2.2} />
          </div>
          <div className="connector-card-text">
            <span className="connector-card-name">{pack.title}</span>
            <span className="connector-card-sub">{pack.description}</span>
          </div>
        </div>
        <div className="connector-card-actions">
          <button
            type="button"
            className={installed ? 'connector-action-btn is-connected' : 'connector-action-btn'}
            onClick={() => void handleToggleSkillPack(pack)}
            disabled={busy || !botId}
            aria-label={installed ? `Remove ${pack.title}` : `Install ${pack.title}`}
          >
            {busy ? (
              <>
                <RotateCw size={14} className="spin" />
                <span>{installed ? 'Removing…' : 'Installing…'}</span>
              </>
            ) : installed ? (
              <>
                <Check size={14} strokeWidth={2.5} />
                <span>Installed</span>
              </>
            ) : (
              <span>Connect</span>
            )}
          </button>
        </div>
      </div>
    );
  };

  const renderSkillCard = (skill: BotSkill) => {
    const summary = summarizeSkillBody(skill.body);
    return (
      <div key={skill.id} className="connector-card connector-card-skill">
        <div className="connector-card-main">
          <div className="connector-card-icon" style={{ background: '#7c3aed', color: '#ffffff' }}>
            <Wand2 size={18} strokeWidth={2.2} />
          </div>
          <div className="connector-card-text">
            <span className="connector-card-name">{skill.name}</span>
            {summary ? <span className="connector-card-sub">{summary}</span> : null}
          </div>
        </div>
        <div className="connector-card-actions">
          <button
            type="button"
            className="connector-remove-btn"
            title={`Remove ${skill.name}`}
            aria-label={`Remove skill ${skill.name}`}
            onClick={() => void handleRemoveSkill(skill)}
          >
            <Trash2 size={14} />
          </button>
          <span className="connector-action-btn is-connected">
            <Check size={14} strokeWidth={2.5} />
            <span>Installed</span>
          </span>
        </div>
      </div>
    );
  };

  const sectionTitle = isSkillsTab
    ? botName
      ? `Skills for ${botName}`
      : 'Skills'
    : searchQuery.trim()
      ? `Results for "${searchQuery}"`
      : activeCategory === '__connected'
        ? 'Connected'
        : activeCategory === 'all'
          ? 'Recommended for you'
          : (CATEGORIES.find((c) => c.id === activeCategory)?.label ?? 'Connectors');

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="dialog connectors-dialog"
        role="dialog"
        aria-labelledby="connectors-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="connectors-header">
          <div className="connectors-header-left">
            <h2 id="connectors-dialog-title" className="connectors-title">
              Connect Applications
            </h2>
            <button
              type="button"
              className={activeCategory === '__connected' ? 'connectors-badge is-active' : 'connectors-badge'}
              title={`${connectedIds.size} connected. Click to filter.`}
              onClick={() => setActiveCategory((curr) => (curr === '__connected' ? 'all' : '__connected'))}
            >
              <div className="connectors-badge-avatars">
                {connectedList.slice(0, 3).map((app) => (
                  <span
                    key={app.id}
                    className="connectors-badge-dot"
                    style={{ background: app.iconBg, color: app.iconColor }}
                  >
                    {app.name.charAt(0)}
                  </span>
                ))}
              </div>
              <span className="connectors-badge-label">{connectedIds.size} connected &rsaquo;</span>
            </button>
          </div>
          <button type="button" className="dialog-close-btn" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="connectors-search-row">
          <div className="connectors-search-input-wrap">
            <Search size={16} className="connectors-search-icon" />
            <input
              type="text"
              className="connectors-search-input"
              placeholder="Search apps and skills"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
            {searchQuery ? (
              <button
                type="button"
                className="connectors-search-clear"
                aria-label="Clear search"
                onClick={() => setSearchQuery('')}
              >
                <X size={14} />
              </button>
            ) : null}
          </div>

          <button
            type="button"
            className="connectors-icon-btn"
            title="Refresh connectors"
            aria-label="Refresh connectors"
            onClick={() => loadMcps(true)}
            disabled={loading}
          >
            <RotateCw size={15} className={loading ? 'spin' : ''} />
          </button>

          <button
            type="button"
            className={showAddCustom ? 'connectors-icon-btn is-active' : 'connectors-icon-btn'}
            title={isSkillsTab ? 'Import a skill' : 'Add a custom MCP'}
            aria-label={isSkillsTab ? 'Import skill' : 'Add MCP'}
            onClick={() => setShowAddCustom((prev) => !prev)}
          >
            <Plus size={16} />
          </button>

          {onOpenMarketplace ? (
            <button
              type="button"
              className="connectors-marketplace-btn"
              onClick={() => {
                onClose();
                onOpenMarketplace();
              }}
            >
              <span>Bot Templates</span>
              <ExternalLink size={14} />
            </button>
          ) : null}
        </div>

        {showAddCustom && isSkillsTab ? (
          <div className="connectors-custom-panel">
            <div className="connectors-custom-panel-header">
              <div>
                <h3 className="connectors-custom-panel-title">Import skill</h3>
                <p className="connectors-custom-panel-sub">
                  Link a SKILL.md on GitHub{botName ? ` to install it for ${botName}` : ''}.
                </p>
              </div>
              <button
                type="button"
                className="dialog-close-btn"
                aria-label="Close import skill"
                onClick={() => setShowAddCustom(false)}
              >
                <X size={15} />
              </button>
            </div>
            <form onSubmit={(e) => void handleImportSkill(e)} className="connectors-custom-form">
              <div className="connectors-custom-fields">
                <div className="connectors-field-group">
                  <label className="connectors-field-label">SKILL.md URL</label>
                  <input
                    type="text"
                    className="connectors-custom-input"
                    placeholder="https://github.com/org/repo/blob/main/skill/SKILL.md"
                    value={skillUrl}
                    onChange={(e) => setSkillUrl(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
              </div>
              {addError ? <div className="connectors-error-banner">{addError}</div> : null}
              <div className="connectors-custom-actions">
                <button type="button" className="connectors-btn-secondary" onClick={() => setShowAddCustom(false)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="connector-action-btn is-connected"
                  disabled={submittingCustom || !botId}
                >
                  {submittingCustom ? (
                    <>
                      <RotateCw size={13} className="spin" />
                      <span>Importing…</span>
                    </>
                  ) : (
                    <span>Import</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        ) : showAddCustom ? (
          <div className="connectors-custom-panel">
            <div className="connectors-custom-panel-header">
              <div>
                <h3 className="connectors-custom-panel-title">Add custom MCP</h3>
                <p className="connectors-custom-panel-sub">
                  Register a Unity Catalog service by its fully-qualified name.
                </p>
              </div>
              <button
                type="button"
                className="dialog-close-btn"
                aria-label="Close add MCP"
                onClick={() => setShowAddCustom(false)}
              >
                <X size={15} />
              </button>
            </div>

            <form onSubmit={handleAddCustom} className="connectors-custom-form">
              <div className="connectors-custom-fields">
                <div className="connectors-field-group">
                  <label className="connectors-field-label">Service FQN</label>
                  <input
                    type="text"
                    className="connectors-custom-input"
                    placeholder="catalog.schema.service_name"
                    value={customService}
                    onChange={(e) => setCustomService(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
                <div className="connectors-field-group">
                  <label className="connectors-field-label">Display name</label>
                  <input
                    type="text"
                    className="connectors-custom-input"
                    placeholder="Optional"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                  />
                </div>
              </div>

              {addError ? <div className="connectors-error-banner">{addError}</div> : null}

              <div className="connectors-custom-actions">
                <button type="button" className="connectors-btn-secondary" onClick={() => setShowAddCustom(false)}>
                  Cancel
                </button>
                <button type="submit" className="connector-action-btn is-connected" disabled={submittingCustom}>
                  {submittingCustom ? (
                    <>
                      <RotateCw size={13} className="spin" />
                      <span>Connecting…</span>
                    </>
                  ) : (
                    <span>Connect</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        ) : null}

        <div className="connectors-pills">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              className={activeCategory === cat.id ? 'connectors-pill is-active' : 'connectors-pill'}
              onClick={() => setActiveCategory(cat.id)}
            >
              {cat.label}
            </button>
          ))}
        </div>

        <div className="connectors-body">
          {addError && !showAddCustom ? <div className="connectors-error-banner">{addError}</div> : null}
          <div className="connectors-section">
            <div className="connectors-section-header">
              <span className="connectors-section-title">{sectionTitle}</span>
              {isBrowsingAll && recommendedApps.length < filteredApps.length ? (
                <button
                  type="button"
                  className="connectors-section-link"
                  onClick={() => setActiveCategory('lakehouse')}
                >
                  See all
                </button>
              ) : null}
            </div>

            {isSkillsTab ? (
              !botId ? (
                <div className="connectors-empty">
                  <p>Select a bot to manage its skills.</p>
                </div>
              ) : filteredCatalogPacks.length === 0 && filteredCustomSkills.length === 0 ? (
                <div className="connectors-empty">
                  <p>No skills found. Use + to import a SKILL.md.</p>
                </div>
              ) : (
                <div className="connectors-grid connectors-grid-skills">
                  {filteredCatalogPacks.map(renderSkillPackCard)}
                  {filteredCustomSkills.map(renderSkillCard)}
                </div>
              )
            ) : displayApps.length === 0 ? (
              <div className="connectors-empty">
                <p>No connectors found.</p>
              </div>
            ) : (
              <div className="connectors-grid">{displayApps.map(renderCard)}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
