import type { LlmUsage } from '../../shared/agents/types.js';
import type { CatalogModel } from '../agents/models.js';

export type CostSource = 'provider' | 'price_table' | 'unknown';

/** The provider's own figure when it reports a sane one (OpenRouter, USD; zero is a free model), else tokens times the catalog price, else unknown. */
export function costOf(
  usage: LlmUsage | undefined,
  model: CatalogModel | undefined
): { usd: number | null; source: CostSource } {
  if (usage?.cost !== undefined && usage.cost >= 0) return { usd: usage.cost, source: 'provider' };
  if (usage && model?.inputUsdPerMTok !== undefined && model.outputUsdPerMTok !== undefined) {
    const usd = (usage.promptTokens * model.inputUsdPerMTok + usage.completionTokens * model.outputUsdPerMTok) / 1e6;
    return { usd, source: 'price_table' };
  }
  return { usd: null, source: 'unknown' };
}
