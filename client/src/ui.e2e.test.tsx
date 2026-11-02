import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { ConnectorsDialog } from './components/ConnectorsDialog';
import { SpaceMembersDialog } from './components/SpaceMembersDialog';
import { BotDetailsSheet } from './components/BotDetailsSheet';
import { BotRoster } from './components/BotRoster';
import { BotPicker } from './components/BotPicker';
import { DEFAULT_BOT } from './components/bricksbot-avatar';
import { presenceTooltip, rosterPreviewForPresence } from './lib/user-facing';
import { McpDiscoveryService } from '../../server/agents/tools/mcp-discovery';
import type { Bot, Space } from '../../shared/chat/types';
import type { ArtifactPinNotice } from '../../shared/chat/artifact-pin-notice';

describe('UI End-to-End Tests', () => {
  const dummySpace: Space = {
    id: 'space-1',
    name: 'Personal',
    ownerId: 'user-1',
    createdAt: new Date().toISOString(),
  };

  const dummyBot: Bot = {
    id: 'bot-1',
    name: 'FinOps Analyst',
    spaceId: 'space-1',
    ownerId: 'user-1',
    avatarLabel: '1.2.0.0',
    description: 'Specialist in cloud cost analysis',
    isPrimary: false,
    isShared: true,
    presence: 'online',
    sortOrder: 0,
    archivedAt: null,
    createdAt: new Date().toISOString(),
  };

  it('verifies SpaceMembersDialog renders invite copy for a space', () => {
    const html = renderToString(<SpaceMembersDialog space={dummySpace} isOpen={true} onClose={() => {}} />);
    expect(html).toContain('Members —');
    expect(html).toContain('Personal');
    expect(html).toContain('Invite teammates by Databricks user email');
    expect(html).toContain('aria-label="Close"');
  });

  it('verifies ConnectorsDialog E2E: renders only viable MCPs with English defaults', () => {
    const html = renderToString(<ConnectorsDialog isOpen={true} onClose={() => {}} onOpenMarketplace={() => {}} />);

    expect(html).toContain('Connect Applications');
    expect(html).toContain('connected');

    expect(html).toContain('placeholder="Search apps and skills"');
    expect(html).toContain('aria-label="Refresh connectors"');
    expect(html).toContain('aria-label="Add MCP"');
    expect(html).toContain('Bot Templates');
    expect(html).not.toContain('AI Gateway MCP');

    expect(html).toContain('>All<');
    expect(html).toContain('>Lakehouse<');
    expect(html).toContain('>Communication<');
    expect(html).toContain('>Productivity<');
    expect(html).toContain('>Code<');
    expect(html).toContain('>Search<');
    expect(html).toContain('>Custom<');

    expect(html).toContain('Recommended for you');
    expect(html).toContain('Databricks One (Genie)');
    expect(html).toContain('Databricks SQL');
    expect(html).toContain('Databricks Web Search');
    expect(html).toContain('Databricks Code Sandbox');

    expect(html).not.toContain('System MCPs');
    expect(html).not.toContain('Details');
    expect(html).not.toContain('system.ai.slack');
    expect(html).not.toContain('system.ai.confluence');
    expect(html).not.toContain('system.ai.jira');
    expect(html).not.toContain('system.ai.github');

    expect(html).toContain('Connected');
    expect(html).toContain('aria-label="Close"');
  });

  it('verifies dynamic MCP addition and removal E2E through discovery service and UI catalog', async () => {
    const fakeTools: Record<string, string[]> = {
      'system.ai.genie_one_mcp': ['genie_ask'],
      'system.ai.dbsql': ['execute_sql'],
    };

    const mockFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.includes('/api/2.1/unity-catalog/mcp-services')) {
        return new Response(
          JSON.stringify({
            mcp_services: Object.keys(fakeTools).map((service) => ({
              name: service.split('.').pop()!,
              full_name: service,
            })),
          }),
          { status: 200 }
        );
      }

      if (url.includes('/ai-gateway/mcp-services/')) {
        const bodyStr = init?.body ? String(init.body) : '{}';
        const parsed = JSON.parse(bodyStr);
        const match = url.match(/\/ai-gateway\/mcp-services\/([^?]+)/);
        const service = match ? decodeURIComponent(match[1]) : '';

        if (service in fakeTools) {
          return new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: parsed.id ?? 1,
              result: { tools: fakeTools[service].map((name) => ({ name })) },
            }),
            { status: 200 }
          );
        }
        return new Response('Not Found', { status: 404 });
      }

      return new Response('Not Found', { status: 404 });
    };

    const discovery = new McpDiscoveryService({
      host: 'https://test-workspace.databricks.com',
      getToken: async () => 'test-token',
      fetchImpl: mockFetch as typeof fetch,
      cacheTtlMs: 10,
    });

    const initial = await discovery.listViableMcps({ refresh: true });
    expect(initial.map((m) => m.service)).toEqual(['system.ai.genie_one_mcp', 'system.ai.dbsql']);

    fakeTools['system.ai.slack'] = ['search_messages', 'read_channel'];
    const afterAdd = await discovery.listViableMcps({ refresh: true });
    expect(afterAdd.map((m) => m.service)).toContain('system.ai.slack');
    const slack = afterAdd.find((m) => m.service === 'system.ai.slack');
    expect(slack?.tools).toEqual(['search_messages', 'read_channel']);
    expect(slack?.isViable).toBe(true);

    delete fakeTools['system.ai.dbsql'];
    const afterRemove = await discovery.listViableMcps({ refresh: true });
    expect(afterRemove.map((m) => m.service)).not.toContain('system.ai.dbsql');
    expect(afterRemove.map((m) => m.service)).toContain('system.ai.slack');
  });

  it('verifies BotRoster E2E: create bot, marketplace, change look in English', () => {
    const html = renderToString(
      <BotRoster
        spaces={[dummySpace]}
        bots={[dummyBot]}
        archivedBots={[]}
        previews={{}}
        theme="light"
        onThemeChange={() => {}}
        onCreateSpace={async () => 'space-new'}
        selectedBotId="bot-1"
        onSelectBot={() => {}}
        onCreateBot={() => {}}
        onRenameBot={() => {}}
        onChangeLook={() => {}}
        onArchiveBot={() => {}}
        onUnarchiveBot={() => {}}
        onDeleteBot={() => {}}
        onMoveBot={() => {}}
        createOpen={true}
        onCreateOpenChange={() => {}}
        marketplaceOpen={true}
        onMarketplaceOpenChange={() => {}}
      />
    );

    expect(html).toContain('Create new Bot');
    expect(html).toContain('placeholder="Name your Bot"');
    expect(html).toContain('aria-label="Name your Bot"');
    expect(html).toContain('Bot instructions (optional)');
    expect(html).toContain('placeholder="Define the bot&#x27;s role, rules, or persona"');
    expect(html).toContain('Explore Bot Marketplace →');
    expect(html).toContain('Cancel');
    expect(html).toContain('Create');

    expect(html).toContain('Bot Marketplace');
    expect(html).toContain(
      'Bots are personal by default. When using a Marketplace Bot, you receive its behavior, instructions, and skills in a 100% private chat.'
    );
    expect(html).toContain('Add to section:');
    expect(html).toContain('No bots published to the Marketplace yet.');
    expect(html).toContain(
      'Share one of your bots from the actions menu or details sheet to make it available to teammates.'
    );
  });

  it('verifies BotDetailsSheet E2E: English tabs, library empty/recent/older sections, and change look', () => {
    const noticeRecent: ArtifactPinNotice = {
      kind: 'artifact_pin',
      title: 'Q3_Cost_Summary.csv',
      body: 'cost,dbu\n100,20',
      artifactKind: 'table',
      pinnedByBotId: 'bot-1',
      pinnedByName: 'FinOps Analyst',
    };

    const messages = [
      {
        id: 'msg-1',
        chatId: 'chat-1',
        role: 'system' as const,
        content: JSON.stringify(noticeRecent),
        createdAt: new Date().toISOString(),
      },
    ];

    const htmlDetails = renderToString(
      <BotDetailsSheet
        bot={dummyBot}
        messages={[]}
        routines={[]}
        routineBusyId={null}
        lastWebhookSecret={null}
        autoApprovedTools={[]}
        onRevokeAutoApproval={async () => {}}
        width={360}
        minWidth={280}
        maxWidth={720}
        onWidthChange={() => {}}
        onCreateRoutine={async () => {}}
        onUpdateRoutine={async () => {}}
        onRunRoutine={async () => {}}
        onDeleteRoutine={async () => {}}
        onClose={() => {}}
        onChangeLook={() => {}}
        onUpdateBotConfig={async () => {}}
      />
    );

    expect(htmlDetails).toContain('Details');
    expect(htmlDetails).toContain('Library');
    expect(htmlDetails).toContain('Computer');
    expect(htmlDetails).toContain('Marketplace &amp; Behavior');
    expect(htmlDetails).toContain('Share in Marketplace');
    expect(htmlDetails).toContain('Published in Marketplace (behavior and skills visible to other users)');
    expect(htmlDetails).toContain('Bot Instructions');
    expect(htmlDetails).toContain('placeholder="Instructions or durable role for this bot..."');
    expect(htmlDetails).toContain('Messages, history, approvals, and memories are 100% private per user.');
    expect(htmlDetails).toContain('Permissions');
    expect(htmlDetails).not.toContain('Nothing is auto-approved yet.');

    const htmlApprovals = renderToString(
      <BotDetailsSheet
        bot={dummyBot}
        messages={[]}
        routines={[]}
        routineBusyId={null}
        lastWebhookSecret={null}
        autoApprovedTools={['lakehouse_catalog', 'sql_query']}
        onRevokeAutoApproval={async () => {}}
        onOpenConnectors={() => {}}
        initialTab="permissions"
        width={360}
        minWidth={280}
        maxWidth={720}
        onWidthChange={() => {}}
        onCreateRoutine={async () => {}}
        onUpdateRoutine={async () => {}}
        onRunRoutine={async () => {}}
        onDeleteRoutine={async () => {}}
        onClose={() => {}}
        onChangeLook={() => {}}
        onUpdateBotConfig={async () => {}}
      />
    );
    expect(htmlApprovals).toContain('Permissions');
    expect(htmlApprovals).toContain('Tool permissions');
    expect(htmlApprovals).toContain('Connections');
    expect(htmlApprovals).toContain('Catalog browse');
    expect(htmlApprovals).toContain('SQL query');
    expect(htmlApprovals).toContain('Clear all');
    expect(htmlApprovals).toContain('Revoke');
    expect(htmlApprovals).toContain('Manage connectors');

    const htmlLibrary = renderToString(
      <BotDetailsSheet
        bot={dummyBot}
        messages={messages}
        routines={[]}
        routineBusyId={null}
        lastWebhookSecret={null}
        width={360}
        minWidth={280}
        maxWidth={720}
        onWidthChange={() => {}}
        onCreateRoutine={async () => {}}
        onUpdateRoutine={async () => {}}
        onRunRoutine={async () => {}}
        onDeleteRoutine={async () => {}}
        onClose={() => {}}
        onChangeLook={() => {}}
      />
    );
    expect(htmlLibrary).toContain('Details');
    expect(htmlLibrary).toContain('Library');
  });

  it('verifies BotPicker accessory chip labels and presence tooltips in English', () => {
    const htmlPicker = renderToString(<BotPicker value={DEFAULT_BOT} onChange={() => {}} />);

    expect(htmlPicker).toContain('aria-label="Shape"');
    expect(htmlPicker).toContain('aria-label="Color"');
    expect(htmlPicker).toContain('Hat');
    expect(htmlPicker).toContain('aria-label="Hat"');
    expect(htmlPicker).toContain('Glasses');
    expect(htmlPicker).toContain('aria-label="Glasses"');
    expect(htmlPicker).toContain('<span>None</span>');

    expect(presenceTooltip('waiting')).toBe('Waiting for approval');
    expect(presenceTooltip('blocked')).toBe('Needs you');
    expect(presenceTooltip('thinking')).toBe('Thinking…');
    expect(presenceTooltip('working')).toBe('Running…');
    expect(presenceTooltip('away')).toBe('Away');
    expect(presenceTooltip('offline')).toBe('Offline');
    expect(presenceTooltip('online')).toBe('Online');

    expect(rosterPreviewForPresence('waiting', 'Running SQL')).toBe('Waiting: Running SQL');
    expect(rosterPreviewForPresence('waiting', '')).toBe('Waiting:');
    expect(rosterPreviewForPresence('blocked', 'Confirm drop')).toBe('Needs you: Confirm drop');
    expect(rosterPreviewForPresence('thinking', '')).toBe('Thinking…');
    expect(rosterPreviewForPresence('working', '')).toBe('Running…');
  });
});
