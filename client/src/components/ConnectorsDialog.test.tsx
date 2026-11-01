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
    expect(html).toContain('placeholder="Buscar em MCPs e ferramentas do Databricks"');
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

  test('renders category filter pills for Databricks MCPs with Todos active by default', () => {
    const html = renderToString(
      <ConnectorsDialog isOpen={true} onClose={() => {}} />,
    );
    const expectedCategories = [
      'Todos',
      'Lakehouse &amp; Análise',
      'Busca Web',
      'Código &amp; Execução',
    ];
    for (const label of expectedCategories) {
      expect(html).toContain(label);
    }
    expect(html).toContain('class="connectors-pill is-active"');
    // Ensure no placeholder categories
    expect(html).not.toContain('Gerenciadores de senha');
    expect(html).not.toContain('Produtividade');
    expect(html).not.toContain('Design');
  });

  test('renders ONLY available Databricks MCPs and excludes placeholder apps', () => {
    const html = renderToString(
      <ConnectorsDialog isOpen={true} onClose={() => {}} />,
    );
    // Real available Databricks MCPs
    expect(html).toContain('Databricks One (Genie)');
    expect(html).toContain('Databricks SQL');
    expect(html).toContain('Databricks Web Search');
    expect(html).toContain('Databricks Code Sandbox');

    // Service badges
    expect(html).toContain('system.ai.genie_one_mcp');
    expect(html).toContain('system.ai.dbsql');
    expect(html).toContain('system.ai.web_search');
    expect(html).toContain('system.ai.sandbox');

    // Placeholders MUST NOT be present
    expect(html).not.toContain('1Password');
    expect(html).not.toContain('Google Calendar');
    expect(html).not.toContain('Slack');
    expect(html).not.toContain('Granola');
    expect(html).not.toContain('Outlook');
    expect(html).not.toContain('Notion');
    expect(html).not.toContain('Atlassian');
    expect(html).not.toContain('Figma');
    expect(html).not.toContain('GitHub');
    expect(html).not.toContain('Docs Canvas');

    expect(html).toContain('class="connector-action-btn is-connected"');
    expect(html).toContain('Conectado');
    expect(html).toContain('class="connector-action-btn"');
    expect(html).toContain('Conectar');
  });

  test('renders close button with accessibility label', () => {
    const html = renderToString(
      <ConnectorsDialog isOpen={true} onClose={() => {}} />,
    );
    expect(html).toContain('aria-label="Fechar"');
    expect(html).toContain('class="dialog-close-btn"');
  });

  test('validates CONNECTOR_APPS catalog structure integrity', () => {
    expect(CONNECTOR_APPS.length).toBe(4);
    const ids = new Set<string>();
    for (const app of CONNECTOR_APPS) {
      expect(app.id).toBeTruthy();
      expect(ids.has(app.id)).toBe(false);
      ids.add(app.id);
      expect(app.name).toBeTruthy();
      expect(app.service).toMatch(/^system\.ai\./);
      expect(app.category).toBeTruthy();
      expect(app.categoryLabel).toBeTruthy();
      expect(app.description).toBeTruthy();
      expect(app.tools.length).toBeGreaterThan(0);
      expect(app.iconBg).toBeTruthy();
      expect(app.iconColor).toBeTruthy();
    }
  });
});
