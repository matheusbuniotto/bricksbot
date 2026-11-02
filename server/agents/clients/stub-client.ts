import type { ChatClient, ChatCompletionRequest, ChatCompletionResult } from '../../../shared/agents/types.js';

const DEMO_PINS: Record<string, Record<string, unknown>> = {
  '/demo table': {
    title: 'Top tables by rows',
    kind: 'table',
    body: JSON.stringify({
      columns: ['table', 'rows'],
      rows: [
        ['main.sales.orders', 1204331],
        ['main.sales.customers', 80211],
        ['main.ops.events', 9981200],
      ],
    }),
  },
  '/demo chart': {
    title: 'Orders per month',
    kind: 'chart',
    body: JSON.stringify({
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
      data: {
        values: [
          { month: 'Jul', orders: 120, region: 'BR' },
          { month: 'Aug', orders: 180, region: 'BR' },
          { month: 'Sep', orders: 150, region: 'BR' },
          { month: 'Oct', orders: 240, region: 'BR' },
          { month: 'Jul', orders: 90, region: 'US' },
          { month: 'Aug', orders: 110, region: 'US' },
          { month: 'Sep', orders: 130, region: 'US' },
          { month: 'Oct', orders: 170, region: 'US' },
        ],
      },
      mark: { type: 'line', point: true, tooltip: true },
      encoding: {
        x: { field: 'month', type: 'ordinal', sort: ['Jul', 'Aug', 'Sep', 'Oct'] },
        y: { field: 'orders', type: 'quantitative' },
        color: { field: 'region', type: 'nominal' },
      },
    }),
  },
  '/demo mermaid': {
    title: 'Lakehouse pipeline',
    kind: 'mermaid',
    body: 'flowchart LR\n  Bronze["Bronze (raw)"] --> Silver["Silver (cleaned)"] --> Gold["Gold (orders)"]',
  },
  '/demo sql': {
    title: 'Monthly orders query',
    kind: 'sql',
    body: "SELECT date_trunc('month', created_at) AS month, count(*) AS orders\nFROM main.sales.orders\nGROUP BY 1\nORDER BY 1;",
  },
};

function demoTriggersEnabled(): boolean {
  return process.env.NODE_ENV === 'development' || process.env.BRICKSBOT_DEMO_PINS === '1';
}

/** Fallback when no LLM env is configured — keeps Phase 1 UX working. */
export class StubChatClient implements ChatClient {
  readonly provider = 'stub' as const;

  async complete(request: ChatCompletionRequest): Promise<ChatCompletionResult> {
    const lastUser = [...request.messages].reverse().find((m) => m.role === 'user');
    const text = lastUser?.content?.trim() || '';
    const isFreshUserTurn = request.messages[request.messages.length - 1]?.role === 'user';
    const demo = demoTriggersEnabled() && isFreshUserTurn ? DEMO_PINS[text] : undefined;
    if (demo) {
      return {
        content: 'Pinning a demo artifact.',
        toolCalls: [{ id: `demo-${Date.now()}`, name: 'pin_artifact', arguments: demo }],
      };
    }
    return {
      content:
        `Received: “${text}”. ` +
        `No live model yet — set scope \`bricksbot\` secret \`openrouter-api-key\` ` +
        `or local OPENROUTER_API_KEY / LLM_API_KEY, then redeploy.`,
      toolCalls: [],
    };
  }
}
