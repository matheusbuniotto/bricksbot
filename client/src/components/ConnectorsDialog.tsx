import {
  useState,
  useEffect,
  useMemo,
  useCallback,
  type FormEvent,
  type ReactNode,
} from 'react';
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
} from 'lucide-react';
import {
  AVAILABLE_DATABRICKS_MCPS,
  type DatabricksMcpApp,
} from '../../../shared/agents/mcp-types.js';
import { fetchMcps, registerCustomMcp, removeCustomMcp } from '../lib/chat-api.js';

export type ConnectorApp = DatabricksMcpApp;

export const DEFAULT_VIABLE_MCPS: ConnectorApp[] = AVAILABLE_DATABRICKS_MCPS.filter(
  (app) => app.isViable !== false,
);
export const CONNECTOR_APPS: ConnectorApp[] = DEFAULT_VIABLE_MCPS;

const STORAGE_KEY = 'bricksbot.connected_apps';
const DEFAULT_CONNECTED = ['genie-one', 'databricks-dbsql', 'databricks-web-search'];

function readConnectedApps(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set(DEFAULT_CONNECTED);
    const parsed = JSON.parse(raw) as string[];
    return new Set(Array.isArray(parsed) ? parsed : DEFAULT_CONNECTED);
  } catch {
    return new Set(DEFAULT_CONNECTED);
  }
}

function saveConnectedApps(set: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
  } catch {}
}

const CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'lakehouse', label: 'Lakehouse' },
  { id: 'productivity', label: 'Productivity' },
  { id: 'communication', label: 'Communication' },
  { id: 'compute', label: 'Code' },
  { id: 'search', label: 'Search' },
  { id: 'custom', label: 'Custom' },
] as const;

export function ConnectorsDialog({
  isOpen,
  onClose,
  onOpenMarketplace,
}: {
  isOpen: boolean;
  onClose: () => void;
  onOpenMarketplace?: () => void;
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
  const [addError, setAddError] = useState<string | null>(null);

  const loadMcps = useCallback(async (refresh = false) => {
    setLoading(true);
    setAddError(null);
    try {
      const data = await fetchMcps(refresh);
      if (Array.isArray(data) && data.length > 0) {
        setApps(data.filter((item) => item.isViable !== false));
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

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

  const toggleConnect = (id: string) => {
    setConnectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      saveConnectedApps(next);
      return next;
    });
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
      setApps((prev) => [...prev.filter((a) => a.service !== created.service), created]);
      setCustomService('');
      setCustomName('');
      setShowAddCustom(false);
      toggleConnect(created.id);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to register MCP service');
    } finally {
      setSubmittingCustom(false);
    }
  };

  const handleDeleteCustom = async (service: string, id: string) => {
    try {
      await removeCustomMcp(service);
      setApps((prev) => prev.filter((a) => a.service !== service));
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
      list = list.filter(
        (app) => app.source === 'custom' || !app.service.startsWith('system.ai'),
      );
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
          app.tools.some((t) => t.toLowerCase().includes(q)),
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
    const isCustom = app.source === 'custom' || !app.service.startsWith('system.ai');

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
            onClick={() => toggleConnect(app.id)}
            aria-label={isConnected ? `Disconnect ${app.name}` : `Connect ${app.name}`}
          >
            {isConnected ? (
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

  const sectionTitle = searchQuery.trim()
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
              className={
                activeCategory === '__connected' ? 'connectors-badge is-active' : 'connectors-badge'
              }
              title={`${connectedIds.size} connected. Click to filter.`}
              onClick={() =>
                setActiveCategory((curr) => (curr === '__connected' ? 'all' : '__connected'))
              }
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
              <span className="connectors-badge-label">
                {connectedIds.size} connected &rsaquo;
              </span>
            </button>
          </div>
          <button
            type="button"
            className="dialog-close-btn"
            aria-label="Close"
            onClick={onClose}
          >
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
            title="Add a custom MCP"
            aria-label="Add MCP"
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

        {showAddCustom ? (
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
                <button
                  type="button"
                  className="connectors-btn-secondary"
                  onClick={() => setShowAddCustom(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="connector-action-btn is-connected"
                  disabled={submittingCustom}
                >
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

            {displayApps.length === 0 ? (
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
