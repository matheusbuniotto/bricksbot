import { describe, expect, test } from 'vitest';
import { renderToString } from 'react-dom/server';
import { ConnectorsDialog, CONNECTOR_APPS } from './ConnectorsDialog';

describe('ConnectorsDialog Component', () => {
  test('renders nothing when isOpen is false', () => {
    const html = renderToString(<ConnectorsDialog isOpen={false} onClose={() => {}} />);
    expect(html).toBe('');
  });

  test('renders dialog container with accessibility attributes when open', () => {
    const html = renderToString(<ConnectorsDialog isOpen={true} onClose={() => {}} />);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-labelledby="connectors-dialog-title"');
    expect(html).toContain('class="dialog connectors-dialog"');
    expect(html).toContain('class="dialog-backdrop"');
  });

  test('renders title and connected badge in English', () => {
    const html = renderToString(<ConnectorsDialog isOpen={true} onClose={() => {}} />);
    expect(html).toContain('Connect Applications');
    expect(html).toContain('id="connectors-dialog-title"');
    expect(html).toContain('class="connectors-badge"');
    expect(html).toContain('connected');
  });

  test('renders search input bar with placeholder', () => {
    const html = renderToString(<ConnectorsDialog isOpen={true} onClose={() => {}} />);
    expect(html).toContain('class="connectors-search-input"');
    expect(html).toContain('placeholder="Search apps and skills"');
    expect(html).not.toContain('class="connectors-search-clear"');
  });

  test('renders Bot Templates button only when onOpenMarketplace is passed', () => {
    const withoutMarketplace = renderToString(<ConnectorsDialog isOpen={true} onClose={() => {}} />);
    expect(withoutMarketplace).not.toContain('Bot Templates');

    const withMarketplace = renderToString(
      <ConnectorsDialog isOpen={true} onClose={() => {}} onOpenMarketplace={() => {}} />
    );
    expect(withMarketplace).toContain('Bot Templates');
    expect(withMarketplace).toContain('class="connectors-marketplace-btn"');
  });

  test('renders category filter pills in English', () => {
    const html = renderToString(<ConnectorsDialog isOpen={true} onClose={() => {}} />);
    const expectedCategories = ['All', 'Lakehouse', 'Productivity', 'Communication', 'Code', 'Search', 'Custom'];
    for (const label of expectedCategories) {
      expect(html).toContain(`>${label}<`);
    }
    expect(html).toContain('class="connectors-pill is-active"');
  });

  test('renders only viable Databricks MCPs with clean recommended section', () => {
    const html = renderToString(<ConnectorsDialog isOpen={true} onClose={() => {}} />);
    expect(html).toContain('Recommended for you');
    expect(html).toContain('Databricks One (Genie)');
    expect(html).toContain('Databricks SQL');
    expect(html).toContain('Databricks Web Search');
    expect(html).toContain('Databricks Code Sandbox');

    expect(html).not.toContain('System MCPs');
    expect(html).not.toContain('Details');
    expect(html).not.toContain('Expand all');
    expect(html).not.toContain('AI Gateway MCP');
    expect(html).not.toContain('connector-expand-btn');
    expect(html).not.toContain('connector-source-badge');

    // Connected state comes from the server after open; SSR default is disconnected.
    expect(html).toContain('>Connect<');
    expect(html).toContain('connected');
  });

  test('renders close and utility controls with accessibility labels', () => {
    const html = renderToString(<ConnectorsDialog isOpen={true} onClose={() => {}} />);
    expect(html).toContain('aria-label="Close"');
    expect(html).toContain('class="dialog-close-btn"');
    expect(html).toContain('aria-label="Refresh connectors"');
    expect(html).toContain('aria-label="Add MCP"');
  });

  test('validates CONNECTOR_APPS catalog structure integrity', () => {
    expect(CONNECTOR_APPS.length).toBeGreaterThan(0);
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
      expect(app.isViable).toBe(true);
      expect(app.status).toBe('active');
    }
  });
});
