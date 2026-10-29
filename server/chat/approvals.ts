import { randomUUID } from 'node:crypto';
import type {
  ApprovalDecision,
  ApprovalRequest,
  ApprovalStatus,
  ToolCall,
} from '../../shared/llm/types.js';

export class ApprovalStore {
  private readonly byId = new Map<string, ApprovalRequest>();
  private readonly autoApprovedByChat = new Map<string, Set<string>>();

  create(chatId: string, toolCall: ToolCall): ApprovalRequest {
    const request: ApprovalRequest = {
      id: randomUUID(),
      chatId,
      toolCall,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    this.byId.set(request.id, request);
    return request;
  }

  get(id: string): ApprovalRequest | null {
    return this.byId.get(id) ?? null;
  }

  listPending(chatId: string): ApprovalRequest[] {
    return [...this.byId.values()].filter((a) => a.chatId === chatId && a.status === 'pending');
  }

  isAutoApproved(chatId: string, toolName: string): boolean {
    return Boolean(this.autoApprovedByChat.get(chatId)?.has(toolName));
  }

  setAutoApproved(chatId: string, toolName: string): void {
    let set = this.autoApprovedByChat.get(chatId);
    if (!set) {
      set = new Set();
      this.autoApprovedByChat.set(chatId, set);
    }
    set.add(toolName);
  }

  revokeAutoApproved(chatId: string, toolName: string): void {
    this.autoApprovedByChat.get(chatId)?.delete(toolName);
  }

  clearAutoApproved(chatId: string): void {
    this.autoApprovedByChat.delete(chatId);
  }

  listAutoApproved(chatId: string): string[] {
    const set = this.autoApprovedByChat.get(chatId);
    return set ? [...set].sort() : [];
  }

  decide(id: string, decision: ApprovalDecision): ApprovalRequest {
    const existing = this.byId.get(id);
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
      this.setAutoApproved(existing.chatId, existing.toolCall.name);
    }

    const updated: ApprovalRequest = {
      ...existing,
      status,
      decision: decisionKind,
      decidedAt: new Date().toISOString(),
    };
    this.byId.set(id, updated);
    return updated;
  }
}
