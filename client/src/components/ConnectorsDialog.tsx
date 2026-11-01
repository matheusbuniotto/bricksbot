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
  MessageSquare,
  BookOpen,
  Layers,
  GitBranch,
  FileText,
  HardDrive,
  Mail,
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
    { id: 'communication', label: 'Comunicação' },
    { id: 'productivity', label: 'Produtividade' },
    { id: 'compute', label: 'Código & Execução' },
    { id: 'search', label: 'Busca Web' },
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

  const activeDatabricksMcps = useMemo(() => {
    return CONNECTOR_APPS.filter((app) => app.status === 'active');
  }, []);

  const inactiveGenieConnectors = useMemo(() => {
    return CONNECTOR_APPS.filter((app) => app.status === 'inactive');
  }, []);

  const connectedList = useMemo(() => {
    return CONNECTOR_APPS.filter((app) => connectedIds.has(app.id));
  }, [connectedIds]);

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
    const isActiveMcp = app.status === 'active';
    const genieUrl = app.connectUrl || 'https://dbc-562d9321-2592.cloud.databricks.com/genie';

    return (
      <div key={app.id} className="connector-card">
        <div className="connector-card-main">
          {renderIcon(app)}
          <div className="connector-card-details">
            <div className="connector-card-header-line">
              <span className="connector-card-name">{app.name}</span>
              <span
                className={
                  isActiveMcp
                    ? 'connector-service-badge'
                    : 'connector-service-badge is-inactive'
                }
              >
                {isActiveMcp ? app.service : 'Requer Databricks One'}
              </span>
            </div>
            <span className="connector-card-desc">{app.description}</span>
            <div className="connector-tools-pill">
              {isActiveMcp
                ? `${app.tools.length} ${app.tools.length === 1 ? 'ferramenta' : 'ferramentas'}: ${app.tools.join(', ')}`
                : `Disponível para indexação no Genie One (${app.service})`}
            </div>
          </div>
        </div>

        {isActiveMcp ? (
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
        ) : (
          <a
            href={genieUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="connector-action-btn is-genie-link"
            title={`Conectar ${app.name} no Databricks One (Genie)`}
          >
            <span>Conectar via Genie</span>
            <ExternalLink size={12} strokeWidth={2.2} />
          </a>
        )}
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
              placeholder="Buscar em MCPs, ferramentas e conectores do Databricks"
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
                  {filteredApps.length} {filteredApps.length === 1 ? 'conector' : 'conectores'}
                </span>
              </div>
              {filteredApps.length === 0 ? (
                <div className="connectors-empty">
                  <p>Nenhum conector encontrado.</p>
                </div>
              ) : (
                <div className="connectors-grid">{filteredApps.map(renderCard)}</div>
              )}
            </div>
          ) : (
            <>
              {/* Active MCPs Section */}
              {activeDatabricksMcps.length > 0 ? (
                <div className="connectors-section">
                  <div className="connectors-section-header">
                    <span className="connectors-section-title">MCPs Ativos no Databricks</span>
                    <button
                      type="button"
                      className="connectors-section-link"
                      onClick={() => setActiveCategory('lakehouse')}
                    >
                      Ver todos
                    </button>
                  </div>
                  <p className="connectors-section-subtitle">
                    Ferramentas nativas do Unity Gateway prontas para execução nos chats
                  </p>
                  <div className="connectors-grid">{activeDatabricksMcps.map(renderCard)}</div>
                </div>
              ) : null}

              {/* Inactive Connectors Section (Direct to Genie One) */}
              {inactiveGenieConnectors.length > 0 ? (
                <div className="connectors-section">
                  <div className="connectors-section-header">
                    <span className="connectors-section-title">
                      Conectores Corporativos (via Databricks One)
                    </span>
                    <button
                      type="button"
                      className="connectors-section-link"
                      onClick={() => setActiveCategory('communication')}
                    >
                      Ver todos
                    </button>
                  </div>
                  <p className="connectors-section-subtitle">
                    Fontes de dados e wikis empresariais integradas na Ontologia do Genie One
                  </p>
                  <div className="connectors-grid">{inactiveGenieConnectors.map(renderCard)}</div>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
