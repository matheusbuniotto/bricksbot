export const VEGA_LITE_SCHEMA = 'https://vega.github.io/schema/vega-lite/v6.json';
const SUPPORTED_SCHEMA_PREFIXES = [
  'https://vega.github.io/schema/vega-lite/v5',
  'https://vega.github.io/schema/vega-lite/v6',
];
export const MAX_VEGA_SPEC_CHARS = 16_000;
export const MAX_CHART_ROWS = 1_000;

const ALLOWED_MARKS = new Set([
  'bar',
  'line',
  'area',
  'point',
  'circle',
  'square',
  'tick',
  'rect',
  'rule',
  'text',
  'boxplot',
  'arc',
]);

const TOP_LEVEL_FORMS = ['mark', 'layer', 'facet', 'hconcat', 'vconcat'] as const;

export type VegaSpec = Record<string, unknown>;
export type VegaCheck = { ok: true; spec: VegaSpec } | { ok: false; error: string };

function hasKeyDeep(value: unknown, key: string): boolean {
  if (Array.isArray(value)) return value.some((item) => hasKeyDeep(item, key));
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([k, v]) => k === key || hasKeyDeep(v, key));
  }
  return false;
}

function markNames(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) markNames(item, out);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === 'mark') {
        if (typeof v === 'string') out.push(v);
        else if (v && typeof v === 'object' && 'type' in v && typeof v.type === 'string') {
          out.push(v.type);
        } else out.push('');
      } else markNames(v, out);
    }
  }
  return out;
}

/**
 * Validate a Vega-Lite spec for pinning. `allowData` is true when checking a stored pin (rows are
 * already inline) and false for a model-supplied spec that the server will fill with query rows.
 */
export function validateVegaLiteSpec(input: unknown, options: { allowData: boolean }): VegaCheck {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'chart spec must be a JSON object' };
  }
  const spec = input as VegaSpec;
  if (!TOP_LEVEL_FORMS.some((form) => form in spec)) {
    return { ok: false, error: 'chart spec needs one of mark, layer, facet, hconcat, vconcat' };
  }
  if (hasKeyDeep(spec, 'url')) {
    return { ok: false, error: 'chart spec must not use url (remote data is not allowed)' };
  }
  if (!options.allowData && 'data' in spec) {
    return { ok: false, error: 'omit data from spec; rows come from the sql_query result' };
  }
  const schema = spec.$schema;
  if (typeof schema === 'string' && !SUPPORTED_SCHEMA_PREFIXES.some((prefix) => schema.startsWith(prefix))) {
    return { ok: false, error: 'only Vega-Lite v5 or v6 specs are supported' };
  }
  const marks = markNames(spec);
  const bad = marks.find((mark) => !ALLOWED_MARKS.has(mark));
  if (bad !== undefined) {
    return { ok: false, error: `mark "${bad}" is not allowed (use ${[...ALLOWED_MARKS].join(', ')})` };
  }
  if (!options.allowData && JSON.stringify(spec).length > MAX_VEGA_SPEC_CHARS) {
    return { ok: false, error: `chart spec is too long (max ${MAX_VEGA_SPEC_CHARS} chars before data)` };
  }
  return { ok: true, spec };
}
