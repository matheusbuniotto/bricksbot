import type { Request, Response } from 'express';
import { z } from 'zod';
import type { ChatStore } from '../../shared/chat/types.js';
import { resolveOwnerId } from './identity.js';
import type { ChatService } from './service.js';

const postMessageSchema = z.object({
  content: z.string().trim().min(1, 'Message content is required'),
  requestId: z.string().trim().min(1).max(128).optional(),
});

const decideSchema = z.object({
  decision: z.enum(['all_the_time', 'always', 'once', 'approved', 'denied', 'not_approved']),
});

const submitChoiceSchema = z.object({
  selectedOption: z.string().trim().min(1, 'selectedOption is required'),
});

const createBotSchema = z.object({
  name: z.string().trim().min(1).max(64),
  spaceId: z.string().uuid().nullable().optional(),
  avatarLabel: z.string().trim().min(1).max(32).optional(),
});

const updateBotSchema = z
  .object({
    name: z.string().trim().min(1).max(64).optional(),
    spaceId: z.string().uuid().nullable().optional(),
    avatarLabel: z.string().trim().min(1).max(32).optional(),
  })
  .refine((value) => value.name !== undefined || value.spaceId !== undefined || value.avatarLabel !== undefined, {
    message: 'At least one field is required',
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

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Unexpected error';
}

function isNotFound(err: unknown): boolean {
  return err instanceof Error && /not found/i.test(err.message);
}

function isBadRequest(err: unknown): boolean {
  return (
    err instanceof Error &&
    (/required/i.test(err.message) ||
      /already decided/i.test(err.message) ||
      /Cannot (archive|delete|move)/i.test(err.message) ||
      /Unarchive/i.test(err.message) ||
      /index must/i.test(err.message) ||
      /At least one field/i.test(err.message) ||
      /Invalid option/i.test(err.message) ||
      /selectedOption/i.test(err.message))
  );
}

/** Register Spaces, roster, durable chat, and approval HTTP routes. */
export function registerChatRoutes(app: ChatHttpApp, store: ChatStore, service: ChatService): void {
  app.get('/api/spaces', async (req: Request, res: Response) => {
    try {
      const ownerId = resolveOwnerId(req);
      await store.ensureBootstrap(ownerId);
      const spaces = await store.listSpaces(ownerId);
      res.json({ spaces });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
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
      res.status(isBadRequest(err) ? 400 : 500).json({ error: errorMessage(err) });
    }
  });

  app.get('/api/spaces/:spaceId/members', async (req: Request, res: Response) => {
    try {
      const members = await store.listSpaceMembers(String(req.params.spaceId));
      res.json({ members });
    } catch (err) {
      res.status(isNotFound(err) ? 404 : 500).json({ error: errorMessage(err) });
    }
  });

  app.post('/api/spaces/:spaceId/members', async (req: Request, res: Response) => {
    const parsed = addMemberSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'userId and role are required' });
      return;
    }
    try {
      const member = await store.addSpaceMember(String(req.params.spaceId), parsed.data.userId, parsed.data.role);
      res.status(201).json({ member });
    } catch (err) {
      res.status(isNotFound(err) ? 404 : 500).json({ error: errorMessage(err) });
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
      res.status(500).json({ error: errorMessage(err) });
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
        ownerId: resolveOwnerId(req),
      });
      res.status(201).json({ bot });
    } catch (err) {
      res.status(isNotFound(err) ? 404 : isBadRequest(err) ? 400 : 500).json({ error: errorMessage(err) });
    }
  });

  app.put('/api/bots/:botId', async (req: Request, res: Response) => {
    const parsed = updateBotSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'At least one field is required' });
      return;
    }
    try {
      const bot = await store.updateBot(String(req.params.botId), parsed.data);
      res.json({ bot });
    } catch (err) {
      res.status(isNotFound(err) ? 404 : isBadRequest(err) ? 400 : 500).json({ error: errorMessage(err) });
    }
  });

  app.post('/api/bots/:botId/move', async (req: Request, res: Response) => {
    const parsed = moveBotSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'spaceId and index are required' });
      return;
    }
    try {
      const bot = await store.moveBot(String(req.params.botId), parsed.data);
      res.json({ bot });
    } catch (err) {
      res.status(isNotFound(err) ? 404 : isBadRequest(err) ? 400 : 500).json({ error: errorMessage(err) });
    }
  });

  app.post('/api/bots/:botId/archive', async (req: Request, res: Response) => {
    try {
      const bot = await store.archiveBot(String(req.params.botId));
      res.json({ bot });
    } catch (err) {
      res.status(isNotFound(err) ? 404 : isBadRequest(err) ? 400 : 500).json({ error: errorMessage(err) });
    }
  });

  app.post('/api/bots/:botId/unarchive', async (req: Request, res: Response) => {
    try {
      const bot = await store.unarchiveBot(String(req.params.botId));
      res.json({ bot });
    } catch (err) {
      res.status(isNotFound(err) ? 404 : isBadRequest(err) ? 400 : 500).json({ error: errorMessage(err) });
    }
  });

  app.delete('/api/bots/:botId', async (req: Request, res: Response) => {
    try {
      await store.deleteBot(String(req.params.botId));
      res.status(204).send();
    } catch (err) {
      res.status(isNotFound(err) ? 404 : isBadRequest(err) ? 400 : 500).json({ error: errorMessage(err) });
    }
  });

  app.get('/api/bots/:botId/chat', async (req: Request, res: Response) => {
    try {
      const botId = String(req.params.botId);
      const chat = await store.getOrCreateChatForBot(botId);
      const messages = await store.listMessages(chat.id);
      const pendingApprovals = await service.getApprovals().listPending(chat.id);
      const pendingChoices = await service.getChoices().listPending(chat.id);
      const autoApprovedTools = await service.getApprovals().listAutoApproved(chat.id);
      res.json({ chat, messages, pendingApprovals, pendingChoices, autoApprovedTools });
    } catch (err) {
      res.status(isNotFound(err) ? 404 : 500).json({ error: errorMessage(err) });
    }
  });

  app.get('/api/chats/:chatId/approvals/auto', async (req: Request, res: Response) => {
    try {
      const chatId = String(req.params.chatId);
      const autoApprovedTools = await service.getApprovals().listAutoApproved(chatId);
      res.json({ autoApprovedTools });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  app.delete('/api/chats/:chatId/approvals/auto/:toolName', async (req: Request, res: Response) => {
    try {
      const chatId = String(req.params.chatId);
      const toolName = String(req.params.toolName);
      await service.getApprovals().revokeAutoApproved(chatId, toolName);
      const autoApprovedTools = await service.getApprovals().listAutoApproved(chatId);
      res.json({ autoApprovedTools });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  app.post('/api/chats/:chatId/approvals/auto/revoke', async (req: Request, res: Response) => {
    try {
      const chatId = String(req.params.chatId);
      const toolName = typeof req.body?.toolName === 'string' ? req.body.toolName : undefined;
      if (toolName) {
        await service.getApprovals().revokeAutoApproved(chatId, toolName);
      } else {
        await service.getApprovals().clearAutoApproved(chatId);
      }
      const autoApprovedTools = await service.getApprovals().listAutoApproved(chatId);
      res.json({ autoApprovedTools });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
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
      const result = await service.sendUserMessage(chatId, parsed.data.content, {
        requestId: parsed.data.requestId,
      });
      res.status(201).json(result);
    } catch (err) {
      if (isBadRequest(err)) {
        res.status(400).json({ error: errorMessage(err) });
        return;
      }
      res.status(isNotFound(err) ? 404 : 500).json({ error: errorMessage(err) });
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
      const result = await service.decideApproval(approvalId, parsed.data.decision);
      res.json(result);
    } catch (err) {
      if (isBadRequest(err)) {
        res.status(400).json({ error: errorMessage(err) });
        return;
      }
      res.status(isNotFound(err) ? 404 : 500).json({ error: errorMessage(err) });
    }
  });

  app.post('/api/chats/:chatId/choices/:choiceId', async (req: Request, res: Response) => {
    const parsed = submitChoiceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'selectedOption is required' });
      return;
    }

    try {
      const choiceId = String(req.params.choiceId);
      const pending = await service.getChoices().get(choiceId);
      if (!pending || pending.chatId !== String(req.params.chatId)) {
        res.status(404).json({ error: 'Choice not found' });
        return;
      }
      const result = await service.submitChoice(choiceId, parsed.data.selectedOption);
      res.json(result);
    } catch (err) {
      if (isBadRequest(err)) {
        res.status(400).json({ error: errorMessage(err) });
        return;
      }
      res.status(isNotFound(err) ? 404 : 500).json({ error: errorMessage(err) });
    }
  });
}
