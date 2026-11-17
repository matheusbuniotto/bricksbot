import type { McpConnectorInput, McpConnectorRecord, McpConnectorStore } from '../../../shared/agents/mcp-types.js';
import type { LakebaseQuery } from '../../chat/lakebase-store.js';
import { asBool, asString } from '../../lib/coerce.js';

function parseTools(value: unknown): string[] {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  }
  return Array.isArray(parsed) ? parsed.filter((tool): tool is string => typeof tool === 'string') : [];
}

function mapConnectorRow(row: Record<string, unknown>): McpConnectorRecord {
  return {
    userId: asString(row.user_id),
    service: asString(row.service),
    connected: asBool(row.connected),
    custom: asBool(row.is_custom),
    name: row.name == null ? undefined : asString(row.name),
    description: row.description == null ? undefined : asString(row.description),
    tools: parseTools(row.tools),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
  };
}

const CONNECTOR_COLUMNS = 'user_id, service, connected, is_custom, name, description, tools, created_at, updated_at';

export class LakebaseMcpConnectorStore implements McpConnectorStore {
  constructor(private readonly query: LakebaseQuery) {}

  async listConnectors(userId: string): Promise<McpConnectorRecord[]> {
    const result = await this.query(
      `SELECT ${CONNECTOR_COLUMNS} FROM bricksbot.mcp_connectors WHERE user_id = $1 ORDER BY service ASC`,
      [userId]
    );
    return result.rows.map(mapConnectorRow);
  }

  async getConnector(userId: string, service: string): Promise<McpConnectorRecord | null> {
    const result = await this.query(
      `SELECT ${CONNECTOR_COLUMNS} FROM bricksbot.mcp_connectors WHERE user_id = $1 AND service = $2`,
      [userId, service]
    );
    return result.rows[0] ? mapConnectorRow(result.rows[0]) : null;
  }

  async upsertConnector(input: McpConnectorInput): Promise<McpConnectorRecord> {
    const result = await this.query(
      `INSERT INTO bricksbot.mcp_connectors (user_id, service, connected, is_custom, name, description, tools, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW(), NOW())
       ON CONFLICT (user_id, service) DO UPDATE SET
         connected = EXCLUDED.connected,
         is_custom = EXCLUDED.is_custom,
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         tools = EXCLUDED.tools,
         updated_at = NOW()
       RETURNING ${CONNECTOR_COLUMNS}`,
      [
        input.userId,
        input.service,
        input.connected,
        input.custom,
        input.name ?? null,
        input.description ?? null,
        JSON.stringify(input.tools),
      ]
    );
    return mapConnectorRow(result.rows[0]);
  }

  async deleteConnector(userId: string, service: string): Promise<boolean> {
    const result = await this.query(
      `DELETE FROM bricksbot.mcp_connectors WHERE user_id = $1 AND service = $2 RETURNING service`,
      [userId, service]
    );
    return result.rows.length > 0;
  }
}
