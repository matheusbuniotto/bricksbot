import type { Request, Response } from 'express';
import type { PluginHost } from './host/plugin-host.js';
import type { VolumePluginLoader } from './loaders/volume-loader.js';
import type { RegistryPluginLoader } from './loaders/registry-loader.js';
import type { PluginRegistryStore } from '../../shared/plugins/types.js';
import { resolveOwnerId } from '../chat/identity.js';

export type PluginHttpApp = {
  get(path: string, handler: (req: Request, res: Response) => unknown): unknown;
  post(path: string, handler: (req: Request, res: Response) => unknown): unknown;
};

export interface PluginRoutesOptions {
  pluginHost: PluginHost;
  volumeLoader?: VolumePluginLoader;
  registryLoader?: RegistryPluginLoader;
  registryStore?: PluginRegistryStore;
  /** Lower-cased emails allowed to reload plugins (`BRICKSBOT_PLUGIN_ADMINS`). Empty means nobody. */
  admins?: string[];
  logger?: {
    info(message: string, data?: unknown): void;
    warn(message: string, data?: unknown): void;
    error(message: string, error?: unknown): void;
  };
}

export function registerPluginRoutes(app: PluginHttpApp, options: PluginRoutesOptions): void {
  const { pluginHost, volumeLoader, registryLoader, registryStore } = options;
  const admins = new Set((options.admins ?? []).map((a) => a.trim().toLowerCase()).filter(Boolean));

  app.get('/api/plugins', async (req: Request, res: Response) => {
    try {
      resolveOwnerId(req);
      const plugins = pluginHost.listPlugins();
      const registryRecords = registryStore ? await registryStore.listPlugins() : [];
      const registryMap = new Map(registryRecords.map((r) => [r.name, r]));

      const responsePayload = plugins.map((p) => {
        const record = registryMap.get(p.metadata.name);
        return {
          ...p,
          enabled: record ? record.enabled : true,
          source: record ? record.source : 'volume',
        };
      });

      res.status(200).json({ plugins: responsePayload });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `Failed to list plugins: ${message}` });
    }
  });

  app.post('/api/plugins/reload', async (req: Request, res: Response) => {
    // Reloading re-runs plugin code as the App, so only named operators may trigger it.
    let caller: string;
    try {
      caller = resolveOwnerId(req);
    } catch {
      res.status(401).json({ ok: false, error: 'Authentication required' });
      return;
    }
    if (!admins.has(caller)) {
      res.status(403).json({ ok: false, error: 'Plugin reload is limited to BRICKSBOT_PLUGIN_ADMINS' });
      return;
    }
    try {
      const loaded: unknown[] = [];
      const errors: Array<{ pluginName: string; error: string }> = [];

      if (volumeLoader) {
        const volResult = await volumeLoader.loadAll();
        loaded.push(...volResult.loaded);
        errors.push(...volResult.errors);
      }

      if (registryLoader) {
        const regResult = await registryLoader.loadEnabled();
        loaded.push(...regResult.loaded);
        errors.push(...regResult.errors);
      }

      const ok = errors.length === 0;
      res.status(200).json({ ok, loaded, errors });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: `Failed to reload plugins: ${message}` });
    }
  });
}
