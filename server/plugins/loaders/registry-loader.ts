import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  BricksbotPlugin,
  PluginInitializer,
  PluginMetadata,
  PluginRecord,
  PluginRegistryStore,
} from '../../../shared/plugins/types.js';
import type { PluginHost } from '../host/plugin-host.js';

export interface RegistryPluginLoaderOptions {
  store: PluginRegistryStore;
  host: PluginHost;
  logger?: {
    info(message: string, data?: unknown): void;
    warn(message: string, data?: unknown): void;
    error(message: string, error?: unknown): void;
  };
}

export interface RegistryLoadResult {
  loaded: PluginMetadata[];
  skipped: string[];
  errors: Array<{ pluginName: string; error: string }>;
}

export class RegistryPluginLoader {
  private readonly store: PluginRegistryStore;
  private readonly host: PluginHost;
  private readonly logger: NonNullable<RegistryPluginLoaderOptions['logger']>;

  constructor(options: RegistryPluginLoaderOptions) {
    this.store = options.store;
    this.host = options.host;
    this.logger = options.logger ?? {
      info: () => {},
      warn: () => {},
      error: () => {},
    };
  }

  async loadEnabled(): Promise<RegistryLoadResult> {
    const result: RegistryLoadResult = { loaded: [], skipped: [], errors: [] };
    const records = await this.store.listPlugins();

    for (const record of records) {
      if (!record.enabled) {
        result.skipped.push(record.name);
        continue;
      }

      try {
        const meta = await this.loadSinglePlugin(record);
        if (meta) {
          result.loaded.push(meta);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`Error loading plugin ${record.name}: ${message}`, err);
        result.errors.push({ pluginName: record.name, error: message });
      }
    }

    return result;
  }

  private async loadSinglePlugin(record: PluginRecord): Promise<PluginMetadata | null> {
    let entryFile = record.sourcePath;
    const stat = await fs.stat(entryFile).catch(() => null);
    if (stat?.isDirectory()) {
      const candidates = ['index.mjs', 'index.js'];
      let found = false;
      for (const candidate of candidates) {
        const candidatePath = path.join(entryFile, candidate);
        if (
          await fs
            .access(candidatePath)
            .then(() => true)
            .catch(() => false)
        ) {
          entryFile = candidatePath;
          found = true;
          break;
        }
      }
      if (!found) {
        throw new Error(`Directory ${record.sourcePath} does not contain index.mjs or index.js`);
      }
    }

    const fileUrl = `${pathToFileURL(entryFile).href}?t=${Date.now()}`;
    const moduleExports = (await import(fileUrl)) as {
      default?: BricksbotPlugin | PluginInitializer;
      plugin?: BricksbotPlugin;
    };

    const target = moduleExports.default ?? moduleExports.plugin;
    if (!target) {
      throw new Error(`Module ${entryFile} must export a default plugin or initializer`);
    }

    const metadata: PluginMetadata = {
      name: record.name,
      version: typeof target === 'object' && target.metadata?.version ? target.metadata.version : '1.0.0',
      description:
        typeof target === 'object' && target.metadata?.description
          ? target.metadata.description
          : `Plugin ${record.name}`,
    };

    if (typeof target === 'function') {
      await this.host.registerPlugin(target, metadata);
    } else {
      await this.host.registerPlugin({ ...target, metadata });
    }

    this.logger.info(`Registered registry plugin "${record.name}"`);
    return metadata;
  }
}
