import { createHash, randomUUID } from 'node:crypto';
import type {
  ApprovalDecision,
  ApprovalEvent,
  ApprovalEventType,
  ApprovalRequest,
  ApprovalStatus,
  ToolCall,
} from '../../shared/agents/types.js';
import type { LakebaseQuery } from './lakebase-store.js';
import { asJsonObject, asString } from '../lib/coerce.js';
import { redactSecrets } from '../sandbox/redact.js';

function parseToolCall(raw: unknown): ToolCall {
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!parsed || typeof parsed !== 'object') throw new Error('Invalid tool call');
  const row = parsed as { id?: string; name?: string; arguments?: Record<string, unknown> };
  if (!row.id || !row.name) throw new Error('Invalid tool call');
  return { id: row.id, name: row.name, arguments: row.arguments ?? {} };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * The trail never stores raw tool args (SQL text, volume_write content): a digest lets
 * investigators match a known payload, and the keys show its shape.
 */
export function describeToolArgs(args: Record<string, unknown>): { argsDigest: string; argKeys: string[] } {
  return {
    argsDigest: createHash('sha256').update(canonicalJson(args)).digest('hex'),
    argKeys: Object.keys(args)
      .sort()
      .map((key) => redactSecrets(key)),
  };
}

/** Optional context attached to create / decide for the approval trail. */
export interface ApprovalTrailMeta {
  botId?: string | null;
  userId?: string | null;
  decidedBy?: string | null;
}

const MAX_IN_MEMORY_EVENTS = 500;

/** Durable + in-memory approval / auto-allow store (Pi “hooks that survive restart”). */
export class ApprovalStore {
  private readonly byId = new Map<string, ApprovalRequest>();
  private readonly autoApprovedByChat = new Map<string, Set<string>>();
  private readonly events: ApprovalEvent[] = [];
  private hydratedChats = new Set<string>();

  constructor(private readonly query?: LakebaseQuery) {}

  private async hydrateChat(chatId: string): Promise<void> {
    if (!this.query || this.hydratedChats.has(chatId)) return;
    this.hydratedChats.add(chatId);

    const pending = await this.query(
      `SELECT id, chat_id, tool_call, status, decision, created_at, decided_at
       FROM bricksbot.approvals
       WHERE chat_id = $1 AND status = 'pending'`,
      [chatId]
    );
    for (const row of pending.rows) {
      const id = asString(row.id);
      if (this.byId.has(id)) continue;
      this.byId.set(id, {
        id,
        chatId: asString(row.chat_id),
        toolCall: parseToolCall(row.tool_call),
        status: 'pending',
        createdAt: asString(row.created_at),
      });
    }

    const autos = await this.query(`SELECT tool_name FROM bricksbot.auto_approvals WHERE chat_id = $1`, [chatId]);
    if (autos.rows.length > 0) {
      const set = this.autoApprovedByChat.get(chatId) ?? new Set<string>();
      for (const row of autos.rows) set.add(asString(row.tool_name));
      this.autoApprovedByChat.set(chatId, set);
    }
  }

