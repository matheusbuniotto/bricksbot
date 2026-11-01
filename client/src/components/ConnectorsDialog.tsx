import { useState, useEffect, useMemo, useCallback } from 'react';
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
  ChevronDown,
  ChevronUp,
  Copy,
  CheckCheck,
  Wrench,
  ShieldCheck,
} from 'lucide-react';
import {
  AVAILABLE_DATABRICKS_MCPS,
  DATABRICKS_AI_GATEWAY_MCP_URL,
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
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [copiedItem, setCopiedItem] = useState<string | null>(null);

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

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleCopy = (text: string) => {
    try {
      void navigator.clipboard?.writeText(text);
      setCopiedItem(text);
      setTimeout(() => setCopiedItem((curr) => (curr === text ? null : curr)), 1800);
    } catch {}
  };

  const handleAddCustom = async (e: React.FormEvent) => {
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
      setExpandedIds((prev) => new Set(prev).add(created.id));
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
      setExpandedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch {}
  };

  const categories = useMemo(
    () => [
      { id: 'all', label: 'All' },
      { id: 'lakehouse', label: 'Lakehouse & Analytics' },
      { id: 'communication', label: 'Communication' },
      { id: 'productivity', label: 'Productivity' },
      { id: 'compute', label: 'Code & Execution' },
      { id: 'search', label: 'Web Search' },
      { id: 'custom', label: 'Custom' },
    ],
    [],
  );

  const categoryCounts = useMemo(() => {
    const viable = apps.filter((app) => app.isViable !== false);
    const counts: Record<string, number> = {
      all: viable.length,
      custom: viable.filter((a) => a.source === 'custom' || !a.service.startsWith('system.ai')).length,
    };
    for (const cat of categories) {
      if (cat.id !== 'all' && cat.id !== 'custom') {
        counts[cat.id] = viable.filter((a) => a.category === cat.id).length;
      }
    }
    return counts;
  }, [apps, categories]);

  const filteredApps = useMemo(() => {
    let list = apps.filter((app) => app.isViable !== false);
    if (activeCategory === '__connected') {
      list = list.filter((app) => connectedIds.has(app.id));
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

  const systemMcps = useMemo(() => {
    return filteredApps.filter((app) => app.source === 'system' || app.service.startsWith('system.ai'));
  }, [filteredApps]);

  const customAndUserMcps = useMemo(() => {
    return filteredApps.filter(
      (app) => app.source === 'custom' || app.source === 'user' || !app.service.startsWith('system.ai'),
    );
  }, [filteredApps]);

  const connectedList = useMemo(() => {
    return apps.filter((app) => connectedIds.has(app.id));
  }, [apps, connectedIds]);

  const allExpanded =
    filteredApps.length > 0 && filteredApps.every((a) => expandedIds.has(a.id));

  const toggleExpandAll = () => {
    if (allExpanded) {
      setExpandedIds(new Set());
    } else {
      setExpandedIds(new Set(filteredApps.map((a) => a.id)));
    }
  };

  if (!isOpen) return null;

  const renderIcon = (app: ConnectorApp) => {
    const iconStyle = { background: app.iconBg, color: app.iconColor };
    switch (app.iconType) {
      case 'databricks':
        return (
          <div className="connector-card-icon" style={iconStyle}>
            <Flame size={18} strokeWidth={2.2} />
          </div>
        );
      case 'genie':
        return (
          <div className="connector-card-icon" style={iconStyle}>
            <Sparkles size={18} strokeWidth={2.2} />
          </div>
        );
      case 'search':
        return (
          <div className="connector-card-icon" style={iconStyle}>
            <Globe size={18} strokeWidth={2.2} />
          </div>
        );
      case 'code':
        return (
          <div className="connector-card-icon" style={iconStyle}>
            <Terminal size={18} strokeWidth={2.2} />
          </div>
        );
      case 'slack':
        return (
          <div className="connector-card-icon" style={iconStyle}>
            <MessageSquare size={18} strokeWidth={2.2} />
          </div>
        );
      case 'confluence':
        return (
          <div className="connector-card-icon" style={iconStyle}>
            <BookOpen size={18} strokeWidth={2.2} />
          </div>
        );
      case 'jira':
        return (
          <div className="connector-card-icon" style={iconStyle}>
            <Layers size={18} strokeWidth={2.2} />
          </div>
        );
      case 'github':
        return (
          <div className="connector-card-icon" style={iconStyle}>
            <GitBranch size={18} strokeWidth={2.2} />
          </div>
        );
      case 'notion':
        return (
          <div className="connector-card-icon" style={iconStyle}>
            <FileText size={18} strokeWidth={2.2} />
          </div>
        );
      case 'google-drive':
        return (
          <div className="connector-card-icon" style={iconStyle}>
            <HardDrive size={18} strokeWidth={2.2} />
          </div>
        );
      case 'm365':
        return (
          <div className="connector-card-icon" style={iconStyle}>
            <Mail size={18} strokeWidth={2.2} />
          </div>
        );
      default:
        return (
          <div className="connector-card-icon connector-card-icon-letter" style={iconStyle}>
            <span>{app.name.charAt(0)}</span>
          </div>
        );
    }
  };

  const renderCard = (app: ConnectorApp) => {
    const isConnected = connectedIds.has(app.id);
    const isExpanded = expandedIds.has(app.id);
    const connectUrl = app.connectUrl || DATABRICKS_AI_GATEWAY_MCP_URL;
    const isCustom = app.source === 'custom' || !app.service.startsWith('system.ai');

    return (
      <div key={app.id} className={isExpanded ? 'connector-card is-expanded' : 'connector-card'}>
        <div className="connector-card-primary-row">
          <div className="connector-card-main">
            {renderIcon(app)}
            <div className="connector-card-details">
              <div className="connector-card-header-line">
                <span className="connector-card-name">{app.name}</span>
                <span className={`connector-source-badge ${isCustom ? 'is-custom' : 'is-system'}`}>
                  {isCustom ? 'Custom' : 'System'}
                </span>
                {connectUrl ? (
                  <a
                    href={connectUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="connector-service-badge is-link"
                    title={`Open ${app.service} in Databricks`}
                  >
                    <span>{app.service}</span>
                    <ExternalLink size={9} strokeWidth={2.2} />
                  </a>
                ) : (
                  <span className="connector-service-badge">{app.service}</span>
                )}
              </div>
              <span className="connector-card-desc">{app.description}</span>
              <div className="connector-tools-pill">
                {app.tools.length} {app.tools.length === 1 ? 'tool' : 'tools'}: {app.tools.join(', ')}
              </div>
            </div>
          </div>

          <div className="connector-card-actions">
            <button
              type="button"
              className="connector-expand-btn"
              onClick={() => toggleExpand(app.id)}
              aria-expanded={isExpanded}
              aria-label={isExpanded ? `Hide details for ${app.name}` : `Show details for ${app.name}`}
            >
              <span>Details</span>
              {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>

            {isCustom ? (
              <button
                type="button"
                className="dialog-close-btn"
                title={`Remove ${app.name}`}
                aria-label={`Remove ${app.name}`}
                onClick={() => handleDeleteCustom(app.service, app.id)}
              >
                <Trash2 size={14} />
              </button>
            ) : null}

            <button
              type="button"
              className={
                isConnected
                  ? 'connector-action-btn is-connected'
                  : 'connector-action-btn'
              }
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

        {isExpanded ? (
          <div className="connector-card-expansion">
            <div className="connector-expanded-desc">
              {app.description}
            </div>

            <div className="connector-tools-section">
              <div className="connector-tools-header">
                <div className="connector-tools-header-left">
                  <Wrench size={12} />
                  <span>Available Tools ({app.tools.length})</span>
                </div>
                <span className="connector-tools-hint">Click tool to copy name</span>
              </div>
              <div className="connector-tools-list">
                {app.tools.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className="connector-tool-badge"
                    onClick={() => handleCopy(t)}
                    title={`Copy "${t}"`}
                  >
                    <Terminal size={11} />
                    <code>{t}</code>
                    {copiedItem === t ? (
                      <CheckCheck size={11} className="text-emerald-500" />
                    ) : (
                      <Copy size={11} />
                    )}
                  </button>
                ))}
              </div>
            </div>

            <div className="connector-meta-row">
              <div className="connector-meta-left">
                <ShieldCheck size={13} />
                <span>Unity Catalog AI Gateway &bull; Live Probed</span>
              </div>
              <div className="connector-meta-actions">
                <button
                  type="button"
                  className="connector-copy-btn"
                  onClick={() => handleCopy(app.service)}
                  title="Copy service FQN"
                >
                  {copiedItem === app.service ? (
                    <>
                      <CheckCheck size={11} />
                      <span>Copied FQN</span>
                    </>
                  ) : (
                    <>
                      <Copy size={11} />
                      <span>Copy FQN</span>
                    </>
                  )}
                </button>
                {connectUrl ? (
                  <a
                    href={connectUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="connector-detail-link"
                  >
                    <span>Explore in Databricks</span>
                    <ExternalLink size={11} />
                  </a>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="dialog connectors-dialog"
        role="dialog"
        aria-labelledby="connectors-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="connectors-header">
          <h2 id="connectors-dialog-title" className="connectors-title">
            Connect Applications (MCPs)
          </h2>
          <div className="connectors-header-right">
            <button
              type="button"
              className={activeCategory === '__connected' ? 'connectors-badge is-active' : 'connectors-badge'}
              title={`${connectedIds.size} MCPs connected. Click to filter.`}
              onClick={() =>
                setActiveCategory((curr) => (curr === '__connected' ? 'all' : '__connected'))
              }
              style={{ cursor: 'pointer', border: 'none' }}
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
            <button
              type="button"
              className="dialog-close-btn"
              aria-label="Close"
              onClick={onClose}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="connectors-search-row">
          <div className="connectors-search-input-wrap">
            <Search size={16} className="connectors-search-icon" />
            <input
              type="text"
              className="connectors-search-input"
              placeholder="Search MCPs, tools, and Databricks connectors..."
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
            className="connectors-gateway-btn"
            title="Refresh viable MCPs from Databricks"
            onClick={() => loadMcps(true)}
            disabled={loading}
          >
            <RotateCw size={14} className={loading ? 'spin' : ''} />
            <span>{loading ? 'Refreshing…' : 'Refresh'}</span>
          </button>

          <button
            type="button"
            className={showAddCustom ? 'connectors-gateway-btn is-active' : 'connectors-gateway-btn'}
            title="Add a custom Unity Catalog MCP service"
            onClick={() => setShowAddCustom((prev) => !prev)}
          >
            <Plus size={14} />
            <span>Add MCP</span>
          </button>

          <a
            href={DATABRICKS_AI_GATEWAY_MCP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="connectors-gateway-btn"
            title="Open MCP settings in Databricks AI Gateway"
          >
            <Sparkles size={14} />
            <span>AI Gateway MCP</span>
            <ExternalLink size={13} />
          </a>

          {onOpenMarketplace ? (
            <button
              type="button"
              className="connectors-marketplace-btn"
              onClick={() => {
                onClose();
                onOpenMarketplace();
              }}
            >
              <span className="connectors-marketplace-dot" />
              <span>Bot Templates</span>
              <ExternalLink size={14} />
            </button>
          ) : null}
        </div>

        {showAddCustom ? (
          <div className="connectors-custom-panel">
            <div className="connectors-custom-panel-header">
              <div className="connectors-custom-panel-title-wrap">
                <Sparkles size={16} />
                <div>
                  <h3 className="connectors-custom-panel-title">Add Unity Catalog MCP Service</h3>
                  <p className="connectors-custom-panel-sub">
                    Connect a custom Unity Catalog service. BricksBot will live-probe its tools via AI Gateway.
                  </p>
                </div>
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
                  <label className="connectors-field-label">Service FQN (catalog.schema.service)</label>
                  <input
                    type="text"
                    className="connectors-custom-input"
                    placeholder="catalog.schema.service_name (e.g. main.default.my_mcp)"
                    value={customService}
                    onChange={(e) => setCustomService(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
                <div className="connectors-field-group">
                  <label className="connectors-field-label">Display Name (optional)</label>
                  <input
                    type="text"
                    className="connectors-custom-input"
                    placeholder="My Custom Connector"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                  />
                </div>
              </div>

              <div className="connectors-example-chips">
                <span>Examples:</span>
                <button
                  type="button"
                  className="connectors-example-chip"
                  onClick={() => setCustomService('main.default.analytics_tools')}
                >
                  main.default.analytics_tools
                </button>
                <button
                  type="button"
                  className="connectors-example-chip"
                  onClick={() => setCustomService('workspace.ai.finance_mcp')}
                >
                  workspace.ai.finance_mcp
                </button>
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
                      <span>Probing AI Gateway…</span>
                    </>
                  ) : (
                    <>
                      <Plus size={14} />
                      <span>Connect MCP</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        ) : null}

        <div className="connectors-pills">
          {categories.map((cat) => {
            const count = categoryCounts[cat.id] ?? 0;
            return (
              <button
                key={cat.id}
                type="button"
                className={
                  activeCategory === cat.id
                    ? 'connectors-pill is-active'
                    : 'connectors-pill'
                }
                onClick={() => setActiveCategory(cat.id)}
              >
                <span>{cat.label}</span>
                <span className="connectors-pill-count">{count}</span>
              </button>
            );
          })}
        </div>

        <div className="connectors-body">
          {searchQuery.trim() || activeCategory !== 'all' ? (
            <div className="connectors-section">
              <div className="connectors-section-header">
                <span className="connectors-section-title">
                  {searchQuery.trim()
                    ? `Results for "${searchQuery}"`
                    : activeCategory === '__connected'
                      ? 'Connected MCPs'
                      : categories.find((c) => c.id === activeCategory)?.label}
                </span>
                <div className="connectors-section-actions">
                  <span className="connectors-section-count">
                    {filteredApps.length} {filteredApps.length === 1 ? 'connector' : 'connectors'}
                  </span>
                  {filteredApps.length > 0 ? (
                    <button
                      type="button"
                      className="connectors-section-link"
                      onClick={toggleExpandAll}
                    >
                      {allExpanded ? 'Collapse all' : 'Expand all'}
                    </button>
                  ) : null}
                </div>
              </div>
              {filteredApps.length === 0 ? (
                <div className="connectors-empty">
                  <p>No viable connectors found.</p>
                </div>
              ) : (
                <div className="connectors-grid">{filteredApps.map(renderCard)}</div>
              )}
            </div>
          ) : (
            <>
              {systemMcps.length > 0 ? (
                <div className="connectors-section">
                  <div className="connectors-section-header">
                    <span className="connectors-section-title">System MCPs (Unity AI Gateway)</span>
                    <div className="connectors-section-actions">
                      <button
                        type="button"
                        className="connectors-section-link"
                        onClick={toggleExpandAll}
                      >
                        {allExpanded ? 'Collapse all' : 'Expand all'}
                      </button>
                      <button
                        type="button"
                        className="connectors-section-link"
                        onClick={() => setActiveCategory('lakehouse')}
                      >
                        View all
                      </button>
                    </div>
                  </div>
                  <p className="connectors-section-subtitle">
                    Native Unity Gateway tools ready to run in chats
                  </p>
                  <div className="connectors-grid">{systemMcps.map(renderCard)}</div>
                </div>
              ) : null}

              {customAndUserMcps.length > 0 ? (
                <div className="connectors-section">
                  <div className="connectors-section-header">
                    <span className="connectors-section-title">
                      Custom &amp; Workspace MCPs
                    </span>
                    <div className="connectors-section-actions">
                      <a
                        href={DATABRICKS_AI_GATEWAY_MCP_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="connectors-section-config-link"
                        title="Configure MCPs in Databricks AI Gateway"
                      >
                        <span>Configure in AI Gateway</span>
                        <ExternalLink size={12} strokeWidth={2.2} />
                      </a>
                    </div>
                  </div>
                  <p className="connectors-section-subtitle">
                    Custom external and team MCP tools registered in Unity Catalog
                  </p>
                  <div className="connectors-grid">{customAndUserMcps.map(renderCard)}</div>
                </div>
              ) : null}

              {filteredApps.length === 0 ? (
                <div className="connectors-empty">
                  <p>No viable connectors found.</p>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
