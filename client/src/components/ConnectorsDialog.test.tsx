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
    expect(html).toContain('Conectar aplicativos');
    expect(html).toContain('id="connectors-dialog-title"');
    expect(html).toContain('class="connectors-badge"');
    expect(html).toContain('conectados');
  });

  test('renders search input bar with placeholder and autofocus', () => {
    const html = renderToString(
      <ConnectorsDialog isOpen={true} onClose={() => {}} />,
    );
    expect(html).toContain('class="connectors-search-input"');
    expect(html).toContain('placeholder="Buscar em aplicativos e habilidades"');
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

  test('renders all 6 category filter pills with Todos active by default', () => {
    const html = renderToString(
      <ConnectorsDialog isOpen={true} onClose={() => {}} />,
    );
    const expectedCategories = [
      'Todos',
      'Gerenciadores de senha',
      'Produtividade',
      'Comunicação',
      'Código &amp; Lakehouse',
      'Design',
    ];
    for (const label of expectedCategories) {
      expect(html).toContain(label);
    }
    expect(html).toContain('class="connectors-pill is-active"');
  });

  test('renders app cards with icons, names, descriptions, and action buttons', () => {
    const html = renderToString(
      <ConnectorsDialog isOpen={true} onClose={() => {}} />,
    );
    expect(html).toContain('Google Calendar');
    expect(html).toContain('Databricks SQL');
    expect(html).toContain('Databricks One (Genie)');
    expect(html).toContain('1Password');
    expect(html).toContain('Slack');
    expect(html).toContain('GitHub');
    expect(html).toContain('Figma');

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
    expect(CONNECTOR_APPS.length).toBeGreaterThanOrEqual(14);
    const ids = new Set<string>();
    for (const app of CONNECTOR_APPS) {
      expect(app.id).toBeTruthy();
      expect(ids.has(app.id)).toBe(false);
      ids.add(app.id);
      expect(app.name).toBeTruthy();
      expect(app.category).toBeTruthy();
      expect(app.categoryLabel).toBeTruthy();
      expect(app.description).toBeTruthy();
      expect(app.iconBg).toBeTruthy();
      expect(app.iconColor).toBeTruthy();
    }
  });
});
