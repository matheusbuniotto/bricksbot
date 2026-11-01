import { useState, useEffect, useMemo } from 'react';
import {
  X,
  Search,
  Check,
  ExternalLink,
  MessageSquare,
  KeyRound,
  Database,
  Sparkles,
  GitBranch,
  Layers,
  Flame,
} from 'lucide-react';

export interface ConnectorApp {
  id: string;
  name: string;
  category: 'productivity' | 'communication' | 'code' | 'security' | 'design';
  categoryLabel: string;
  description: string;
  recommended?: boolean;
  iconBg: string;
  iconColor: string;
  iconLetter?: string;
  iconType?: string;
}

export const CONNECTOR_APPS: ConnectorApp[] = [
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    category: 'productivity',
    categoryLabel: 'Produtividade',
    description: 'Acessar eventos, reuniões e disponibilidade de agenda',
    recommended: true,
    iconBg: '#f1f3f4',
    iconColor: '#4285f4',
    iconLetter: 'G',
  },
  {
    id: 'slack',
    name: 'Slack',
    category: 'communication',
    categoryLabel: 'Comunicação',
    description: 'Ler mensagens de canais e enviar atualizações ou alertas',
    recommended: true,
    iconBg: '#4a154b',
    iconColor: '#ffffff',
    iconType: 'slack',
  },
  {
    id: 'granola',
    name: 'Granola',
    category: 'productivity',
    categoryLabel: 'Produtividade',
    description: 'Notas de reuniões com IA e resumos estruturados',
    recommended: true,
    iconBg: '#cbe458',
    iconColor: '#1d2a05',
    iconLetter: 'G',
  },
  {
    id: 'outlook',
    name: 'Outlook',
    category: 'communication',
    categoryLabel: 'Comunicação',
    description: 'Sincronizar emails, calendários corporativos e contatos',
    recommended: true,
    iconBg: '#0078d4',
    iconColor: '#ffffff',
    iconLetter: 'O',
  },
  {
    id: 'google-sheets',
    name: 'Google Sheets',
    category: 'productivity',
    categoryLabel: 'Produtividade',
    description: 'Ler tabelas, métricas e atualizar planilhas online',
    recommended: true,
    iconBg: '#e6f4ea',
    iconColor: '#0f9d58',
    iconLetter: 'G',
  },
  {
    id: 'docs-canvas',
    name: 'Docs Canvas',
    category: 'productivity',
    categoryLabel: 'Produtividade',
    description: 'Criação visual de documentos e relatórios executivos',
    recommended: true,
    iconBg: '#f3f4f6',
    iconColor: '#4b5563',
    iconLetter: 'D',
  },
  {
    id: 'databricks-dbsql',
    name: 'Databricks SQL',
    category: 'code',
    categoryLabel: 'Código & Lakehouse',
    description: 'Consultas governadas em SQL Warehouses via system.ai.dbsql',
    recommended: true,
    iconBg: '#ff3621',
    iconColor: '#ffffff',
    iconType: 'databricks',
  },
  {
    id: 'genie-one',
    name: 'Databricks One (Genie)',
    category: 'code',
    categoryLabel: 'Código & Lakehouse',
    description: 'Análise em linguagem natural com a Ontologia do Lakehouse',
    recommended: true,
    iconBg: '#1b1b1d',
    iconColor: '#ff3621',
    iconType: 'genie',
  },
  {
    id: '1password',
    name: '1Password',
    category: 'security',
    categoryLabel: 'Gerenciadores de senha',
    description: 'Acesso seguro a credenciais e segredos de desenvolvimento',
    iconBg: '#0b5fff',
    iconColor: '#ffffff',
    iconType: '1password',
  },
  {
    id: 'notion',
    name: 'Notion',
    category: 'productivity',
    categoryLabel: 'Produtividade',
    description: 'Bases de conhecimento, wikis de equipe e documentos de projeto',
    iconBg: '#000000',
    iconColor: '#ffffff',
    iconLetter: 'N',
  },
  {
    id: 'atlassian',
    name: 'Atlassian (Jira)',
    category: 'productivity',
    categoryLabel: 'Produtividade',
    description: 'Acompanhar sprints, tickets e backlog de engenharia',
    iconBg: '#0052cc',
    iconColor: '#ffffff',
    iconType: 'atlassian',
  },
  {
    id: 'github',
    name: 'GitHub',
    category: 'code',
    categoryLabel: 'Código & Lakehouse',
    description: 'Gerenciar repositórios, pull requests e status de CI',
    iconBg: '#24292e',
    iconColor: '#ffffff',
    iconType: 'github',
  },
  {
    id: 'unity-catalog',
    name: 'Unity Catalog',
    category: 'code',
    categoryLabel: 'Código & Lakehouse',
    description: 'Metadados, governança e volumes compartilhados no workspace',
    iconBg: '#f97316',
    iconColor: '#ffffff',
    iconType: 'unity',
  },
  {
    id: 'figma',
    name: 'Figma',
    category: 'design',
    categoryLabel: 'Design',
    description: 'Inspecionar frames, tokens de design e componentes de UI',
    iconBg: '#0acf83',
    iconColor: '#ffffff',
    iconLetter: 'F',
  },
];

