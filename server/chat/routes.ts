import type { Request, Response } from 'express';
import { z } from 'zod';
import type { Bot, Chat, ChatStore, MarketplaceBot } from '../../shared/chat/types.js';
import type { SandboxUiStatus } from '../../shared/sandbox/types.js';
import { AVAILABLE_DATABRICKS_MCPS, BUILTIN_PLUGIN_MCPS } from '../../shared/agents/mcp-types.js';
import type { McpDiscoveryService } from '../agents/tools/mcp-discovery.js';
import { buildConnectedMcpTools } from '../agents/tools/mcp-tools.js';
import { ActiveRunError } from '../../shared/runs/types.js';
import { createErrorResponder } from '../lib/http.js';
import { canManageSpaceMembers, canViewerAccessSpace } from './access-policy.js';
import { runWithDatabricksRequestAuth } from './databricks-auth.js';
import { resolveOwnerId } from './identity.js';
import { requireBotAccess, requireBotUse, requireSpaceAccess } from './route-guards.js';
import type { ChatService } from './service.js';

async function syncConnectedMcpTools(
  discovery: McpDiscoveryService,
  service: ChatService,
  userId: string
): Promise<void> {
  const clientConfig = discovery.getClientConfig();
  const tools = await buildConnectedMcpTools(discovery, userId, clientConfig);
  service.replaceMcpTools(userId, tools);
}

const postMessageSchema = z.object({
  content: z.string().trim().min(1, 'Message content is required'),
  requestId: z.string().trim().min(1).max(128).optional(),
  /** Answer 202 as soon as the message is saved; the turn keeps running in the background. */
  async: z.boolean().optional(),
});

const decideSchema = z.object({
  decision: z.enum(['all_the_time', 'always', 'once', 'approved', 'denied', 'not_approved']),
  async: z.boolean().optional(),
});

const submitChoiceSchema = z.object({
  selectedOption: z.string().trim().min(1, 'selectedOption is required'),
  async: z.boolean().optional(),
});

const createBotSchema = z.object({
  name: z.string().trim().min(1).max(64),
  spaceId: z.string().uuid().nullable().optional(),
  avatarLabel: z.string().trim().min(1).max(32).optional(),
  description: z.string().trim().max(2000).optional(),
  isShared: z.boolean().optional(),
});

