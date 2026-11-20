import type { Request, Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { attachmentConfig, attachmentRef } from '../../shared/chat/attachments.js';
import type { ChatStore } from '../../shared/chat/types.js';
import { runWithDatabricksRequestAuth } from '../chat/databricks-auth.js';
import { requireChatUse } from '../chat/route-guards.js';
import type { ChatHttpApp } from '../chat/routes.js';
import { createErrorResponder } from '../lib/http.js';
import { AttachmentError, type AttachmentService } from './upload.js';

const sendError = createErrorResponder([[401, /no_user_token/]]);

/** Attachment routes. Without a service (no Volume root) only the config route answers, saying `enabled: false`. */
export function registerAttachmentRoutes(app: ChatHttpApp, store: ChatStore, attachments?: AttachmentService): void {
  /** The caller's chat, when attachments are on and the caller may still use the chat's bot. */
  async function attachmentChat(req: Request, res: Response) {
    if (!attachments) {
      res.status(404).json({ error: 'Attachments are not enabled (set BRICKSBOT_VOLUME_ROOT)' });
      return null;
    }
    const chat = await requireChatUse(store, String(req.params.chatId), req, res);
    if (chat && (chat.kind ?? 'user') !== 'user') {
      res.status(400).json({ error: 'Attachments are only for chats you start yourself' });
      return null;
    }
    return chat;
  }

  function fail(res: Response, err: unknown) {
    if (err instanceof AttachmentError) res.status(err.status).json({ error: err.message });
    else sendError(res, err, 502);
  }

  app.get('/api/attachments/config', (_req: Request, res: Response) => {
    res.json(attachmentConfig(Boolean(attachments)));
  });

  // Raw bytes in the body (no multipart), the file name in `?name=`. Content-Length is required: it is reserved
  // against the quota and sent on to the Files API.
  app.post('/api/chats/:chatId/attachments', async (req: Request, res: Response) => {
    try {
      const chat = await attachmentChat(req, res);
      if (!chat || !attachments) return;
      const length = Number(req.header('content-length'));
      if (!Number.isFinite(length)) {
        res.status(411).json({ error: 'Content-Length is required' });
        return;
      }
      const name = typeof req.query.name === 'string' ? req.query.name : '';
      const attachment = await runWithDatabricksRequestAuth(req, () =>
        attachments.upload(chat, { name, length, body: req })
      );
      res.status(201).json({ attachment: { ...attachmentRef(attachment), preview: attachment.preview } });
    } catch (err) {
      fail(res, err);
    }
  });

  app.get('/api/chats/:chatId/attachments/:id/content', async (req: Request, res: Response) => {
    try {
      const chat = await attachmentChat(req, res);
      if (!chat || !attachments) return;
      const attachment = await attachments.store.get(chat.id, chat.userId!, String(req.params.id));
      if (!attachment) {
        res.status(404).json({ error: 'Attachment not found' });
        return;
      }
      const stream = await runWithDatabricksRequestAuth(req, () => attachments.read(attachment));
      // Never rendered by the browser: it is the user's data, whatever its name claims.
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(attachment.name)}`);
      await pipeline(stream, res);
    } catch (err) {
      if (res.headersSent) res.destroy();
      else fail(res, err);
    }
  });

  app.post('/api/chats/:chatId/attachments/:id/delete', async (req: Request, res: Response) => {
    try {
      const chat = await attachmentChat(req, res);
      if (!chat || !attachments) return;
      const attachment = await attachments.store.get(chat.id, chat.userId!, String(req.params.id));
      if (!attachment) {
        res.status(404).json({ error: 'Attachment not found' });
        return;
      }
      await runWithDatabricksRequestAuth(req, () => attachments.remove(chat, attachment));
      res.json({ ok: true });
    } catch (err) {
      fail(res, err);
    }
  });
}