const STORAGE_KEY = 'bricksbot.connected_apps';
const DEFAULT_CONNECTED = ['notion', 'databricks-dbsql', 'genie-one', 'google-calendar', 'slack'];

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
    { id: 'security', label: 'Gerenciadores de senha' },
    { id: 'productivity', label: 'Produtividade' },
    { id: 'communication', label: 'Comunicação' },
    { id: 'code', label: 'Código & Lakehouse' },
    { id: 'design', label: 'Design' },
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
          app.categoryLabel.toLowerCase().includes(q),
      );
    }
    return list;
  }, [activeCategory, searchQuery]);

  const recommendedApps = useMemo(() => {
    if (activeCategory !== 'all' || searchQuery.trim()) return [];
    return CONNECTOR_APPS.filter((app) => app.recommended);
  }, [activeCategory, searchQuery]);

  const passwordManagerApps = useMemo(() => {
    if (activeCategory !== 'all' && activeCategory !== 'security') return [];
    if (searchQuery.trim()) return [];
    return CONNECTOR_APPS.filter((app) => app.category === 'security');
  }, [activeCategory, searchQuery]);

  const productivityApps = useMemo(() => {
    if (activeCategory !== 'all' && activeCategory !== 'productivity') return [];
    if (searchQuery.trim()) return [];
    return CONNECTOR_APPS.filter((app) => app.category === 'productivity' && !app.recommended);
  }, [activeCategory, searchQuery]);

  const codeApps = useMemo(() => {
    if (activeCategory !== 'all' && activeCategory !== 'code') return [];
    if (searchQuery.trim()) return [];
    return CONNECTOR_APPS.filter((app) => app.category === 'code' && !app.recommended);
  }, [activeCategory, searchQuery]);

  const connectedList = useMemo(() => {
    return CONNECTOR_APPS.filter((app) => connectedIds.has(app.id));
  }, [connectedIds]);

  if (!isOpen) return null;

  const renderIcon = (app: ConnectorApp) => {
    if (app.iconType === 'slack') {
      return (
        <div className="connector-card-icon" style={{ background: app.iconBg, color: app.iconColor }}>
          <MessageSquare size={18} strokeWidth={2.2} />
        </div>
      );
    }
    if (app.iconType === '1password') {
      return (
        <div className="connector-card-icon" style={{ background: app.iconBg, color: app.iconColor }}>
          <KeyRound size={18} strokeWidth={2.2} />
        </div>
      );
    }
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
    if (app.iconType === 'atlassian') {
      return (
        <div className="connector-card-icon" style={{ background: app.iconBg, color: app.iconColor }}>
          <Layers size={18} strokeWidth={2.2} />
        </div>
      );
    }
    if (app.iconType === 'github') {
      return (
        <div className="connector-card-icon" style={{ background: app.iconBg, color: app.iconColor }}>
          <GitBranch size={18} strokeWidth={2.2} />
        </div>
      );
    }
    if (app.iconType === 'unity') {
      return (
        <div className="connector-card-icon" style={{ background: app.iconBg, color: app.iconColor }}>
          <Database size={18} strokeWidth={2.2} />
        </div>
      );
    }

    return (
      <div
        className="connector-card-icon connector-card-icon-letter"
        style={{ background: app.iconBg, color: app.iconColor }}
      >
        <span>{app.iconLetter ?? app.name.charAt(0)}</span>
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
            <span className="connector-card-name">{app.name}</span>
            <span className="connector-card-desc">{app.description}</span>
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
            Conectar aplicativos
          </h2>
          <div className="connectors-header-right">
            <div className="connectors-badge" title={`${connectedIds.size} aplicativos conectados`}>
              <div className="connectors-badge-avatars">
                {connectedList.slice(0, 3).map((app) => (
                  <span
                    key={app.id}
                    className="connectors-badge-dot"
                    style={{ background: app.iconBg, color: app.iconColor }}
                  >
                    {app.iconLetter ?? app.name.charAt(0)}
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
              placeholder="Buscar em aplicativos e habilidades"
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
                  {filteredApps.length} {filteredApps.length === 1 ? 'aplicativo' : 'aplicativos'}
                </span>
              </div>
              {filteredApps.length === 0 ? (
                <div className="connectors-empty">
                  <p>Nenhum aplicativo encontrado.</p>
                </div>
              ) : (
                <div className="connectors-grid">{filteredApps.map(renderCard)}</div>
              )}
            </div>
          ) : (
            <>
              {/* Recommended Section */}
              {recommendedApps.length > 0 ? (
                <div className="connectors-section">
                  <div className="connectors-section-header">
                    <span className="connectors-section-title">Recomendados para você</span>
                    <button
                      type="button"
                      className="connectors-section-link"
                      onClick={() => setActiveCategory('productivity')}
                    >
                      Ver tudo
                    </button>
                  </div>
                  <div className="connectors-grid">{recommendedApps.map(renderCard)}</div>
                </div>
              ) : null}

              {/* Password Managers Section */}
              {passwordManagerApps.length > 0 ? (
                <div className="connectors-section">
                  <div className="connectors-section-header">
                    <span className="connectors-section-title">Gerenciadores de senha</span>
                  </div>
                  <div className="connectors-grid">{passwordManagerApps.map(renderCard)}</div>
                </div>
              ) : null}

              {/* Productivity Section */}
              {productivityApps.length > 0 ? (
                <div className="connectors-section">
                  <div className="connectors-section-header">
                    <span className="connectors-section-title">Produtividade</span>
                    <button
                      type="button"
                      className="connectors-section-link"
                      onClick={() => setActiveCategory('productivity')}
                    >
                      Ver tudo
                    </button>
                  </div>
                  <div className="connectors-grid">{productivityApps.map(renderCard)}</div>
                </div>
              ) : null}

              {/* Code & Lakehouse Section */}
              {codeApps.length > 0 ? (
                <div className="connectors-section">
                  <div className="connectors-section-header">
                    <span className="connectors-section-title">Código & Lakehouse</span>
                    <button
                      type="button"
                      className="connectors-section-link"
                      onClick={() => setActiveCategory('code')}
                    >
                      Ver tudo
                    </button>
                  </div>
                  <div className="connectors-grid">{codeApps.map(renderCard)}</div>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
