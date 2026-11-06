import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SKILL_PACK_CATALOG, type SkillPackCatalogEntry } from '../../../shared/agents/skill-packs.js';

function defaultSkillsRoot(): string {
  const fromCwd = path.resolve(process.cwd(), 'skills');
  return fromCwd;
}

function fallbackSkillsRoot(): string {
  try {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    return path.resolve(dir, '../../../skills');
  } catch {
    return defaultSkillsRoot();
  }
}

export interface BundledSkillPack {
  entry: SkillPackCatalogEntry;
  body: string;
  resources: Record<string, string>;
}

const packCache = new Map<string, BundledSkillPack>();

async function readSafeFile(roots: string[], relPath: string): Promise<string | null> {
  if (relPath.includes('..') || path.isAbsolute(relPath)) return null;
  for (const root of roots) {
    const candidate = path.resolve(root, relPath);
    if (!candidate.startsWith(path.resolve(root))) continue;
    try {
      return await fs.readFile(candidate, 'utf8');
    } catch {
      // try next root
    }
  }
  return null;
}

export function findSkillPackCatalogEntry(name: string): SkillPackCatalogEntry | undefined {
  const needle = name.trim().toLowerCase();
  return SKILL_PACK_CATALOG.find((entry) => entry.name.toLowerCase() === needle);
}

/**
 * Load a bundled skill pack from `skills/<name>/` (SKILL.md + declared resources).
 */
export async function loadBundledSkillPack(
  name: string,
  options: { skillsRoot?: string } = {}
): Promise<BundledSkillPack | null> {
  const entry = findSkillPackCatalogEntry(name);
  if (!entry) return null;

  if (!options.skillsRoot && packCache.has(entry.name)) {
    return packCache.get(entry.name)!;
  }

  const roots = options.skillsRoot ? [options.skillsRoot] : [defaultSkillsRoot(), fallbackSkillsRoot()];
  const resources: Record<string, string> = {};

  for (const resPath of entry.resources) {
    const content = await readSafeFile(roots, path.join(entry.name, resPath));
    if (content !== null) {
      resources[resPath] = content.trim();
    }
  }

  const body = resources['SKILL.md'];
  if (!body) return null;

  const loaded: BundledSkillPack = { entry, body, resources };
  if (!options.skillsRoot) {
    packCache.set(entry.name, loaded);
  }
  return loaded;
}
