import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { WorkspaceClient } from '@databricks/appkit';
import { isDatabricksProxyEnvironment } from '../chat/identity.js';
import { presentEnv } from './env.js';

type Env = Record<string, string | undefined>;

/**
 * True when there is no Databricks workspace to talk to: no host, no CLI profile and not
 * running as a Databricks App. `BRICKSBOT_OFFLINE=1` forces it on, `0` forces it off.
 * AppKit resolves the service user against a real workspace at startup, so without one
 * `npm run dev` would fail before serving anything.
 */
export function isOfflineMode(env: Env = process.env, hasCliConfig = defaultCliConfigExists()): boolean {
  const forced = presentEnv(env.BRICKSBOT_OFFLINE);
  if (forced === '1' || forced === 'true') return true;
  if (forced === '0' || forced === 'false') return false;
  if (isDatabricksProxyEnvironment(env)) return false;
  if (presentEnv(env.DATABRICKS_HOST) || presentEnv(env.DATABRICKS_CONFIG_PROFILE)) return false;
  return !hasCliConfig;
}

function defaultCliConfigExists(): boolean {
  const configured = presentEnv(process.env.DATABRICKS_CONFIG_FILE);
  return existsSync(configured ?? join(homedir(), '.databrickscfg'));
}

/**
 * Minimal stand-in for the workspace client AppKit needs at startup. It answers the
 * service-user lookup locally and refuses every other call, so nothing reaches the network.
 */
export function offlineWorkspaceClient(): WorkspaceClient {
  const refuse = () => Promise.reject(new Error('BricksBot is running offline: no Databricks workspace configured'));
  return {
    currentUser: { me: () => Promise.resolve({ id: 'offline-local-user' }) },
    getHost: () => Promise.reject(new Error('offline')),
    // AppKit reads the workspace id from this header on its SCIM `Me` probe.
    request: (req: { path?: string }) =>
      req?.path?.endsWith('/scim/v2/Me')
        ? Promise.resolve({ headers: new Headers({ 'x-databricks-org-id': '0' }), body: null })
        : refuse(),
  } as unknown as WorkspaceClient;
}
