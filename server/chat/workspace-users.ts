import type { WorkspaceUser, WorkspaceUserDirectory } from '../../shared/chat/types.js';
import { createDatabricksTokenProvider, normalizeHostUrl } from './databricks-auth.js';
import { presentEnv } from '../lib/env.js';

interface ScimUserResource {
  id?: string;
  userName?: string;
  displayName?: string;
  active?: boolean;
  emails?: Array<{ value?: string; primary?: boolean }>;
}

interface ScimListUsersResponse {
  Resources?: ScimUserResource[];
}

export interface DatabricksWorkspaceUserDirectoryOptions {
  host?: string;
  getToken?: () => Promise<string>;
  fetchImpl?: typeof fetch;
}

function escapeScimString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function mapScimUser(raw: ScimUserResource): WorkspaceUser | null {
  const email = (raw.userName ?? raw.emails?.find((e) => e.primary)?.value ?? raw.emails?.[0]?.value ?? '')
    .trim()
    .toLowerCase();
  if (!email) return null;
  return {
    id: String(raw.id ?? email),
    userName: email,
    displayName: (raw.displayName ?? email.split('@')[0] ?? email).trim(),
    active: raw.active !== false,
  };
}

export class DatabricksWorkspaceUserDirectory implements WorkspaceUserDirectory {
  private readonly host: string | undefined;
  private readonly getToken: (() => Promise<string>) | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(options: DatabricksWorkspaceUserDirectoryOptions = {}) {
    const rawHost = presentEnv(options.host ?? process.env.DATABRICKS_HOST ?? process.env.DATABRICKS_WORKSPACE_URL);
    this.host = rawHost ? normalizeHostUrl(rawHost) : undefined;
    this.getToken = options.getToken ?? createDatabricksTokenProvider({ purpose: 'app' });
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  private async queryScim(filter: string, count: number): Promise<WorkspaceUser[]> {
    if (!this.host || !this.getToken) {
      throw new Error('Databricks workspace host or credentials are not configured');
    }
    const token = await this.getToken();
    const params = new URLSearchParams({
      filter,
      count: String(count),
      attributes: 'id,userName,displayName,active,emails',
    });
    const res = await this.fetchImpl(`${this.host}/api/2.0/preview/scim/v2/Users?${params.toString()}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/scim+json, application/json',
      },
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Databricks SCIM user lookup failed (${res.status}): ${detail || res.statusText}`);
    }
    const body = (await res.json()) as ScimListUsersResponse;
    const users: WorkspaceUser[] = [];
    for (const item of body.Resources ?? []) {
      const mapped = mapScimUser(item);
      if (mapped && mapped.active) {
        users.push(mapped);
      }
    }
    return users;
  }

  async searchUsers(query: string, limit = 8): Promise<WorkspaceUser[]> {
    const clean = query.trim();
    if (clean.length < 2) return [];
    const escaped = escapeScimString(clean);
    const filter = `active eq true and (userName co "${escaped}" or displayName co "${escaped}")`;
    const users = await this.queryScim(filter, Math.max(1, Math.min(limit, 25)));
    return users.slice(0, limit);
  }

  async findActiveUserByEmail(email: string): Promise<WorkspaceUser | null> {
    const clean = email.trim().toLowerCase();
    if (!clean) return null;
    const escaped = escapeScimString(clean);
    const filter = `active eq true and userName eq "${escaped}"`;
    const users = await this.queryScim(filter, 5);
    return users.find((u) => u.userName === clean && u.active) ?? null;
  }
}
