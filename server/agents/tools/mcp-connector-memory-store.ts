import type { McpConnectorInput, McpConnectorRecord, McpConnectorStore } from '../../../shared/agents/mcp-types.js';
import { nowIso } from '../../lib/coerce.js';

function connectorKey(userId: string, service: string): string {
  return `${userId}\u0000${service}`;
}

export class MemoryMcpConnectorStore implements McpConnectorStore {
  private readonly records = new Map<string, McpConnectorRecord>();

  listConnectors(userId: string): Promise<McpConnectorRecord[]> {
    return Promise.resolve(
      [...this.records.values()]
        .filter((record) => record.userId === userId)
        .sort((a, b) => a.service.localeCompare(b.service))
    );
  }

  getConnector(userId: string, service: string): Promise<McpConnectorRecord | null> {
    return Promise.resolve(this.records.get(connectorKey(userId, service)) ?? null);
  }

  upsertConnector(input: McpConnectorInput): Promise<McpConnectorRecord> {
    const key = connectorKey(input.userId, input.service);
    const now = nowIso();
    const record: McpConnectorRecord = {
      ...input,
      tools: [...input.tools],
      createdAt: this.records.get(key)?.createdAt ?? now,
      updatedAt: now,
    };
    this.records.set(key, record);
    return Promise.resolve(record);
  }

  deleteConnector(userId: string, service: string): Promise<boolean> {
    return Promise.resolve(this.records.delete(connectorKey(userId, service)));
  }
}
