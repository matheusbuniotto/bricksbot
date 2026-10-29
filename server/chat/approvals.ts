import { randomUUID } from 'node:crypto';
import type {
  ApprovalDecision,
  ApprovalRequest,
  ApprovalStatus,
  ToolCall,
} from '../../shared/llm/types.js';
import type { LakebaseQuery } from './lakebase-store.js';

function asString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (value === null || value === undefined) return '';
  return String(value);
}

function parseToolCall(raw: unknown): ToolCall {
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!parsed || typeof parsed !== 'object') throw new Error('Invalid tool call');
  const row = parsed as { id?: string; name?: string; arguments?: Record<string, unknown> };
  if (!row.id || !row.name) throw new Error('Invalid tool call');
  return { id: row.id, name: row.name, arguments: row.arguments ?? {} };
}

/** Durable + in-memory approval / auto-allow store (Pi “hooks that survive restart”). */
export class ApprovalStore {
  private readonly byId = new Map<string, ApprovalRequest>();
  private readonly autoApprovedByChat = new Map<string, Set<string>>();
  private hydratedChats = new Set<string>();

  constructor(private readonly query?: LakebaseQuery) {}

  private async hydrateChat(chatId: string): Promise<void> {
    if (!this.query || this.hydratedChats.has(chatId)) return;
    this.hydratedChats.add(chatId);

    const pending = await this.query(
      `SELECT id, chat_id, tool_call, status, decision, created_at, decided_at
       FROM bricksbot.approvals
       WHERE chat_id = $1 AND status = 'pending'`,
      [chatId],
    );
    for (const row of pending.rows) {
      const id = asString(row.id);
      if (this.byId.has(id)) continue;
      this.byId.set(id, {
        id,
        chatId: asString(row.chat_id),
        toolCall: parseToolCall(row.tool_call),
        status: asString(row.status) as ApprovalStatus,
        decision: row.decision
          ? (asString(row.decision) as ApprovalRequest['decision'])
          : undefined,
        createdAt: asString(row.created_at),
        decidedAt: row.decided_at ? asString(row.decided_at) : undefined,
      });
    }

    const autos = await this.query(
      `SELECT tool_name FROM bricksbot.auto_approvals WHERE chat_id = $1`,
      [chatId],
    );
    if (autos.rows.length > 0) {
      const set = this.autoApprovedByChat.get(chatId) ?? new Set<string>();
      for (const row of autos.rows) set.add(asString(row.tool_name));
      this.autoApprovedByChat.set(chatId, set);
    }
  }

  async create(chatId: string, toolCall: ToolCall): Promise<ApprovalRequest> {
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
        [request.id, chatId, JSON.stringify(toolCall)],
      );
    }
    return request;
  }

  async get(id: string): Promise<ApprovalRequest | null> {
    const cached = this.byId.get(id);
    if (cached) return cached;
    if (!this.query) return null;
    const result = await this.query(
      `SELECT id, chat_id, tool_call, status, decision, created_at, decided_at
       FROM bricksbot.approvals WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) return null;
    const request: ApprovalRequest = {
      id: asString(row.id),
      chatId: asString(row.chat_id),
      toolCall: parseToolCall(row.tool_call),
      status: asString(row.status) as ApprovalStatus,
      decision: row.decision ? (asString(row.decision) as ApprovalRequest['decision']) : undefined,
      createdAt: asString(row.created_at),
      decidedAt: row.decided_at ? asString(row.decided_at) : undefined,
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
        [chatId, toolName],
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

  async decide(id: string, decision: ApprovalDecision): Promise<ApprovalRequest> {
    const existing = (await this.get(id)) ?? this.byId.get(id);
    if (!existing) {
      throw new Error('Approval not found');
    }
    if (existing.status !== 'pending') {
      throw new Error('Approval already decided');
    }

    const isDenial = decision === 'denied' || decision === 'not_approved';
    const isAlways = decision === 'all_the_time' || decision === 'always';
    const status: ApprovalStatus = isDenial ? 'denied' : 'approved';
    const decisionKind = isDenial ? 'denied' : isAlways ? 'all_the_time' : 'once';

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
         WHERE id = $1`,
        [id, status, decisionKind],
      );
    }
    return updated;
  }
}
