import { describe, expect, test } from 'vitest';
import { renderToString } from 'react-dom/server';
import { ConnectorsDialog, CONNECTOR_APPS } from './ConnectorsDialog';

describe('ConnectorsDialog Component', () => {
  test('renders nothing when isOpen is false', () => {
    const html = renderToString(
      <ConnectorsDialog isOpen={false} onClose={() => {}} />,
    );
    expect(html).toBe('');
  });

  test('renders dialog container with accessibility attributes when open', () => {
    const html = renderToString(
      <ConnectorsDialog isOpen={true} onClose={() => {}} />,
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-labelledby="connectors-dialog-title"');
    expect(html).toContain('class="dialog connectors-dialog"');
    expect(html).toContain('class="dialog-backdrop"');
  });

  test('renders title and connected badge', () => {
    const html = renderToString(
      <ConnectorsDialog isOpen={true} onClose={() => {}} />,
    );
    expect(html).toContain('Conectar aplicativos (MCPs)');
    expect(html).toContain('id="connectors-dialog-title"');
    expect(html).toContain('class="connectors-badge"');
    expect(html).toContain('conectados');
  });

  test('renders search input bar with placeholder and autofocus', () => {
    const html = renderToString(
      <ConnectorsDialog isOpen={true} onClose={() => {}} />,
    );
    expect(html).toContain('class="connectors-search-input"');
    expect(html).toContain('placeholder="Buscar em MCPs, ferramentas e conectores do Databricks"');
    expect(html).not.toContain('class="connectors-search-clear"');
  });

  test('renders Modelos de Bots button only when onOpenMarketplace is passed', () => {
    const withoutMarketplace = renderToString(
      <ConnectorsDialog isOpen={true} onClose={() => {}} />,
    );
    expect(withoutMarketplace).not.toContain('Modelos de Bots');

    const withMarketplace = renderToString(
      <ConnectorsDialog isOpen={true} onClose={() => {}} onOpenMarketplace={() => {}} />,
    );
    expect(withMarketplace).toContain('Modelos de Bots');
    expect(withMarketplace).toContain('class="connectors-marketplace-btn"');
    expect(withMarketplace).toContain('class="connectors-marketplace-dot"');
  });

  test('renders category filter pills including Comunicação and Produtividade', () => {
    const html = renderToString(
      <ConnectorsDialog isOpen={true} onClose={() => {}} />,
    );
    const expectedCategories = [
      'Todos',
      'Lakehouse &amp; Análise',
      'Comunicação',
      'Produtividade',
      'Código &amp; Execução',
      'Busca Web',
    ];
    for (const label of expectedCategories) {
      expect(html).toContain(label);
    }
    expect(html).toContain('class="connectors-pill is-active"');
  });

  test('renders active Databricks MCPs with interactive connect buttons', () => {
    const html = renderToString(
      <ConnectorsDialog isOpen={true} onClose={() => {}} />,
    );
    expect(html).toContain('MCPs Ativos no Databricks');
    expect(html).toContain('Databricks One (Genie)');
    expect(html).toContain('Databricks SQL');
    expect(html).toContain('Databricks Web Search');
    expect(html).toContain('Databricks Code Sandbox');

    expect(html).toContain('system.ai.genie_one_mcp');
    expect(html).toContain('system.ai.dbsql');
    expect(html).toContain('system.ai.web_search');
    expect(html).toContain('system.ai.sandbox');

    expect(html).toContain('class="connector-action-btn is-connected"');
    expect(html).toContain('Conectado');
  });

  test('renders inactive corporate connectors directed to Databricks One (Genie)', () => {
    const html = renderToString(
      <ConnectorsDialog isOpen={true} onClose={() => {}} />,
    );
    expect(html).toContain('Conectores Corporativos (via Databricks One)');
    expect(html).toContain('Slack');
    expect(html).toContain('Confluence');
    expect(html).toContain('Jira Software');
    expect(html).toContain('GitHub');
    expect(html).toContain('Notion');
    expect(html).toContain('Google Drive');
    expect(html).toContain('Microsoft 365');

    // Badges indicating Genie One requirement
    expect(html).toContain('Requer Databricks One');
    expect(html).toContain('is-genie-link');
    expect(html).toContain('Conectar via Genie');
    expect(html).toContain('https://dbc-562d9321-2592.cloud.databricks.com/genie');
  });

  test('renders close button with accessibility label', () => {
    const html = renderToString(
      <ConnectorsDialog isOpen={true} onClose={() => {}} />,
    );
    expect(html).toContain('aria-label="Fechar"');
    expect(html).toContain('class="dialog-close-btn"');
  });

  test('validates CONNECTOR_APPS catalog structure integrity', () => {
    expect(CONNECTOR_APPS.length).toBe(11);
    const ids = new Set<string>();
    for (const app of CONNECTOR_APPS) {
      expect(app.id).toBeTruthy();
      expect(ids.has(app.id)).toBe(false);
      ids.add(app.id);
      expect(app.name).toBeTruthy();
      expect(app.service).toBeTruthy();
      expect(app.category).toBeTruthy();
      expect(app.categoryLabel).toBeTruthy();
      expect(app.description).toBeTruthy();
      expect(app.tools.length).toBeGreaterThan(0);
      expect(app.iconBg).toBeTruthy();
      expect(app.iconColor).toBeTruthy();
      expect(['active', 'inactive']).toContain(app.status);
    }
  });
});
