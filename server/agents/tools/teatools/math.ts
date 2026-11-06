/**
 * Pure TypeScript statistical distributions and helpers for the teatools MCP plugin.
 * No external runtime dependencies.
 */

export type Direction = 'two-sided' | 'greater' | 'less';
export type MetricType = 'mean' | 'ratio' | 'proportion' | 'quantile' | 'bootstrap';
export type BootstrapStatistic = 'mean' | 'median' | 'std' | 'trimmed_mean_10';
export type MultipleTesting = 'none' | 'holm' | 'bh';
export type Audience = 'technical' | 'stakeholder';

export interface MetricSpec {
  name: string;
  type: MetricType;
  column?: string;
  numer?: string;
  denom?: string;
  alternative?: Direction;
  higher_is_better?: boolean;
  q?: number;
  statistic?: BootstrapStatistic;
}

export interface RobustSpec {
  winsorize_pct: number;
  test?: 'yuen';
}

export function cleanFloat(x: unknown): number | null {
  if (x === null || x === undefined) return null;
  const n = Number(x);
  if (!Number.isFinite(n)) return null;
  return n;
}

export function checkAlpha(alpha: unknown, name = 'alpha'): number {
  const n = Number(alpha);
  if (typeof alpha === 'boolean' || !Number.isFinite(n) || n <= 0 || n >= 1) {
    throw new Error(`${name} must be in (0, 1), got ${String(alpha)}`);
  }
  return n;
}

export function validateMetric(
  raw: Record<string, unknown> | MetricSpec
): Required<Pick<MetricSpec, 'name' | 'type' | 'alternative' | 'higher_is_better'>> & MetricSpec {
  if (!raw || typeof raw !== 'object') {
    throw new Error('metric must be an object');
  }
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name) throw new Error('metric.name must be a non-empty string');

  const type = raw.type as MetricType;
  if (!['mean', 'ratio', 'proportion', 'quantile', 'bootstrap'].includes(type)) {
    throw new Error(`metric ${name}: type must be mean, ratio, proportion, quantile, or bootstrap`);
  }

  const alternative: Direction = (raw.alternative as Direction) ?? 'two-sided';
  if (!['two-sided', 'greater', 'less'].includes(alternative)) {
    throw new Error(`metric ${name}: alternative must be two-sided, greater, or less`);
  }

  const higher_is_better = raw.higher_is_better !== false;
  const out: ReturnType<typeof validateMetric> = {
    name,
    type,
    alternative,
    higher_is_better,
  };

  if (type === 'ratio') {
    if (typeof raw.numer !== 'string' || !raw.numer.trim() || typeof raw.denom !== 'string' || !raw.denom.trim()) {
      throw new Error(`ratio metric ${name} needs string 'numer' and 'denom' columns`);
    }
    out.numer = raw.numer.trim();
    out.denom = raw.denom.trim();
  } else {
    const col = typeof raw.column === 'string' && raw.column.trim() ? raw.column.trim() : name;
    out.column = col;
  }

  if (type === 'quantile') {
    const q = raw.q !== undefined ? Number(raw.q) : 0.5;
    if (!Number.isFinite(q) || q <= 0 || q >= 1) {
      throw new Error(`quantile metric ${name}: q must be in (0, 1)`);
    }
    out.q = q;
  }

  if (type === 'bootstrap') {
    const stat = (raw.statistic as BootstrapStatistic) ?? 'mean';
    if (!['mean', 'median', 'std', 'trimmed_mean_10'].includes(stat)) {
      throw new Error(`bootstrap metric ${name}: statistic must be mean, median, std, or trimmed_mean_10`);
    }
    out.statistic = stat;
  }

  return out;
}

/** Seeded PRNG (Mulberry32) for deterministic bootstrap resamples. */
export class SeededRng {
  private state: number;

  constructor(seed: number) {
    this.state = (Math.floor(seed) | 0) ^ 0x6d2b79f5;
  }

  nextFloat(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  nextInt(maxExclusive: number): number {
    return Math.floor(this.nextFloat() * maxExclusive);
  }
}

/** Error function approximation (Abramowitz & Stegun 7.1.26). */
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

export function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

export function normalSf(z: number): number {
  return 0.5 * (1 - erf(z / Math.SQRT2));
}

/** Acklam's inverse normal CDF approximation. */
export function normalQuantile(p: number): number {
  if (p <= 0 || p >= 1) throw new RangeError(`p must be in (0, 1), got ${p}`);
  if (p === 0.5) return 0;

  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1,
    2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968,
    2.938163982698783,
  ];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p <= pHigh) {
    const q = p - 0.5;
    const r = q * q;
    return (
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    );
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(
    (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  );
}

/** Log-gamma function (Lanczos approximation). */
function logGamma(z: number): number {
  const g = 7;
  const p = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) {
    return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
  }
  z -= 1;
  let x = p[0];
  for (let i = 1; i < g + 2; i++) {
    x += p[i] / (z + i);
  }
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/** Regularized incomplete beta function I_x(a, b) via continued fraction (Lentz). */
function betainc(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lnBeta = logGamma(a) + logGamma(b) - logGamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lnBeta);
  if (x < (a + 1) / (a + b + 2)) {
    return (front * betaCf(x, a, b)) / a;
  }
  return 1 - (front * betaCf(1 - x, b, a)) / b;
}