const updateBotSchema = z
  .object({
    name: z.string().trim().min(1).max(64).optional(),
    spaceId: z.string().uuid().nullable().optional(),
    avatarLabel: z.string().trim().min(1).max(32).optional(),
    description: z.string().trim().max(2000).optional(),
    isShared: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.spaceId !== undefined ||
      value.avatarLabel !== undefined ||
      value.description !== undefined ||
      value.isShared !== undefined,
    {
      message: 'At least one field is required',
    }
  );

const installBotSchema = z.object({
  spaceId: z.string().uuid().nullable().optional(),
});

const moveBotSchema = z.object({
  spaceId: z.string().uuid().nullable(),
  index: z.number().int().min(0),
});

const createSpaceSchema = z.object({
  name: z.string().trim().min(1).max(64),
});

const addMemberSchema = z.object({
  userId: z.string().trim().min(1),
  role: z.enum(['viewer', 'member', 'admin']).default('member'),
});

/** Minimal Express-like surface used by AppKit server.extend and tests. */
export type ChatHttpApp = {
  get(path: string, handler: (req: Request, res: Response) => unknown): unknown;
  post(path: string, handler: (req: Request, res: Response) => unknown): unknown;
  put(path: string, handler: (req: Request, res: Response) => unknown): unknown;
  delete(path: string, handler: (req: Request, res: Response) => unknown): unknown;
};

const sendError = createErrorResponder([
  [403, /Access to this bot was revoked/i],
  [409, /requestId already used/i],
  [
    400,
    /required|already decided|Cannot (archive|delete|move|share)|Unarchive|index must|At least one field|Invalid option|selectedOption/i,
  ],
]);

/** A chat already running something answers 409 with the run to Stop or wait for. */
function sendRunError(res: Response, err: unknown): void {
  if (err instanceof ActiveRunError) {
    res.status(409).json({ error: err.message, activeRunId: err.activeRunId });
    return;
  }
  sendError(res, err);
}

/** Register Spaces, roster, durable chat, and approval HTTP routes. */
export function registerChatRoutes(
  app: ChatHttpApp,
  store: ChatStore,
  service: ChatService,
  options?: {
    mcpDiscovery?: McpDiscoveryService;
  }
): void {
  async function sandboxStatusFor(chatId: string): Promise<SandboxUiStatus> {
    const sandbox = service.getSandbox();
    if (!sandbox) return { enabled: false, backend: 'off', session: null, recentEvents: [] };
    return sandbox.getUiStatusForChat(chatId);
  }

  app.get('/api/spaces', async (req: Request, res: Response) => {
    try {
      const ownerId = resolveOwnerId(req);
      await store.ensureBootstrap(ownerId);
      const spaces = await store.listSpaces(ownerId);
      res.json({ spaces });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/spaces', async (req: Request, res: Response) => {
    const parsed = createSpaceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Space name is required' });
      return;
    }
    try {
      const space = await store.createSpace({
        name: parsed.data.name,
        ownerId: resolveOwnerId(req),
      });
      res.status(201).json({ space });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get('/api/spaces/:spaceId/members', async (req: Request, res: Response) => {
    try {
      const spaceId = String(req.params.spaceId);
      const space = await store.getSpace(spaceId);
      if (!space) {
        res.status(404).json({ error: 'Space not found' });
        return;
      }
      const callerId = resolveOwnerId(req);
      const members = await store.listSpaceMembers(spaceId);
      if (!canViewerAccessSpace(space, members, callerId)) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      res.json({
        members,
        canManage: canManageSpaceMembers(space, members, callerId),
        callerId,
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/spaces/:spaceId/members', async (req: Request, res: Response) => {
    const parsed = addMemberSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'userId and role are required' });
      return;
    }
    try {
      const spaceId = String(req.params.spaceId);
      const space = await store.getSpace(spaceId);
      if (!space) {
        res.status(404).json({ error: 'Space not found' });
        return;
      }
      const callerId = resolveOwnerId(req);
      const members = await store.listSpaceMembers(spaceId);
      if (!canManageSpaceMembers(space, members, callerId)) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      const userId = parsed.data.userId.trim().toLowerCase();
      const member = await store.addSpaceMember(spaceId, userId, parsed.data.role);
      res.status(201).json({ member });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.delete('/api/spaces/:spaceId/members/:userId', async (req: Request, res: Response) => {
    try {
      const spaceId = String(req.params.spaceId);
      const space = await store.getSpace(spaceId);
      if (!space) {
        res.status(404).json({ error: 'Space not found' });
        return;
      }
      const callerId = resolveOwnerId(req);
      const userId = String(req.params.userId).trim().toLowerCase();
      const members = await store.listSpaceMembers(spaceId);
      const isLeaving = userId === callerId && canViewerAccessSpace(space, members, callerId);
      if (!isLeaving && !canManageSpaceMembers(space, members, callerId)) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      if (userId === space.ownerId) {
        res.status(400).json({ error: 'Cannot remove the space owner' });
        return;
      }
      await store.removeSpaceMember(spaceId, userId);
      res.status(204).send();
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get('/api/mcps', async (req: Request, res: Response) => {
    try {
      const refresh = req.query.refresh === 'true' || req.query.refresh === '1';
      if (options?.mcpDiscovery) {
        const discovery = options.mcpDiscovery;
        const mcps = await runWithDatabricksRequestAuth(req, () =>
          discovery.listViableMcps({ refresh, userId: resolveOwnerId(req) })
        );
        res.json({ mcps });
        return;
      }
      const viable = [...AVAILABLE_DATABRICKS_MCPS, ...BUILTIN_PLUGIN_MCPS]
        .filter((m) => m.isViable !== false)
        .map((m) => ({
          ...m,
          connected: false,
        }));
      res.json({ mcps: viable });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/mcps/connect', async (req: Request, res: Response) => {
    if (!options?.mcpDiscovery) {
      res.status(400).json({ error: 'MCP discovery service not configured' });
      return;
    }
    const serviceName = typeof req.body?.service === 'string' ? req.body.service.trim() : '';
    if (!serviceName) {
      res.status(400).json({ error: 'service name is required' });
      return;
    }
    try {
      const userId = resolveOwnerId(req);
      const discovery = options.mcpDiscovery;
      const mcp = await runWithDatabricksRequestAuth(req, async () => {
        const connected = await discovery.connect(userId, serviceName);
        await syncConnectedMcpTools(discovery, service, userId);
        return connected;
      });
      res.json({
        mcp,
        toolNames: service.listToolNames(userId).filter((n) => n.startsWith('mcp_') || n.startsWith('genie_')),
      });
    } catch (err) {
      sendError(res, err, 400);
    }
  });

  app.delete('/api/mcps/connect/:service(*)', async (req: Request, res: Response) => {
    if (!options?.mcpDiscovery) {
      res.status(400).json({ error: 'MCP discovery service not configured' });
      return;
    }
    const rawService = req.params.service;
    const serviceName = Array.isArray(rawService) ? rawService.join('/') : String(rawService ?? '');
    try {
      const userId = resolveOwnerId(req);
      const discovery = options.mcpDiscovery;
      const removed = await runWithDatabricksRequestAuth(req, async () => {
        const done = await discovery.disconnect(userId, serviceName);
        await syncConnectedMcpTools(discovery, service, userId);
        return done;
      });
      res.json({ success: removed });
    } catch (err) {
      sendError(res, err, 400);
    }
  });

  app.post('/api/mcps/register', async (req: Request, res: Response) => {
    if (!options?.mcpDiscovery) {
      res.status(400).json({ error: 'MCP discovery service not configured' });
      return;
    }
    const serviceName = typeof req.body?.service === 'string' ? req.body.service.trim() : '';
    if (!serviceName) {
      res.status(400).json({ error: 'service name is required' });
      return;
    }
    try {
      const userId = resolveOwnerId(req);
      const discovery = options.mcpDiscovery;
      const appItem = await runWithDatabricksRequestAuth(req, async () => {
        const registered = await discovery.registerCustomMcp(userId, serviceName, {
          name: typeof req.body?.name === 'string' ? req.body.name : undefined,
          description: typeof req.body?.description === 'string' ? req.body.description : undefined,
        });
        await syncConnectedMcpTools(discovery, service, userId);
        return registered;
      });
      res.status(201).json({ mcp: appItem });
    } catch (err) {
      sendError(res, err, 400);
    }
  });

  app.delete('/api/mcps/:service(*)', async (req: Request, res: Response) => {
    if (!options?.mcpDiscovery) {
      res.status(400).json({ error: 'MCP discovery service not configured' });
      return;
    }
    const rawService = req.params.service;
    const mcpService = Array.isArray(rawService) ? rawService.join('/') : String(rawService ?? '');
    // Avoid treating "connect/…" as a custom-service delete when path order is ambiguous.
    if (mcpService === 'connect' || mcpService.startsWith('connect/')) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    try {
      const userId = resolveOwnerId(req);
      const discovery = options.mcpDiscovery;
      const removed = await runWithDatabricksRequestAuth(req, async () => {
        const done = await discovery.removeCustomMcp(userId, mcpService);
        await syncConnectedMcpTools(discovery, service, userId);
        return done;
      });
      res.json({ success: removed });
    } catch (err) {
      sendError(res, err, 400);
    }
  });

  app.get('/api/bots', async (req: Request, res: Response) => {
    try {
      const ownerId = resolveOwnerId(req);
      const spaceId = typeof req.query.spaceId === 'string' ? req.query.spaceId : undefined;
      const archivedRaw = typeof req.query.archived === 'string' ? req.query.archived : 'active';
      const archived =
        archivedRaw === 'archived' || archivedRaw === '1' || archivedRaw === 'true'
          ? 'archived'
          : archivedRaw === 'all'
            ? 'all'
            : 'active';
      const bots = await store.listBots({
        ownerId,
        spaceId: spaceId === 'null' ? null : spaceId,
        archived,
      });
      res.json({ bots });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/bots', async (req: Request, res: Response) => {
    const parsed = createBotSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Bot name is required' });
      return;
    }
    try {
      const bot = await store.createBot({
        name: parsed.data.name,
        spaceId: parsed.data.spaceId ?? null,
        avatarLabel: parsed.data.avatarLabel,
        description: parsed.data.description,
        isShared: parsed.data.isShared,
        ownerId: resolveOwnerId(req),
      });
      res.status(201).json({ bot });
    } catch (err) {
      sendError(res, err);
    }
  });

  async function assertBotOwnership(botId: string, req: Request, res: Response): Promise<Bot | null> {
    const bot = await store.getBot(botId);
    if (!bot) {
      res.status(404).json({ error: 'Bot not found' });
      return null;
    }
    const callerId = resolveOwnerId(req);
    if (bot.ownerId !== callerId) {
      res.status(403).json({ error: 'Forbidden' });
      return null;
    }
    return bot;
  }

  /** The caller's chat with an accessible bot, or null after responding 404/403. */
  async function accessibleBotChat(req: Request, res: Response): Promise<Chat | null> {
    const access = await requireBotAccess(store, String(req.params.botId), req, res);
    return access ? store.getOrCreateChatForBot(access.bot.id, access.callerId) : null;
  }

  app.put('/api/bots/:botId', async (req: Request, res: Response) => {
    const parsed = updateBotSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'At least one field is required' });
      return;
    }
    try {
      const botId = String(req.params.botId);
      const existing = await assertBotOwnership(botId, req, res);
      if (!existing) return;

      const callerId = resolveOwnerId(req);
      if (
        parsed.data.spaceId !== undefined &&
        parsed.data.spaceId !== null &&
        parsed.data.spaceId !== existing.spaceId
      ) {
        if (!(await requireSpaceAccess(store, parsed.data.spaceId, callerId, res))) return;
      }
      const bot = await store.updateBot(botId, parsed.data);
      res.json({ bot });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get('/api/marketplace/bots', async (req: Request, res: Response) => {
    try {
      resolveOwnerId(req);
      const sharedBots = await store.listMarketplaceBots();
      const botIds = sharedBots.map((b) => b.id);
      const skillsByBot = await service.getMemory().listSkillNamesForBots(botIds);
      const bots: MarketplaceBot[] = sharedBots.map((bot) => ({
        id: bot.id,
        name: bot.name,
        avatarLabel: bot.avatarLabel,
        description: bot.description ?? '',
        ownerId: bot.ownerId.split('@')[0] || bot.ownerId,
        skillNames: skillsByBot.get(bot.id) ?? [],
        createdAt: bot.createdAt,
      }));
      res.json({ bots });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/marketplace/bots/:botId/install', async (req: Request, res: Response) => {
    const parsed = installBotSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid spaceId' });
      return;
    }
    try {
      const sourceBot = await store.getBot(String(req.params.botId));
      if (!sourceBot || sourceBot.isShared !== true || sourceBot.isPrimary || sourceBot.archivedAt) {
        res.status(404).json({ error: 'Marketplace bot not found' });
        return;
      }
      const ownerId = resolveOwnerId(req);
      if (parsed.data.spaceId) {
        if (!(await requireSpaceAccess(store, parsed.data.spaceId, ownerId, res))) return;
      }
      const installed = await store.createBot({
        name: sourceBot.name,
        avatarLabel: sourceBot.avatarLabel,
        description: sourceBot.description,
        spaceId: parsed.data.spaceId ?? null,
        ownerId,
        isShared: false,
        sourceBotId: sourceBot.id,
      });
      await service.getMemory().cloneSkills(sourceBot.id, installed.id);
      const chat = await store.getOrCreateChatForBot(installed.id, ownerId);
      const greeting = `Hi — I'm ${installed.name}.${installed.description ? ` ${installed.description}` : ''} How can I help?`;
      await store.addMessage(chat.id, 'assistant', greeting);
      res.status(201).json({ bot: installed });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/bots/:botId/move', async (req: Request, res: Response) => {
    const parsed = moveBotSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'spaceId and index are required' });
      return;
    }
    try {
      const botId = String(req.params.botId);
      const existing = await assertBotOwnership(botId, req, res);
      if (!existing) return;

      const callerId = resolveOwnerId(req);
      if (parsed.data.spaceId !== null && parsed.data.spaceId !== existing.spaceId) {
        if (!(await requireSpaceAccess(store, parsed.data.spaceId, callerId, res))) return;
      }

      const bot = await store.moveBot(botId, parsed.data);
      res.json({ bot });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/bots/:botId/archive', async (req: Request, res: Response) => {
    try {
      const botId = String(req.params.botId);
      const existing = await assertBotOwnership(botId, req, res);
      if (!existing) return;
      const bot = await store.archiveBot(botId);
      res.json({ bot });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/bots/:botId/unarchive', async (req: Request, res: Response) => {
    try {
      const botId = String(req.params.botId);
      const existing = await assertBotOwnership(botId, req, res);
      if (!existing) return;
      const bot = await store.unarchiveBot(botId);
      res.json({ bot });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.delete('/api/bots/:botId', async (req: Request, res: Response) => {
    try {
      const botId = String(req.params.botId);
      const existing = await assertBotOwnership(botId, req, res);
      if (!existing) return;
      await store.deleteBot(botId);
      service.getMemory().evictBot?.(botId);
      res.status(204).send();
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get('/api/bots/:botId/chat', async (req: Request, res: Response) => {
    try {
      const chat = await accessibleBotChat(req, res);
      if (!chat) return;
      const [messages, pendingApprovals, pendingChoices, autoApprovedTools, sandboxStatus] = await Promise.all([
        store.listMessages(chat.id),
        service.getApprovals().listPending(chat.id),
        service.getChoices().listPending(chat.id),
        service.getApprovals().listAutoApproved(chat.id),
        sandboxStatusFor(chat.id),
      ]);
      res.json({
        chat,
        messages,
        pendingApprovals,
        pendingChoices,
        autoApprovedTools,
        sandboxStatus,
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get('/api/bots/:botId/sandbox', async (req: Request, res: Response) => {
    try {
      const chat = await accessibleBotChat(req, res);
      if (!chat) return;
      const sandbox = await sandboxStatusFor(chat.id);
      res.json({ sandbox });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/bots/:botId/sandbox/stop', async (req: Request, res: Response) => {
    try {
      const chat = await accessibleBotChat(req, res);
      if (!chat) return;
      const sandboxSvc = service.getSandbox();
      if (sandboxSvc?.isEnabled()) {
        await runWithDatabricksRequestAuth(req, () => sandboxSvc.stopSession(chat.id, 'user_ui'));
      }
      const sandbox = await sandboxStatusFor(chat.id);
      res.json({ sandbox });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.delete('/api/bots/:botId/sandbox', async (req: Request, res: Response) => {
    try {
      const chat = await accessibleBotChat(req, res);
      if (!chat) return;
      const sandboxSvc = service.getSandbox();
      if (sandboxSvc?.isEnabled()) {
        await runWithDatabricksRequestAuth(req, () => sandboxSvc.deleteSession(chat.id, 'user_ui'));
      }
      const sandbox = await sandboxStatusFor(chat.id);
      res.json({ sandbox });
    } catch (err) {
      sendError(res, err);
    }
  });

  async function assertChatOwnership(chatId: string, req: Request, res: Response) {
    const chat = await store.getChat(chatId);
    if (!chat) {
      res.status(404).json({ error: 'Chat not found' });
      return null;
    }
    const callerId = resolveOwnerId(req);
    if (!chat.userId || chat.userId !== callerId) {
      res.status(403).json({ error: 'Forbidden' });
      return null;
    }
    return chat;
  }

  /** The caller's chat, provided they may still run its bot (not a viewer, still shared). */
  async function assertChatUse(chatId: string, req: Request, res: Response) {
    const chat = await assertChatOwnership(chatId, req, res);
    if (!chat) return null;
    return (await requireBotUse(store, chat.botId, req, res)) ? chat : null;
  }

  app.get('/api/chats/:chatId/approvals/auto', async (req: Request, res: Response) => {
    try {
      const chatId = String(req.params.chatId);
      const chat = await assertChatOwnership(chatId, req, res);
      if (!chat) return;
      const autoApprovedTools = await service.getApprovals().listAutoApproved(chatId);
      res.json({ autoApprovedTools });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.delete('/api/chats/:chatId/approvals/auto/:toolName', async (req: Request, res: Response) => {
    try {
      const chatId = String(req.params.chatId);
      const chat = await assertChatOwnership(chatId, req, res);
      if (!chat) return;
      const toolName = String(req.params.toolName);
      await service.getApprovals().revokeAutoApproved(chatId, toolName);
      const autoApprovedTools = await service.getApprovals().listAutoApproved(chatId);
      res.json({ autoApprovedTools });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/chats/:chatId/approvals/auto/revoke', async (req: Request, res: Response) => {
    try {
      const chatId = String(req.params.chatId);
      const chat = await assertChatOwnership(chatId, req, res);
      if (!chat) return;
      const toolName = typeof req.body?.toolName === 'string' ? req.body.toolName : undefined;
      if (toolName) {
        await service.getApprovals().revokeAutoApproved(chatId, toolName);
      } else {
        await service.getApprovals().clearAutoApproved(chatId);
      }
      const autoApprovedTools = await service.getApprovals().listAutoApproved(chatId);
      res.json({ autoApprovedTools });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/chats/:chatId/messages', async (req: Request, res: Response) => {
    const parsed = postMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Message content is required' });
      return;
    }

    try {
      const chatId = String(req.params.chatId);
      const chat = await assertChatUse(chatId, req, res);
      if (!chat) return;
      const { content, requestId } = parsed.data;
      if (parsed.data.async) {
        const { run, user } = await runWithDatabricksRequestAuth(req, () =>
          service.startUserMessage(chatId, content, { requestId })
        );
        res.status(202).json({ runId: run.id, user });
        return;
      }
      const result = await runWithDatabricksRequestAuth(req, () =>
        service.sendUserMessage(chatId, content, { requestId })
      );
      res.status(201).json(result);
    } catch (err) {
      sendRunError(res, err);
    }
  });

  // What the Stop button asks first: the run in flight, if any (the sync send does not hand back its run id).
  app.get('/api/chats/:chatId/runs/active', async (req: Request, res: Response) => {
    try {
      const chatId = String(req.params.chatId);
      if (!(await assertChatOwnership(chatId, req, res))) return;
      const running = await service.getRuns().store.listRunning();
      res.json({ run: running.find((run) => run.chatId === chatId) ?? null });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get('/api/chats/:chatId/runs/:runId', async (req: Request, res: Response) => {
    try {
      const chatId = String(req.params.chatId);
      if (!(await assertChatOwnership(chatId, req, res))) return;
      const run = await service.getRuns().store.get(String(req.params.runId));
      if (!run || run.chatId !== chatId) {
        res.status(404).json({ error: 'Run not found' });
        return;
      }
      res.json({ run });
    } catch (err) {
      sendError(res, err);
    }
  });

  // Stop needs only ownership of the chat: whoever lost access to the bot can still cut a run short.
  app.post('/api/chats/:chatId/runs/:runId/stop', async (req: Request, res: Response) => {
    try {
      const chatId = String(req.params.chatId);
      if (!(await assertChatOwnership(chatId, req, res))) return;
      const runId = String(req.params.runId);
      const run = await service.getRuns().store.get(runId);
      if (!run || run.chatId !== chatId) {
        res.status(404).json({ error: 'Run not found' });
        return;
      }
      await service.stopRun(runId);
      res.json({ run: await service.getRuns().store.get(runId) });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/approvals/:approvalId/decide', async (req: Request, res: Response) => {
    const parsed = decideSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'decision must be approved or denied' });
      return;
    }

    try {
      const approvalId = String(req.params.approvalId);
      const pending = await service.getApprovals().get(approvalId);
      if (!pending) {
        res.status(404).json({ error: 'Approval request not found' });
        return;
      }
      const chat = await assertChatUse(pending.chatId, req, res);
      if (!chat) return;
      const { decision } = parsed.data;
      if (parsed.data.async) {
        const runId = await runWithDatabricksRequestAuth(req, () =>
          service.decideApprovalDetached(approvalId, decision, { decidedBy: chat.userId })
        );
        res.status(202).json({ runId });
        return;
      }
      const result = await runWithDatabricksRequestAuth(req, () =>
        service.decideApproval(approvalId, decision, { decidedBy: chat.userId })
      );
      res.json(result);
    } catch (err) {
      sendRunError(res, err);
    }
  });

  app.post('/api/chats/:chatId/choices/:choiceId', async (req: Request, res: Response) => {
    const parsed = submitChoiceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'selectedOption is required' });
      return;
    }

    try {
      const chatId = String(req.params.chatId);
      const chat = await assertChatUse(chatId, req, res);
      if (!chat) return;
      const choiceId = String(req.params.choiceId);
      const pending = await service.getChoices().get(choiceId);
      if (!pending || pending.chatId !== chatId) {
        res.status(404).json({ error: 'Choice not found' });
        return;
      }
      const { selectedOption } = parsed.data;
      if (parsed.data.async) {
        const runId = await runWithDatabricksRequestAuth(req, () =>
          service.submitChoiceDetached(choiceId, selectedOption)
        );
        res.status(202).json({ runId });
        return;
      }
      const result = await runWithDatabricksRequestAuth(req, () => service.submitChoice(choiceId, selectedOption));
      res.json(result);
    } catch (err) {
      sendRunError(res, err);
    }
  });
}
