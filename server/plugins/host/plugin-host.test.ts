import { describe, expect, test } from 'vitest';
import type {
  BricksbotPlugin,
  PluginExecutionContext,
  PluginPromptContext,
  PluginTurnContext,
} from '../../../shared/plugins/types.js';
import type { HandoffTurnContext } from '../../agents/handoff.js';
import { PluginHost } from './plugin-host.js';

function createMockExecutionContext(overrides?: Partial<PluginExecutionContext>): PluginExecutionContext {
  return {
    chatId: 'chat_123',
    botId: 'bot_abc',
    userId: 'user_456',
    host: 'https://test.databricks.com',
    log: {
      info: () => {},
      warn: () => {},
      error: () => {},
    },
    ...overrides,
  };
}

describe('PluginHost', () => {
  describe('Plugin registration', () => {
    test('registers plugin object with tools, prompt sections, and hooks', async () => {
      const host = new PluginHost();
      const plugin: BricksbotPlugin = {
        metadata: {
          name: 'audit-plugin',
          version: '1.0.0',
          description: 'Audit and compliance plugin',
        },
        tools: [
          {
            name: 'audit_log',
            description: 'Write an audit event',
            parameters: { type: 'object', properties: { event: { type: 'string' } } },
            execute: (args) => Promise.resolve(`Logged: ${String(args.event)}`),
          },
        ],
        promptSections: [
          {
            name: 'audit-reminder',
            render: () => 'All actions are audited.',
          },
        ],
      };

      await host.registerPlugin(plugin);

      const tools = host.getRegisteredTools();
      expect(tools).toHaveLength(1);
      expect(tools[0].definition.name).toBe('audit_log');
      expect(tools[0].askFirst).toBe(true);
      expect(tools[0].neverAlwaysAllow).toBe(false);

      const sections = host.getPromptSections();
      expect(sections).toHaveLength(1);
      expect(sections[0].name).toBe('audit-reminder');

      const handoffCtx: HandoffTurnContext = { chatId: 'chat_1', bot: null };
      const output = await tools[0].execute({ event: 'test-event' }, handoffCtx);
      expect(output).toBe('Logged: test-event');
    });

    test('registers plugin via initializer function and BricksbotPluginAPI', async () => {
      const host = new PluginHost();

      await host.registerPlugin(
        (api) => {
          expect(api.metadata.name).toBe('custom-connector');
          api.registerTool({
            name: 'connector_query',
            description: 'Query external connector',
            parameters: { type: 'object' },
            annotations: { readOnly: true },
            execute: () => Promise.resolve('Connector result'),
          });
          api.registerPromptSection({
            name: 'connector-guidelines',
            render: () => 'Connector active.',
          });
        },
        {
          name: 'custom-connector',
          version: '2.1.0',
          description: 'External connector plugin',
        }
      );

      const tools = host.getRegisteredTools();
      expect(tools).toHaveLength(1);
      expect(tools[0].definition.name).toBe('connector_query');
      expect(tools[0].askFirst).toBe(false);

      const sections = host.getPromptSections();
      expect(sections).toHaveLength(1);
      expect(sections[0].name).toBe('connector-guidelines');
    });
  });

  describe('Boundary validation', () => {
    test('rejects missing metadata', async () => {
      const host = new PluginHost();
      await expect(host.registerPlugin({} as unknown as BricksbotPlugin)).rejects.toThrow(
        'Plugin metadata is required'
      );
    });

    test('rejects missing or empty metadata name and version', async () => {
      const host = new PluginHost();
      await expect(
        host.registerPlugin({
          metadata: { name: '', version: '1.0.0', description: 'desc' },
        })
      ).rejects.toThrow('Plugin metadata.name must be a non-empty string');

      await expect(
        host.registerPlugin({
          metadata: { name: 'test-plugin', version: '', description: 'desc' },
        })
      ).rejects.toThrow('Plugin metadata.version must be a non-empty string');
    });

    test('rejects initializer function without metadata', async () => {
      const host = new PluginHost();
      await expect(host.registerPlugin(() => {})).rejects.toThrow(
        'Plugin metadata is required when registering a PluginInitializer'
      );
    });

    test('rejects tool without name or execute function', async () => {
      const host = new PluginHost();

      await expect(
        host.registerPlugin({
          metadata: { name: 'invalid-tool-plugin', version: '1.0.0', description: 'test' },
          tools: [{ name: '', description: 'test', parameters: {}, execute: () => Promise.resolve('') }],
        })
      ).rejects.toThrow('Tool definition must have a non-empty name');

      await expect(
        host.registerPlugin({
          metadata: { name: 'invalid-tool-plugin', version: '1.0.0', description: 'test' },
          tools: [
            {
              name: 'broken_tool',
              description: 'test',
              parameters: {},
            } as unknown as BricksbotPlugin['tools'] extends Array<infer T> ? T : never,
          ],
        })
      ).rejects.toThrow('Tool "broken_tool" must have an execute function');
    });

    test('rejects duplicate tool names across plugins', async () => {
      const host = new PluginHost();
      const toolDef = {
        name: 'shared_tool',
        description: 'First definition',
        parameters: {},
        execute: () => Promise.resolve('one'),
      };

      await host.registerPlugin({
        metadata: { name: 'plugin-one', version: '1.0.0', description: 'first' },
        tools: [toolDef],
      });

      await expect(
        host.registerPlugin({
          metadata: { name: 'plugin-two', version: '1.0.0', description: 'second' },
          tools: [{ ...toolDef, description: 'Second definition' }],
        })
      ).rejects.toThrow('Tool "shared_tool" is already registered');
    });

    test('rejects prompt section without name or render function', async () => {
      const host = new PluginHost();

      await expect(
        host.registerPlugin({
          metadata: { name: 'invalid-section', version: '1.0.0', description: 'test' },
          promptSections: [{ name: '', render: () => 'ok' }],
        })
      ).rejects.toThrow('Prompt section must have a non-empty name');

      await expect(
        host.registerPlugin({
          metadata: { name: 'invalid-section', version: '1.0.0', description: 'test' },
          promptSections: [
            {
              name: 'broken_section',
            } as unknown as BricksbotPlugin['promptSections'] extends Array<infer T> ? T : never,
          ],
        })
      ).rejects.toThrow('Prompt section "broken_section" must have a render function');
    });
  });

  describe('Ask-first default and permission flags', () => {
    test('defaults to askFirst true for standard external tools', async () => {
      const host = new PluginHost();
      await host.registerPlugin({
        metadata: { name: 'erp-plugin', version: '1.0.0', description: 'ERP tools' },
        tools: [
          {
            name: 'update_invoice',
            description: 'Update ERP invoice',
            parameters: {},
            execute: () => Promise.resolve('updated'),
          },
        ],
      });

      expect(host.isAskFirst('update_invoice')).toBe(true);
      expect(host.requiresAlwaysAsk('update_invoice')).toBe(false);
    });

    test('sets askFirst false when annotations.readOnly is true', async () => {
      const host = new PluginHost();
      await host.registerPlugin({
        metadata: { name: 'reporting-plugin', version: '1.0.0', description: 'Reporting tools' },
        tools: [
          {
            name: 'read_report',
            description: 'Read ERP report',
            parameters: {},
            annotations: { readOnly: true },
            execute: () => Promise.resolve('report data'),
          },
        ],
      });

      expect(host.isAskFirst('read_report')).toBe(false);
    });

    test('honors explicit askFirst overrides and neverAlwaysAllow', async () => {
      const host = new PluginHost();
      await host.registerPlugin({
        metadata: { name: 'governance-plugin', version: '1.0.0', description: 'Governance' },
        tools: [
          {
            name: 'read_with_strict_ask',
            description: 'Read sensitive data',
            parameters: {},
            annotations: { readOnly: true },
            askFirst: true,
            execute: () => Promise.resolve('sensitive'),
          },
          {
            name: 'delete_resource',
            description: 'Delete resource',
            parameters: {},
            neverAlwaysAllow: true,
            execute: () => Promise.resolve('deleted'),
          },
        ],
      });

      expect(host.isAskFirst('read_with_strict_ask')).toBe(true);
      expect(host.requiresAlwaysAsk('delete_resource')).toBe(true);
    });
  });

  describe('Hook execution lifecycle', () => {
    test('executes multiple beforeTool hooks and supports argument overrides', async () => {
      const host = new PluginHost();
      const ctx = createMockExecutionContext();

      await host.registerPlugin({
        metadata: { name: 'plugin-a', version: '1.0.0', description: 'A' },
        hooks: {
          beforeTool: (_tool, args) =>
            Promise.resolve({
              overrideArgs: { ...args, sanitized: true },
            }),
        },
      });

      await host.registerPlugin({
        metadata: { name: 'plugin-b', version: '1.0.0', description: 'B' },
        hooks: {
          beforeTool: (_tool, args) => {
            expect(args.sanitized).toBe(true);
            return Promise.resolve({
              overrideArgs: { ...args, tagged: 'plugin-b' },
            });
          },
        },
      });

      const result = await host.executeBeforeTool('any_tool', { query: 'SELECT 1' }, ctx);
      expect(result.block).toBeUndefined();
      expect(result.overrideArgs).toEqual({
        query: 'SELECT 1',
        sanitized: true,
        tagged: 'plugin-b',
      });
    });

    test('halts beforeTool execution when a hook returns block', async () => {
      const host = new PluginHost();
      const ctx = createMockExecutionContext();
      let secondHookRan = false;

      await host.registerPlugin({
        metadata: { name: 'security-guard', version: '1.0.0', description: 'Guard' },
        hooks: {
          beforeTool: () =>
            Promise.resolve({
              block: 'Access denied: parameter contains forbidden pattern',
            }),
        },
      });

      await host.registerPlugin({
        metadata: { name: 'downstream-plugin', version: '1.0.0', description: 'Downstream' },
        hooks: {
          beforeTool: () => {
            secondHookRan = true;
            return Promise.resolve();
          },
        },
      });

      const result = await host.executeBeforeTool('restricted_tool', {}, ctx);
      expect(result.block).toBe('Access denied: parameter contains forbidden pattern');
      expect(secondHookRan).toBe(false);
    });

    test('executes afterTool hooks in sequence to sanitize results', async () => {
      const host = new PluginHost();
      const ctx = createMockExecutionContext();

      await host.registerPlugin({
        metadata: { name: 'token-redactor', version: '1.0.0', description: 'Redactor' },
        hooks: {
          afterTool: (_tool, result) => Promise.resolve(result.replace(/SECRET_\w+/g, '[REDACTED]')),
        },
      });

      await host.registerPlugin({
        metadata: { name: 'audit-wrapper', version: '1.0.0', description: 'Wrapper' },
        hooks: {
          afterTool: (_tool, result) => Promise.resolve(`${result}\n[audited]`),
        },
      });

      const initialResult = 'Connection successful: token=SECRET_xyz123';
      const finalResult = await host.executeAfterTool('connect_tool', initialResult, ctx);
      expect(finalResult).toBe('Connection successful: token=[REDACTED]\n[audited]');
    });

    test('executes beforeTurn and afterTurn hooks', async () => {
      const host = new PluginHost();
      let afterTurnFired = false;

      await host.registerPlugin({
        metadata: { name: 'context-injector', version: '1.0.0', description: 'Injector' },
        hooks: {
          beforeTurn: () =>
            Promise.resolve({
              injectSystemPrompt: 'Security guideline: never output plain credentials.',
            }),
          afterTurn: () => {
            afterTurnFired = true;
            return Promise.resolve();
          },
        },
      });

      const turnCtx: PluginTurnContext = {
        ...createMockExecutionContext(),
        messages: [{ role: 'user', content: 'hello' }],
        model: 'gpt-4o',
      };

      const beforeTurnResult = await host.executeBeforeTurn(turnCtx);
      expect(beforeTurnResult.injectSystemPrompt).toBe('Security guideline: never output plain credentials.');

      await host.executeAfterTurn(turnCtx);
      expect(afterTurnFired).toBe(true);
    });
  });

  describe('Prompt section rendering and truncation', () => {
    test('renders prompt sections and enforces 500 character maximum truncation', async () => {
      const host = new PluginHost();
      const longText = 'A'.repeat(600);

      await host.registerPlugin({
        metadata: { name: 'prompt-contributor', version: '1.0.0', description: 'Prompt' },
        promptSections: [
          {
            name: 'short-section',
            render: () => 'Short concise note.',
          },
          {
            name: 'empty-section',
            render: () => undefined,
          },
          {
            name: 'long-section',
            render: () => longText,
          },
        ],
      });

      const promptCtx: PluginPromptContext = {
        chatId: 'chat_1',
        botId: 'bot_1',
        botName: 'Primary',
        isPrimary: true,
      };

      const sections = await host.renderPromptSections(promptCtx);
      expect(sections).toHaveLength(2);
      expect(sections[0]).toBe('Short concise note.');
      expect(sections[1]).toHaveLength(500);
      expect(sections[1]).toBe('A'.repeat(500));
    });
  });
});
