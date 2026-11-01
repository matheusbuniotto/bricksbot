import { useState, useEffect, useMemo } from 'react';
import {
  X,
  Search,
  Check,
  ExternalLink,
  Sparkles,
  Flame,
  Globe,
  Terminal,
} from 'lucide-react';
import {
  AVAILABLE_DATABRICKS_MCPS,
  type DatabricksMcpApp,
} from '../../../shared/agents/mcp-types.js';

export type ConnectorApp = DatabricksMcpApp;

export const CONNECTOR_APPS: ConnectorApp[] = AVAILABLE_DATABRICKS_MCPS;

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
  } catch {
    // Ignore storage quota errors
  }
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
  const [connectedIds, setConnectedIds] = useState<Set<string>>(() => readConnectedApps());
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

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

  const categories = [
    { id: 'all', label: 'Todos' },
    { id: 'lakehouse', label: 'Lakehouse & Análise' },
    { id: 'search', label: 'Busca Web' },
    { id: 'compute', label: 'Código & Execução' },
  ];

  const filteredApps = useMemo(() => {
    let list = CONNECTOR_APPS;
    if (activeCategory !== 'all') {
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
  }, [activeCategory, searchQuery]);

  const lakehouseApps = useMemo(() => {
    if (activeCategory !== 'all' && activeCategory !== 'lakehouse') return [];
    if (searchQuery.trim()) return [];
    return CONNECTOR_APPS.filter((app) => app.category === 'lakehouse');
  }, [activeCategory, searchQuery]);

  const searchApps = useMemo(() => {
    if (activeCategory !== 'all' && activeCategory !== 'search') return [];
    if (searchQuery.trim()) return [];
    return CONNECTOR_APPS.filter((app) => app.category === 'search');
  }, [activeCategory, searchQuery]);

  const computeApps = useMemo(() => {
    if (activeCategory !== 'all' && activeCategory !== 'compute') return [];
    if (searchQuery.trim()) return [];
    return CONNECTOR_APPS.filter((app) => app.category === 'compute');
  }, [activeCategory, searchQuery]);

  const connectedList = useMemo(() => {
    return CONNECTOR_APPS.filter((app) => connectedIds.has(app.id));
  }, [connectedIds]);

  if (!isOpen) return null;

  const renderIcon = (app: ConnectorApp) => {
    if (app.iconType === 'databricks') {
      return (
        <div className="connector-card-icon" style={{ background: app.iconBg, color: app.iconColor }}>
          <Flame size={18} strokeWidth={2.2} />
        </div>
      );
    }
    if (app.iconType === 'genie') {
      return (
        <div className="connector-card-icon" style={{ background: app.iconBg, color: app.iconColor }}>
          <Sparkles size={18} strokeWidth={2.2} />
        </div>
      );
    }
    if (app.iconType === 'search') {
      return (
        <div className="connector-card-icon" style={{ background: app.iconBg, color: app.iconColor }}>
          <Globe size={18} strokeWidth={2.2} />
        </div>
      );
    }
    if (app.iconType === 'code') {
      return (
        <div className="connector-card-icon" style={{ background: app.iconBg, color: app.iconColor }}>
          <Terminal size={18} strokeWidth={2.2} />
        </div>
      );
    }

    return (
      <div
        className="connector-card-icon connector-card-icon-letter"
        style={{ background: app.iconBg, color: app.iconColor }}
      >
        <span>{app.name.charAt(0)}</span>
      </div>
    );
  };

  const renderCard = (app: ConnectorApp) => {
    const isConnected = connectedIds.has(app.id);
    return (
      <div key={app.id} className="connector-card">
        <div className="connector-card-main">
          {renderIcon(app)}
          <div className="connector-card-details">
            <div className="connector-card-header-line">
              <span className="connector-card-name">{app.name}</span>
              <span className="connector-service-badge">{app.service}</span>
            </div>
            <span className="connector-card-desc">{app.description}</span>
            <div className="connector-tools-pill">
              {app.tools.length} {app.tools.length === 1 ? 'ferramenta' : 'ferramentas'}: {app.tools.join(', ')}
            </div>
          </div>
        </div>
        <button
          type="button"
          className={
            isConnected
              ? 'connector-action-btn is-connected'
              : 'connector-action-btn'
          }
          onClick={() => toggleConnect(app.id)}
          aria-label={isConnected ? `Desconectar ${app.name}` : `Conectar ${app.name}`}
        >
          {isConnected ? (
            <>
              <Check size={14} strokeWidth={2.5} />
              <span>Conectado</span>
            </>
          ) : (
            <span>Conectar</span>
          )}
        </button>
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
        {/* Top Header */}
        <div className="connectors-header">
          <h2 id="connectors-dialog-title" className="connectors-title">
            Conectar aplicativos (MCPs)
          </h2>
          <div className="connectors-header-right">
            <div className="connectors-badge" title={`${connectedIds.size} MCPs conectados`}>
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
                {connectedIds.size} conectados &rsaquo;
              </span>
            </div>
            <button
              type="button"
              className="dialog-close-btn"
              aria-label="Fechar"
              onClick={onClose}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="connectors-search-row">
          <div className="connectors-search-input-wrap">
            <Search size={16} className="connectors-search-icon" />
            <input
              type="text"
              className="connectors-search-input"
              placeholder="Buscar em MCPs e ferramentas do Databricks"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
          </div>
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
              <span>Modelos de Bots</span>
              <ExternalLink size={14} />
            </button>
          ) : null}
        </div>

        {/* Category Filter Pills */}
        <div className="connectors-pills">
          {categories.map((cat) => (
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
              {cat.label}
            </button>
          ))}
        </div>

        {/* Content Body */}
        <div className="connectors-body">
          {searchQuery.trim() || activeCategory !== 'all' ? (
            <div className="connectors-section">
              <div className="connectors-section-header">
                <span className="connectors-section-title">
                  {searchQuery.trim()
                    ? `Resultados para "${searchQuery}"`
                    : categories.find((c) => c.id === activeCategory)?.label}
                </span>
                <span className="connectors-section-count">
                  {filteredApps.length} {filteredApps.length === 1 ? 'MCP' : 'MCPs'}
                </span>
              </div>
              {filteredApps.length === 0 ? (
                <div className="connectors-empty">
                  <p>Nenhum MCP encontrado.</p>
                </div>
              ) : (
                <div className="connectors-grid">{filteredApps.map(renderCard)}</div>
              )}
            </div>
          ) : (
            <>
              {/* Lakehouse & Analytics */}
              {lakehouseApps.length > 0 ? (
                <div className="connectors-section">
                  <div className="connectors-section-header">
                    <span className="connectors-section-title">Lakehouse & Análise</span>
                    <button
                      type="button"
                      className="connectors-section-link"
                      onClick={() => setActiveCategory('lakehouse')}
                    >
                      Ver tudo
                    </button>
                  </div>
                  <div className="connectors-grid">{lakehouseApps.map(renderCard)}</div>
                </div>
              ) : null}

              {/* Web Search */}
              {searchApps.length > 0 ? (
                <div className="connectors-section">
                  <div className="connectors-section-header">
                    <span className="connectors-section-title">Busca Web</span>
                    <button
                      type="button"
                      className="connectors-section-link"
                      onClick={() => setActiveCategory('search')}
                    >
                      Ver tudo
                    </button>
                  </div>
                  <div className="connectors-grid">{searchApps.map(renderCard)}</div>
                </div>
              ) : null}

              {/* Code & Execution */}
              {computeApps.length > 0 ? (
                <div className="connectors-section">
                  <div className="connectors-section-header">
                    <span className="connectors-section-title">Código & Execução</span>
                    <button
                      type="button"
                      className="connectors-section-link"
                      onClick={() => setActiveCategory('compute')}
                    >
                      Ver tudo
                    </button>
                  </div>
                  <div className="connectors-grid">{computeApps.map(renderCard)}</div>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
