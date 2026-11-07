import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { BricksbotPlugin, PluginInitializer, PluginMetadata } from '../../../shared/plugins/types.js';
import type { PluginHost } from '../host/plugin-host.js';

export interface VolumeLoaderOptions {
  volumeRoot?: string;
  host: PluginHost;
  logger?: {
    info(message: string, data?: unknown): void;
    warn(message: string, data?: unknown): void;
    error(message: string, error?: unknown): void;
  };
}

export interface VolumeLoadResult {
  loaded: PluginMetadata[];
  errors: Array<{ pluginName: string; error: string }>;
}

export class VolumePluginLoader {
  private readonly volumeRoot?: string;
  private readonly host: PluginHost;
  private readonly logger: NonNullable<VolumeLoaderOptions['logger']>;

  constructor(options: VolumeLoaderOptions) {
    this.volumeRoot = options.volumeRoot ?? process.env.BRICKSBOT_PLUGIN_VOLUME;
    this.host = options.host;
    this.logger = options.logger ?? {
      info: () => {},
      warn: () => {},
      error: () => {},
    };
  }

  async loadAll(): Promise<VolumeLoadResult> {
    const result: VolumeLoadResult = { loaded: [], errors: [] };
    if (!this.volumeRoot) {
      return result;
    }

    let entries: string[];
    try {
      entries = await fs.readdir(this.volumeRoot);
    } catch (err) {
      this.logger.warn(`Failed to read plugin volume directory: ${this.volumeRoot}`, err);
      return result;
    }

    for (const entry of entries) {
      const pluginDir = path.join(this.volumeRoot, entry);
      try {
        const stat = await fs.stat(pluginDir);
        if (!stat.isDirectory()) {
          continue;
        }

        const loadedMeta = await this.loadPluginDirectory(pluginDir, entry);
        if (loadedMeta) {
          result.loaded.push(loadedMeta);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`Error loading plugin from ${pluginDir}: ${message}`, err);
        result.errors.push({ pluginName: entry, error: message });
      }
    }

    return result;
  }

  private async loadPluginDirectory(pluginDir: string, fallbackName: string): Promise<PluginMetadata | null> {
    const candidateFiles = ['index.mjs', 'index.js'];
    let entryFile: string | null = null;

    for (const candidate of candidateFiles) {
      const fullPath = path.join(pluginDir, candidate);
      try {
        await fs.access(fullPath);
        entryFile = fullPath;
        break;
      } catch {
        // File does not exist, check next
      }
    }

    if (!entryFile) {
      return null;
    }

    let manifestMeta: Partial<PluginMetadata> = {};
    const manifestPath = path.join(pluginDir, 'manifest.json');
    try {
      const manifestRaw = await fs.readFile(manifestPath, 'utf-8');
      manifestMeta = JSON.parse(manifestRaw) as Partial<PluginMetadata>;
    } catch {
      // Manifest is optional
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

    let metadata: PluginMetadata;
    if (typeof target === 'function') {
      metadata = {
        name: manifestMeta.name ?? fallbackName,
        version: manifestMeta.version ?? '1.0.0',
        description: manifestMeta.description ?? `Plugin loaded from ${entryFile}`,
        author: manifestMeta.author,
      };
      await this.host.registerPlugin(target, metadata);
    } else {
      metadata = {
        name: target.metadata?.name ?? manifestMeta.name ?? fallbackName,
        version: target.metadata?.version ?? manifestMeta.version ?? '1.0.0',
        description: target.metadata?.description ?? manifestMeta.description ?? `Plugin loaded from ${entryFile}`,
        author: target.metadata?.author ?? manifestMeta.author,
      };
      await this.host.registerPlugin({ ...target, metadata });
    }

    this.logger.info(`Loaded plugin "${metadata.name}" version ${metadata.version}`);
    return metadata;
  }
}
