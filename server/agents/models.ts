import type { ModelOption } from '../../shared/agents/types.js';
import { presentEnv } from '../lib/env.js';

/** A catalog entry; the optional prices (USD per million tokens) feed the cost estimate when the provider reports none. */
export interface CatalogModel extends ModelOption {
  inputUsdPerMTok?: number;
  outputUsdPerMTok?: number;
}

/** The operator's allow-list of models. Owners pick from it; nothing outside it is ever sent to the provider. */
export class ModelCatalog {
  private readonly byId: Map<string, CatalogModel>;

  /** `defaultId` is the client's own model, used when a bot or routine picks none. */
  constructor(
    readonly models: CatalogModel[] = [],
    readonly defaultId?: string
  ) {
    this.byId = new Map(models.map((model) => [model.id, model]));
  }

  get(id: string): CatalogModel | undefined {
    return this.byId.get(id);
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  /** The first candidate still in the catalog (routine, then bot). Undefined means the client default. */
  resolve(...ids: Array<string | null | undefined>): CatalogModel | undefined {
    for (const id of ids) {
      const model = id ? this.byId.get(id) : undefined;
      if (model) return model;
    }
    return undefined;
  }

  /** What the UI sees: no prices. */
  options(): ModelOption[] {
    return this.models.map(({ id, label, contextWindow }) => ({
      id,
      label,
      ...(contextWindow ? { contextWindow } : {}),
    }));
  }
}

const positive = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;

function parseEntry(raw: unknown): CatalogModel | null {
  const entry = typeof raw === 'string' ? { id: raw } : (raw as Record<string, unknown> | null);
  const id = typeof entry?.id === 'string' ? entry.id.trim() : '';
  if (!id) return null;
  return {
    id,
    label: typeof entry?.label === 'string' && entry.label.trim() ? entry.label.trim() : id,
    contextWindow: positive(entry?.contextWindow),
    inputUsdPerMTok: positive(entry?.inputUsdPerMTok),
    outputUsdPerMTok: positive(entry?.outputUsdPerMTok),
  };
}

/**
 * `BRICKSBOT_MODELS` is a JSON array of ids or `{ id, label?, contextWindow?, inputUsdPerMTok?, outputUsdPerMTok? }`.
 * Unset means just the client's own model. Ids containing `fast` are dropped.
 */
export function modelCatalogFromEnv(
  env: Record<string, string | undefined>,
  defaultModel?: string,
  warn: (message: string) => void = console.warn
): ModelCatalog {
  let entries: unknown[] = defaultModel ? [defaultModel] : [];
  const raw = presentEnv(env.BRICKSBOT_MODELS);
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error('not an array');
      entries = parsed;
    } catch {
      warn('[bricksbot] BRICKSBOT_MODELS is not a JSON array; using the default model only');
    }
  }
  const models = new Map<string, CatalogModel>();
  for (const entry of entries) {
    const model = parseEntry(entry);
    if (!model) continue;
    if (/fast/i.test(model.id)) {
      warn(`[bricksbot] Model "${model.id}" contains "fast" and is not offered`);
      continue;
    }
    models.set(model.id, model);
  }
  return new ModelCatalog([...models.values()], defaultModel);
}
