import { describe, expect, test } from 'vitest';
import { createGenieSpaceTool, GENIE_SPACE_TOOL_NAME, genieSpaceConfigFromEnv } from './genie-space.js';

const HOST = 'https://test.databricks.com';
const SPACE = '01abc';
const getToken = () => Promise.resolve('obo-token');

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

/** Routes Genie REST calls by method + path suffix and records each request. */
function fakeGenie(routes: Record<string, () => Response>) {
  const calls: Array<{ method: string; url: string; auth: string | null; body?: string }> = [];
  const fetchImpl = ((input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({
      method,
      url,
      auth: new Headers(init?.headers).get('Authorization'),
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    const key = Object.keys(routes).find(
      (route) => `${method} ${url.replace(`${HOST}/api/2.0/genie/spaces/${SPACE}`, '')}` === route
    );
    return Promise.resolve(key ? routes[key]() : json({ message: 'not found' }, 404));
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const completedMessage = {
  status: 'COMPLETED',
  attachments: [
    { attachment_id: 'a1', query: { query: 'SELECT count(*) AS n FROM orders', description: 'Order count' } },
    { attachment_id: 'a2', text: { content: 'There are 42 orders.' } },
  ],
};

describe('genieSpaceConfigFromEnv', () => {
  test('is undefined without a space id, host, or token provider', () => {
    expect(genieSpaceConfigFromEnv({}, { host: HOST, getToken })).toBeUndefined();
    expect(
      genieSpaceConfigFromEnv({ BRICKSBOT_GENIE_SPACE_ID: '__UNSET__' }, { host: HOST, getToken })
    ).toBeUndefined();
    expect(genieSpaceConfigFromEnv({ BRICKSBOT_GENIE_SPACE_ID: SPACE }, { getToken })).toBeUndefined();
  });

  test('returns the space when configured', () => {
    expect(genieSpaceConfigFromEnv({ BRICKSBOT_GENIE_SPACE_ID: ` ${SPACE} ` }, { host: HOST, getToken })).toMatchObject(
      {
        spaceId: SPACE,
        host: HOST,
      }
    );
  });
});

describe('Genie kill switch and daily cap', () => {
  test('BRICKSBOT_GENIE_ENABLED=false removes the tool even with a space id', () => {
    const env = { BRICKSBOT_GENIE_SPACE_ID: SPACE };
    expect(
      genieSpaceConfigFromEnv({ ...env, BRICKSBOT_GENIE_ENABLED: 'false' }, { host: HOST, getToken })
    ).toBeUndefined();
    expect(
      genieSpaceConfigFromEnv({ ...env, BRICKSBOT_GENIE_ENABLED: 'true' }, { host: HOST, getToken })
    ).toBeDefined();
  });

  test('a refused claim stops the call before Genie is contacted', async () => {
    const { calls, fetchImpl } = fakeGenie({});
    const claimed: Array<string | undefined> = [];
    const tool = createGenieSpaceTool({
      spaceId: SPACE,
      host: HOST,
      getToken,
      fetchImpl,
      claimCall: (userId) => {
        claimed.push(userId);
        return Promise.resolve(false);
      },
    });
    const result = await tool.execute({ question: 'How many orders?' }, { userId: 'bob' } as never);
    expect(result).toMatch(/daily Genie limit is used up/);
    expect(claimed).toEqual(['bob']);
    expect(calls).toHaveLength(0);
  });
});

describe('ask_genie_space', () => {
  test('starts a conversation, polls, and returns answer, SQL, rows, and citation as the user', async () => {
    let polls = 0;
    const { calls, fetchImpl } = fakeGenie({
      'POST /start-conversation': () => json({ conversation_id: 'c1', message_id: 'm1' }),
      'GET /conversations/c1/messages/m1': () =>
        polls++ === 0 ? json({ status: 'EXECUTING_QUERY' }) : json(completedMessage),
      'GET /conversations/c1/messages/m1/attachments/a1/query-result': () =>
        json({
          statement_response: {
            manifest: { schema: { columns: [{ name: 'n' }] }, total_row_count: 1 },
            result: { data_array: [['42']] },
          },
        }),
    });
    const tool = createGenieSpaceTool({ spaceId: SPACE, host: HOST, getToken, fetchImpl, pollIntervalMs: 0 });

    const result = JSON.parse(await tool.execute({ question: 'How many orders?' }, {} as never)) as Record<
      string,
      unknown
    >;

    expect(result).toMatchObject({
      conversation_id: 'c1',
      response_id: 'm1',
      status: 'completed',
      answer: 'There are 42 orders.',
      query: 'SELECT count(*) AS n FROM orders',
      columns: ['n'],
      rows: [['42']],
      row_count: 1,
      citations: [{ url: `${HOST}/genie/rooms/${SPACE}/chats/c1`, description: 'Order count' }],
    });
    expect(calls.every((call) => call.auth === 'Bearer obo-token')).toBe(true);
    expect(JSON.parse(calls[0].body ?? '{}') as unknown).toEqual({ content: 'How many orders?' });
    expect(polls).toBe(2);
  });

  test('continues an existing conversation instead of starting a new one', async () => {
    const { calls, fetchImpl } = fakeGenie({
      'POST /conversations/c1/messages': () => json({ message_id: 'm2' }),
      'GET /conversations/c1/messages/m2': () => json({ status: 'COMPLETED', attachments: [] }),
    });
    const tool = createGenieSpaceTool({ spaceId: SPACE, host: HOST, getToken, fetchImpl, pollIntervalMs: 0 });

    const result = JSON.parse(
      await tool.execute({ question: 'And last month?', conversation_id: 'c1' }, {} as never)
    ) as Record<string, unknown>;

    expect(result).toMatchObject({ conversation_id: 'c1', response_id: 'm2', status: 'completed' });
    expect(calls[0].url).toContain('/conversations/c1/messages');
    expect(calls.some((call) => call.url.endsWith('/start-conversation'))).toBe(false);
  });

  test('reports a failed Genie message', async () => {
    const { fetchImpl } = fakeGenie({
      'POST /start-conversation': () => json({ conversation_id: 'c1', message_id: 'm1' }),
      'GET /conversations/c1/messages/m1': () => json({ status: 'FAILED', error: { error: 'warehouse stopped' } }),
    });
    const tool = createGenieSpaceTool({ spaceId: SPACE, host: HOST, getToken, fetchImpl, pollIntervalMs: 0 });

    const result = JSON.parse(await tool.execute({ question: 'q' }, {} as never)) as Record<string, unknown>;

    expect(result.status).toBe('failed');
    expect(result.error).toContain('warehouse stopped');
  });

  test('returns in_progress when Genie outlasts the poll budget', async () => {
    const { fetchImpl } = fakeGenie({
      'POST /start-conversation': () => json({ conversation_id: 'c1', message_id: 'm1' }),
      'GET /conversations/c1/messages/m1': () => json({ status: 'ASKING_AI' }),
    });
    const tool = createGenieSpaceTool({
      spaceId: SPACE,
      host: HOST,
      getToken,
      fetchImpl,
      pollIntervalMs: 1,
      maxPollSeconds: 0.01,
    });

    const result = JSON.parse(await tool.execute({ question: 'q' }, {} as never)) as Record<string, unknown>;

    expect(result).toMatchObject({ conversation_id: 'c1', response_id: 'm1', status: 'in_progress' });
  });

  test('turns API and auth errors into tool text', async () => {
    const { fetchImpl } = fakeGenie({ 'POST /start-conversation': () => json({ message: 'denied' }, 403) });
    const tool = createGenieSpaceTool({ spaceId: SPACE, host: HOST, getToken, fetchImpl });
    expect(await tool.execute({ question: 'q' }, {} as never)).toContain('Genie API 403');

    const noUser = createGenieSpaceTool({
      spaceId: SPACE,
      host: HOST,
      getToken: () => Promise.reject(new Error('no_user_token')),
      fetchImpl,
    });
    expect(await noUser.execute({ question: 'q' }, {} as never)).toBe(`${GENIE_SPACE_TOOL_NAME} error: no_user_token`);
  });

  test('preflight needs a question and a path-safe conversation id', async () => {
    const tool = createGenieSpaceTool({ spaceId: SPACE, host: HOST, getToken });
    expect(await tool.preflight?.({}, {} as never)).toContain('requires a question');
    expect(await tool.preflight?.({ question: 'q', conversation_id: '../x' }, {} as never)).toContain('invalid');
    expect(await tool.preflight?.({ question: 'q', conversation_id: 'c1' }, {} as never)).toBeNull();
  });
});