  private async appendEvent(input: {
    chatId: string;
    approvalId: string | null;
    botId?: string | null;
    userId?: string | null;
    type: ApprovalEventType;
    toolName: string;
    payload: Record<string, unknown>;
  }): Promise<ApprovalEvent> {
    const event: ApprovalEvent = {
      id: randomUUID(),
      chatId: input.chatId,
      approvalId: input.approvalId,
      botId: input.botId ?? null,
      userId: input.userId ?? null,
      type: input.type,
      toolName: input.toolName,
      payload: input.payload,
      createdAt: new Date().toISOString(),
    };
    this.events.push(event);
    if (this.events.length > MAX_IN_MEMORY_EVENTS) {
      this.events.splice(0, this.events.length - MAX_IN_MEMORY_EVENTS);
    }
    if (this.query) {
      await this.query(
        `INSERT INTO bricksbot.approval_events
         (id, chat_id, approval_id, bot_id, user_id, type, tool_name, payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
        [
          event.id,
          event.chatId,
          event.approvalId,
          event.botId,
          event.userId,
          event.type,
          event.toolName,
          JSON.stringify(event.payload),
        ]
      );
    }
    return event;
  }

  async create(chatId: string, toolCall: ToolCall, meta?: ApprovalTrailMeta): Promise<ApprovalRequest> {
    await this.hydrateChat(chatId);
    const request: ApprovalRequest = {
      id: randomUUID(),
      chatId,
      toolCall,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    this.byId.set(request.id, request);
    if (this.query) {
      await this.query(
        `INSERT INTO bricksbot.approvals (id, chat_id, tool_call, status, created_at)
         VALUES ($1, $2, $3, 'pending', NOW())`,
        [request.id, chatId, JSON.stringify(toolCall)]
      );
    }
    await this.appendEvent({
      chatId,
      approvalId: request.id,
      botId: meta?.botId,
      userId: meta?.userId,
      type: 'requested',
      toolName: toolCall.name,
      payload: {
        toolCallId: toolCall.id,
        ...describeToolArgs(toolCall.arguments ?? {}),
      },
    });
    return request;
  }

  async get(id: string): Promise<ApprovalRequest | null> {
    const cached = this.byId.get(id);
    if (cached) return cached;
    if (!this.query) return null;
    const result = await this.query(
      `SELECT id, chat_id, tool_call, status, decision, created_at, decided_at
       FROM bricksbot.approvals WHERE id = $1`,
      [id]
    );
    const row = result.rows[0];
    if (!row) return null;
    const status = asString(row.status);
    const base = {
      id: asString(row.id),
      chatId: asString(row.chat_id),
      toolCall: parseToolCall(row.tool_call),
      createdAt: asString(row.created_at),
    };
    const request: ApprovalRequest =
      status === 'approved' || status === 'denied'
        ? {
            ...base,
            status,
            decision: (asString(row.decision) || (status === 'denied' ? 'denied' : 'once')) as
              | 'all_the_time'
              | 'once'
              | 'denied',
            decidedAt: asString(row.decided_at) || asString(row.created_at),
          }
        : {
            ...base,
            status: 'pending',
          };
    this.byId.set(request.id, request);
    return request;
  }

  async listPending(chatId: string): Promise<ApprovalRequest[]> {
    await this.hydrateChat(chatId);
    return [...this.byId.values()].filter((a) => a.chatId === chatId && a.status === 'pending');
  }

  async isAutoApproved(chatId: string, toolName: string): Promise<boolean> {
    await this.hydrateChat(chatId);
    return Boolean(this.autoApprovedByChat.get(chatId)?.has(toolName));
  }

  async setAutoApproved(chatId: string, toolName: string): Promise<void> {
    await this.hydrateChat(chatId);
    let set = this.autoApprovedByChat.get(chatId);
    if (!set) {
      set = new Set();
      this.autoApprovedByChat.set(chatId, set);
    }
    set.add(toolName);
    if (this.query) {
      await this.query(
        `INSERT INTO bricksbot.auto_approvals (chat_id, tool_name)
         VALUES ($1, $2)
         ON CONFLICT (chat_id, tool_name) DO NOTHING`,
        [chatId, toolName]
      );
    }
  }

  async revokeAutoApproved(chatId: string, toolName: string): Promise<void> {
    await this.hydrateChat(chatId);
    this.autoApprovedByChat.get(chatId)?.delete(toolName);
    if (this.query) {
      await this.query(`DELETE FROM bricksbot.auto_approvals WHERE chat_id = $1 AND tool_name = $2`, [
        chatId,
        toolName,
      ]);
    }
  }

  async clearAutoApproved(chatId: string): Promise<void> {
    await this.hydrateChat(chatId);
    this.autoApprovedByChat.delete(chatId);
    if (this.query) {
      await this.query(`DELETE FROM bricksbot.auto_approvals WHERE chat_id = $1`, [chatId]);
    }
  }

  async listAutoApproved(chatId: string): Promise<string[]> {
    await this.hydrateChat(chatId);
    const set = this.autoApprovedByChat.get(chatId);
    return set ? [...set].sort() : [];
  }

  /**
   * Settle a pending approval. Idempotent for races/double-clicks: returns
   * `{ applied: false }` when the row was already decided.
   */
  async decide(
    id: string,
    decision: ApprovalDecision,
    meta?: ApprovalTrailMeta
  ): Promise<{ request: ApprovalRequest; applied: boolean }> {
    const existing = (await this.get(id)) ?? this.byId.get(id);
    if (!existing) {
      throw new Error('Approval not found');
    }

    const isDenial = decision === 'denied' || decision === 'not_approved';
    const isAlways = decision === 'all_the_time' || decision === 'always';
    const status: ApprovalStatus = isDenial ? 'denied' : 'approved';
    const decisionKind = isDenial ? 'denied' : isAlways ? 'all_the_time' : 'once';

    if (existing.status !== 'pending') {
      return { request: existing, applied: false };
    }

    if (isAlways) {
      await this.setAutoApproved(existing.chatId, existing.toolCall.name);
    }

    const updated: ApprovalRequest = {
      ...existing,
      status,
      decision: decisionKind,
      decidedAt: new Date().toISOString(),
    };
    this.byId.set(id, updated);
    if (this.query) {
      await this.query(
        `UPDATE bricksbot.approvals
         SET status = $2, decision = $3, decided_at = NOW()
         WHERE id = $1 AND status = 'pending'`,
        [id, status, decisionKind]
      );
    }
    await this.appendEvent({
      chatId: existing.chatId,
      approvalId: existing.id,
      botId: meta?.botId,
      userId: meta?.userId,
      type: 'decided',
      toolName: existing.toolCall.name,
      payload: {
        toolCallId: existing.toolCall.id,
        decision: decisionKind,
        status,
        decidedBy: meta?.decidedBy ?? null,
      },
    });
    return { request: updated, applied: true };
  }

  /** Newest-first trail for a chat (Lakebase when configured, else in-memory). */
  async listEvents(chatId: string, limit: number = 50): Promise<ApprovalEvent[]> {
    const capped = Math.max(1, Math.min(limit, 200));
    if (this.query) {
      const result = await this.query(
        `SELECT id, chat_id, approval_id, bot_id, user_id, type, tool_name, payload, created_at
         FROM bricksbot.approval_events
         WHERE chat_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [chatId, capped]
      );
      return result.rows.map((row) => ({
        id: asString(row.id),
        chatId: asString(row.chat_id),
        approvalId: row.approval_id == null ? null : asString(row.approval_id),
        botId: row.bot_id == null ? null : asString(row.bot_id),
        userId: row.user_id == null ? null : asString(row.user_id),
        type: asString(row.type) as ApprovalEventType,
        toolName: asString(row.tool_name),
        payload: asJsonObject(row.payload),
        createdAt: asString(row.created_at),
      }));
    }
    return this.events
      .filter((event) => event.chatId === chatId)
      .slice()
      .reverse()
      .slice(0, capped);
  }
}
