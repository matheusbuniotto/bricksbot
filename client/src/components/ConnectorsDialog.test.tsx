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

  test('renders title and connected badge in English', () => {
    const html = renderToString(
      <ConnectorsDialog isOpen={true} onClose={() => {}} />,
    );
    expect(html).toContain('Connect Applications (MCPs)');
    expect(html).toContain('id="connectors-dialog-title"');
    expect(html).toContain('class="connectors-badge"');
    expect(html).toContain('connected');
  });

  test('renders search input bar with placeholder and autofocus', () => {
    const html = renderToString(
      <ConnectorsDialog isOpen={true} onClose={() => {}} />,
    );
    expect(html).toContain('class="connectors-search-input"');
    expect(html).toContain('placeholder="Search MCPs, tools, and Databricks connectors..."');
    expect(html).not.toContain('class="connectors-search-clear"');
  });

  test('renders Bot Templates button only when onOpenMarketplace is passed', () => {
    const withoutMarketplace = renderToString(
      <ConnectorsDialog isOpen={true} onClose={() => {}} />,
    );
    expect(withoutMarketplace).not.toContain('Bot Templates');

    const withMarketplace = renderToString(
      <ConnectorsDialog isOpen={true} onClose={() => {}} onOpenMarketplace={() => {}} />,
    );
    expect(withMarketplace).toContain('Bot Templates');
    expect(withMarketplace).toContain('class="connectors-marketplace-btn"');
    expect(withMarketplace).toContain('class="connectors-marketplace-dot"');
  });

  test('renders category filter pills in English', () => {
    const html = renderToString(
      <ConnectorsDialog isOpen={true} onClose={() => {}} />,
    );
    const expectedCategories = [
      'All',
      'Lakehouse &amp; Analytics',
      'Communication',
      'Productivity',
      'Code &amp; Execution',
      'Web Search',
      'Custom',
    ];
    for (const label of expectedCategories) {
      expect(html).toContain(label);
    }
    expect(html).toContain('class="connectors-pill is-active"');
  });

  test('renders only viable Databricks MCPs and excludes non-viable mockup MCPs', () => {
    const html = renderToString(
      <ConnectorsDialog isOpen={true} onClose={() => {}} />,
    );
    expect(html).toContain('System MCPs (Unity AI Gateway)');
    expect(html).toContain('Databricks One (Genie)');
    expect(html).toContain('Databricks SQL');
    expect(html).toContain('Databricks Web Search');
    expect(html).toContain('Databricks Code Sandbox');

    expect(html).toContain('system.ai.genie_one_mcp');
    expect(html).toContain('system.ai.dbsql');
    expect(html).toContain('system.ai.web_search');
    expect(html).toContain('system.ai.sandbox');

    expect(html).not.toContain('system.ai.confluence');
    expect(html).not.toContain('system.ai.jira');

    expect(html).toContain('class="connector-action-btn is-connected"');
    expect(html).toContain('Connected');
  });

  test('renders close button with accessibility label in English', () => {
    const html = renderToString(
      <ConnectorsDialog isOpen={true} onClose={() => {}} />,
    );
    expect(html).toContain('aria-label="Close"');
    expect(html).toContain('class="dialog-close-btn"');
  });

  test('renders progressive disclosure elements: card details buttons, expand all, and pill count badges', () => {
    const html = renderToString(
      <ConnectorsDialog isOpen={true} onClose={() => {}} />,
    );
    expect(html).toContain('class="connector-expand-btn"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('Details');
    expect(html).toContain('Expand all');
    expect(html).toContain('class="connectors-pill-count"');
    expect(html).toContain('class="connector-source-badge is-system"');
    expect(html).toContain('System');
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