function betaCf(x: number, a: number, b: number): number {
  const maxIter = 200;
  const eps = 3e-14;
  const fpmin = 1e-30;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < fpmin) d = fpmin;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= maxIter; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < fpmin) d = fpmin;
    c = 1 + aa / c;
    if (Math.abs(c) < fpmin) c = fpmin;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < fpmin) d = fpmin;
    c = 1 + aa / c;
    if (Math.abs(c) < fpmin) c = fpmin;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < eps) break;
  }
  return h;
}

/** Student's t CDF and survival function. */
export function tCdf(t: number, df: number): number {
  if (!Number.isFinite(df) || df <= 0) return Number.NaN;
  if (df > 1e7) return normalCdf(t);
  const x = df / (df + t * t);
  const p = 0.5 * betainc(x, df / 2, 0.5);
  return t >= 0 ? 1 - p : p;
}

export function tSf(t: number, df: number): number {
  return 1 - tCdf(t, df);
}

/** Student's t quantile (inverse CDF) via Newton-Raphson refined from Hill's expansion. */
export function tQuantile(p: number, df: number): number {
  if (p <= 0 || p >= 1) throw new RangeError(`p must be in (0, 1), got ${p}`);
  if (p === 0.5) return 0;
  if (df > 1e6) return normalQuantile(p);
  const z = normalQuantile(p);
  const z2 = z * z;
  let x = z + (z * (z2 + 1)) / (4 * df) + (z * (5 * z2 * z2 + 16 * z2 + 3)) / (96 * df * df);
  for (let i = 0; i < 12; i++) {
    const err = tCdf(x, df) - p;
    if (Math.abs(err) < 1e-12) break;
    const lnPdf =
      logGamma((df + 1) / 2) -
      0.5 * Math.log(df * Math.PI) -
      logGamma(df / 2) -
      ((df + 1) / 2) * Math.log(1 + (x * x) / df);
    const pdf = Math.exp(lnPdf);
    if (pdf <= 0) break;
    x -= err / pdf;
  }
  return x;
}

/** Regularized upper incomplete gamma Q(a, x) for chi-square survival function. */
function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  const lnG = logGamma(a);
  if (x < a + 1) {
    let ap = a;
    let sum = 1 / a;
    let del = sum;
    for (let n = 1; n <= 200; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 3e-14) break;
    }
    const p = sum * Math.exp(-x + a * Math.log(x) - lnG);
    return Math.max(0, 1 - p);
  }
  const fpmin = 1e-30;
  let b = x + 1 - a;
  let c = 1 / fpmin;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= 200; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < fpmin) d = fpmin;
    c = b + an / c;
    if (Math.abs(c) < fpmin) c = fpmin;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-14) break;
  }
  return Math.max(0, Math.min(1, Math.exp(-x + a * Math.log(x) - lnG) * h));
}

export function chiSquareSf(x: number, df: number): number {
  if (x <= 0) return 1;
  return gammaQ(df / 2, x / 2);
}

export function mean(xs: readonly number[]): number {
  if (xs.length === 0) return Number.NaN;
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i];
  return s / xs.length;
}

export function sampleVariance(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (let i = 0; i < xs.length; i++) {
    const d = xs[i] - m;
    s += d * d;
  }
  return s / (xs.length - 1);
}

export function sampleStd(xs: readonly number[]): number {
  return Math.sqrt(sampleVariance(xs));
}

export function sampleCovariance(xs: readonly number[], ys: readonly number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  const mx = mean(xs);
  const my = mean(ys);
  let s = 0;
  for (let i = 0; i < n; i++) {
    s += (xs[i] - mx) * (ys[i] - my);
  }
  return s / (n - 1);
}

export function quantileSorted(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  if (q <= 0) return sorted[0];
  if (q >= 1) return sorted[sorted.length - 1];
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (base + 1 < sorted.length) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

export function quantile(xs: readonly number[], q: number): number {
  const sorted = [...xs].sort((a, b) => a - b);
  return quantileSorted(sorted, q);
}

export function trimMean(xs: readonly number[], proportionToCut: number): number {
  if (xs.length === 0) return Number.NaN;
  const sorted = [...xs].sort((a, b) => a - b);
  const g = Math.floor(proportionToCut * sorted.length);
  const sliced = sorted.slice(g, sorted.length - g);
  return mean(sliced);
}
