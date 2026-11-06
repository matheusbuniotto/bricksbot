import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  type Audience,
  checkAlpha,
  chiSquareSf,
  cleanFloat,
  type Direction,
  mean,
  type MetricSpec,
  type MultipleTesting,
  normalQuantile,
  quantileSorted,
  type RobustSpec,
  sampleCovariance,
  sampleStd,
  sampleVariance,
  SeededRng,
  tCdf,
  trimMean,
  tQuantile,
  tSf,
  validateMetric,
} from './math.js';

export const SRM_ALPHA_DEFAULT = 0.001;

// In-memory store for pre-registered experiment plans (keyed by plan_id).
const planStore = new Map<string, Record<string, unknown>>();

export function getSavedPlan(planId: string): Record<string, unknown> | undefined {
  return planStore.get(planId);
}

function asStr(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return fallback;
}

function slug(text: string, maxLen = 40): string {
  const s = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s.slice(0, maxLen).replace(/-+$/, '') || 'plan';
}

function metricDef(m: MetricSpec): string {
  if (m.type === 'quantile') return `${m.q ?? 0.5}-quantile of \`${m.column ?? m.name}\``;
  if (m.type === 'bootstrap') return `${m.statistic ?? 'mean'} of \`${m.column ?? m.name}\``;
  if (m.type === 'ratio') return `ratio of means \`mean(${m.numer}) / mean(${m.denom})\` (delta method)`;
  if (m.type === 'proportion') return `proportion of units with \`${m.column ?? m.name} == 1\``;
  return `mean of \`${m.column ?? m.name}\` per unit`;
}

function ttMethod(m: MetricSpec): string {
  if (m.type === 'quantile') return 'Quantile (bootstrap CI)';
  if (m.type === 'bootstrap') return 'Bootstrap (bootstrap CI)';
  if (m.type === 'ratio') return 'RatioOfMeans (Welch t-test, delta method)';
  if (m.type === 'proportion') return 'Proportion (two-proportion z-test)';
  return 'Mean (Welch t-test)';
}

// --------------------------------------------------------------------------- power

export interface PowerInput {
  metric: MetricSpec | Record<string, unknown>;
  baseline_mean: number;
  baseline_std?: number | null;
  mde_rel?: number;
  alpha?: number;
  power?: number;
  ratio?: number;
  cuped_r2?: number | null;
  non_inferiority_margin?: number | null;
  alternative?: Direction;
}

export function power(input: PowerInput): Record<string, unknown> {
  const m = validateMetric(input.metric);
  const alt: Direction = input.alternative ?? m.alternative;
  const alpha = checkAlpha(input.alpha ?? 0.05, 'alpha');
  const targetPower = checkAlpha(input.power ?? 0.8, 'power');
  const ratio = Number(input.ratio ?? 1.0);
  if (!Number.isFinite(ratio) || ratio <= 0) {
    throw new Error('ratio must be > 0 (treatment size / control size)');
  }
  const baselineMean = Number(input.baseline_mean);
  if (!Number.isFinite(baselineMean) || baselineMean === 0) {
    throw new Error('baseline_mean must be a non-zero finite number');
  }
  const niMargin =
    input.non_inferiority_margin !== undefined && input.non_inferiority_margin !== null
      ? Number(input.non_inferiority_margin)
      : null;
  const mdeRel = niMargin !== null && niMargin > 0 ? niMargin : Number(input.mde_rel ?? 0.05);
  if (!Number.isFinite(mdeRel) || mdeRel === 0) {
    throw new Error('mde_rel must be non-zero');
  }
  if ((alt === 'greater' && mdeRel < 0) || (alt === 'less' && mdeRel > 0)) {
    throw new Error(`mde_rel=${mdeRel} has the wrong sign for alternative=${alt}`);
  }
  if (!['mean', 'ratio', 'proportion'].includes(m.type)) {
    throw new Error(`power() supports mean, ratio and proportion metrics, not ${m.type}`);
  }

  let stdSource = 'given';
  let baselineStd = input.baseline_std !== undefined && input.baseline_std !== null ? Number(input.baseline_std) : null;
  if (m.type === 'proportion') {
    if (baselineMean <= 0 || baselineMean >= 1) {
      throw new Error('proportion baseline_mean must be in (0, 1)');
    }
    if (baselineStd === null) {
      baselineStd = Math.sqrt(baselineMean * (1 - baselineMean));
      stdSource = 'sqrt(p*(1-p)) (Bernoulli)';
    }
  }
  if (baselineStd === null || !Number.isFinite(baselineStd) || baselineStd <= 0) {
    throw new Error(`baseline_std (> 0) is required for ${m.type} metrics`);
  }

  let cupedR2: number | null = null;
  if (input.cuped_r2 !== undefined && input.cuped_r2 !== null) {
    cupedR2 = Number(input.cuped_r2);
    if (!Number.isFinite(cupedR2) || cupedR2 < 0 || cupedR2 >= 1) {
      throw new Error('cuped_r2 must be in [0, 1)');
    }
  }

  const mdeAbs = Math.abs(baselineMean * mdeRel);
  const effVar = baselineStd * baselineStd * (cupedR2 !== null ? 1 - cupedR2 : 1);
  const zAlpha = alt === 'two-sided' ? normalQuantile(1 - alpha / 2) : normalQuantile(1 - alpha);
  const zBeta = normalQuantile(targetPower);

  const nControl = Math.ceil(((1 + 1 / ratio) * effVar * (zAlpha + zBeta) ** 2) / (mdeAbs * mdeAbs));
  const nTreatment = Math.ceil(nControl * ratio);
  const totalN = nControl + nTreatment;

  return {
    n_per_arm: nControl,
    n_control: nControl,
    n_treatment: nTreatment,
    total_n: totalN,
    mde_abs: baselineMean * mdeRel,
    mde_rel: mdeRel,
    assumptions: {
      metric: m.name,
      metric_type: m.type,
      baseline_mean: baselineMean,
      baseline_std: baselineStd,
      std_source: stdSource,
      alpha,
      power: targetPower,
      alternative: alt,
      ratio,
      cuped_r2: cupedR2,
      non_inferiority_margin: niMargin,
      method:
        m.type === 'proportion'
          ? 'two-proportion normal power analysis'
          : `Welch t-test power analysis${cupedR2 ? ' with CUPED variance reduction' : ''}`,
    },
  };
}

// --------------------------------------------------------------------------- design

export interface DesignInput {
  hypothesis: string;
  primary_metric: MetricSpec | Record<string, unknown>;
  guardrails?: Array<MetricSpec | Record<string, unknown>>;
  trial_type?: 'superiority' | 'non_inferiority' | 'equivalence';
  non_inferiority_margin?: number | null;
  unit?: string;
  alpha?: number;
  mde_rel?: number;
  direction?: Direction;
  min_duration_days?: number;
  baseline_mean?: number | null;
  baseline_std?: number | null;
}

export function design(input: DesignInput): Record<string, unknown> {
  const hypothesis = typeof input.hypothesis === 'string' ? input.hypothesis.trim() : '';
  if (!hypothesis) throw new Error('hypothesis must be a non-empty string');

  const alpha = checkAlpha(input.alpha ?? 0.05, 'alpha');
  const direction: Direction = input.direction ?? 'two-sided';
  if (!['two-sided', 'greater', 'less'].includes(direction)) {
    throw new Error('direction must be two-sided, greater, or less');
  }
  const mdeRel = Number(input.mde_rel ?? 0.05);
  if (!Number.isFinite(mdeRel) || mdeRel === 0) {
    throw new Error('mde_rel must be a non-zero finite number (e.g. 0.05 for +5%)');
  }
  if ((direction === 'greater' && mdeRel < 0) || (direction === 'less' && mdeRel > 0)) {
    throw new Error(`mde_rel=${mdeRel} has the wrong sign for direction=${direction}`);
  }

  const trialType = input.trial_type ?? 'superiority';
  const niMargin =
    input.non_inferiority_margin !== undefined && input.non_inferiority_margin !== null
      ? Number(input.non_inferiority_margin)
      : null;
  const minDurationDays = input.min_duration_days ?? 7;

  const primary = validateMetric({ ...input.primary_metric, alternative: direction });
  const guards = (input.guardrails ?? []).map((g) => {
    if (g && typeof g === 'object' && 'metric' in g && typeof g.metric === 'object' && g.metric !== null) {
      return validateMetric(g.metric as Record<string, unknown>);
    }
    return validateMetric(g);
  });

  const names = [primary.name, ...guards.map((g) => g.name)];
  if (new Set(names).size !== names.length) {
    throw new Error(`metric names must be unique, got ${names.join(', ')}`);
  }

  const unit = (input.unit ?? 'user').trim() || 'user';
  let sampleSize: Record<string, unknown> | null = null;
  if (input.baseline_mean !== undefined && input.baseline_mean !== null) {
    sampleSize = power({
      metric: primary,
      baseline_mean: input.baseline_mean,
      baseline_std: input.baseline_std,
      mde_rel: mdeRel,
      alpha,
      alternative: direction,
      non_inferiority_margin: niMargin,
    });
  }

  const created = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const digest = crypto
    .createHash('sha256')
    .update(JSON.stringify({ hypothesis, primary, guards, unit, alpha, mdeRel, direction, created }))
    .digest('hex')
    .slice(0, 8);
  const planId = `${slug(hypothesis)}-${digest}`;

  const altText =
    direction === 'two-sided'
      ? 'treatment ≠ control'
      : direction === 'greater'
        ? 'treatment > control'
        : 'treatment < control';

  const lines: string[] = [
    `# Pre-registration: ${hypothesis}`,
    '',
    `- **Plan ID:** \`${planId}\``,
    `- **Created (UTC):** ${created}`,
    `- **Trial type:** ${trialType}${niMargin !== null ? ` (non-inferiority margin Δ_NI = ${(niMargin * 100).toFixed(2)}%)` : ''}`,
    `- **Randomization / analysis unit:** ${unit}`,
    `- **Minimum duration:** ${minDurationDays} days (full weekly cycles)`,
    '',
    '## Hypothesis',
    '',
    hypothesis,
    '',
    `- H0: ${trialType === 'non_inferiority' && niMargin !== null ? `relative difference in **${primary.name}** ≤ -${(niMargin * 100).toFixed(2)}%` : `no difference in **${primary.name}** between treatment and control`}.`,
    `- H1 (${direction}): ${altText}.`,
    `- Significance level α = ${alpha}; minimum detectable effect (relative) = ${(mdeRel >= 0 ? '+' : '') + (mdeRel * 100).toFixed(2)}%.`,
    '',
    '## Metrics',
    '',
    '| Role | Metric | Definition | Test |',
    '|---|---|---|---|',
    `| Primary (OEC) | \`${primary.name}\` | ${metricDef(primary)} | ${ttMethod(primary)} |`,
  ];

  for (const g of guards) {
    const better = g.higher_is_better ? 'higher is better' : 'lower is better';
    lines.push(`| Guardrail (${better}) | \`${g.name}\` | ${metricDef(g)} | ${ttMethod(g)} |`);
  }

  lines.push('', '## Sample size', '');
  if (sampleSize) {
    lines.push(
      `- Required: **${Number(sampleSize.n_per_arm).toLocaleString()} ${unit}s per arm** (${Number(sampleSize.total_n).toLocaleString()} total) at α = ${alpha}.`
    );
  } else {
    lines.push('- Not computed (no baseline given). Run `power()` before launch.');
  }

  lines.push(
    '',
    '## Analysis plan',
    '',
    '- Fixed-horizon test: analyze once at the planned sample size and minimum weekly duration; no peeking-based early stopping.',
    `- Sample ratio mismatch (SRM) check first; p < ${SRM_ALPHA_DEFAULT} invalidates the experiment.`,
    '- Primary metric decides; guardrails can block a launch but not justify one.',
    `- Guardrails multiple-testing correction: ${guards.length > 1 ? 'holm' : 'none'}.`
  );

  const md = `${lines.join('\n')}\n`;
  const plan = {
    plan_id: planId,
    created_at: created,
    hypothesis,
    trial_type: trialType,
    non_inferiority_margin: niMargin,
    min_duration_days: minDurationDays,
    primary_metric: primary,
    guardrails: guards,
    unit,
    alpha,
    mde_rel: mdeRel,
    direction,
    srm_alpha: SRM_ALPHA_DEFAULT,
    guardrail_multiple_testing: guards.length > 1 ? 'holm' : 'none',
    sample_size: sampleSize,
    preregistration_md: md,
  };
  planStore.set(planId, plan);

  return {
    plan_id: planId,
    preregistration_md: md,
  };
}

// --------------------------------------------------------------------------- srm_check

export interface SrmCheckInput {
  counts: Record<string, number>;
  expected_ratio?: Record<string, number> | null;
  alpha?: number;
}

export function srmCheck(input: SrmCheckInput): Record<string, unknown> {
  const alpha = checkAlpha(input.alpha ?? SRM_ALPHA_DEFAULT, 'alpha');
  if (!input.counts || typeof input.counts !== 'object') {
    throw new Error('counts must be a mapping {variant: count}');
  }
  const variants = Object.keys(input.counts);
  if (variants.length < 2) {
    throw new Error('counts must have at least 2 variants');
  }
  const observed: Record<string, number> = {};
  let total = 0;
  for (const v of variants) {
    const c = Number(input.counts[v]);
    if (!Number.isInteger(c) || c < 0) {
      throw new Error(`counts[${v}] must be a non-negative integer`);
    }
    observed[v] = c;
    total += c;
  }
  if (total <= 0) {
    throw new Error('total count across variants must be > 0');
  }

  const weights: Record<string, number> = {};
  let weightSum = 0;
  for (const v of variants) {
    const w = input.expected_ratio ? Number(input.expected_ratio[v]) : 1;
    if (!Number.isFinite(w) || w <= 0) {
      throw new Error(`expected_ratio[${v}] must be > 0`);
    }
    weights[v] = w;
    weightSum += w;
  }

  const expected: Record<string, number> = {};
  let chi2 = 0;
  for (const v of variants) {
    const exp = (total * weights[v]) / weightSum;
    expected[v] = exp;
    chi2 += (observed[v] - exp) ** 2 / exp;
  }

  const df = variants.length - 1;
  const pvalue = chiSquareSf(chi2, df);
  const isSrm = pvalue < alpha;

  return {
    observed,
    expected,
    chi2: cleanFloat(chi2),
    pvalue: cleanFloat(pvalue),
    is_srm: isSrm,
    alpha,
    method: `Chi-square goodness-of-fit test (df=${df})`,
  };
}

// --------------------------------------------------------------------------- compare_eval_runs

export interface CompareEvalRunsInput {
  scores_a: number[][];
  scores_b: number[][];
  paired?: boolean;
  alpha?: number;
  ci_method?: 'analytic' | 'cluster_bootstrap';
  n_resamples?: number;
  seed?: number;
}

function asMatrix(scores: unknown, name: string): number[][] {
  if (!Array.isArray(scores) || scores.length === 0) {
    throw new Error(`${name} must be a rectangular runs x cases list of numbers`);
  }
  const rows: number[][] = Array.isArray(scores[0]) ? (scores as number[][]) : [scores as number[]];
  const nCases = rows[0].length;
  if (nCases < 2) {
    throw new Error(`${name} must be a runs x cases matrix with >= 2 cases`);
  }
  return rows.map((row) => {
    if (!Array.isArray(row) || row.length !== nCases) {
      throw new Error(`${name} must be a rectangular runs x cases list of numbers`);
    }
    return row.map((v) => {
      const n = Number(v);
      if (!Number.isFinite(n)) {
        throw new Error(`${name} contains NaN/inf; drop or score those cases first`);
      }
      return n;
    });
  });
}

function runStd(mat: number[][]): number | null {
  if (mat.length < 2) return null;
  const runMeans = mat.map((row) => mean(row));
  return sampleStd(runMeans);
}

export function compareEvalRuns(input: CompareEvalRunsInput): Record<string, unknown> {
  const alpha = checkAlpha(input.alpha ?? 0.05, 'alpha');
  const ciMethod = input.ci_method ?? 'analytic';
  if (ciMethod !== 'analytic' && ciMethod !== 'cluster_bootstrap') {
    throw new Error("ci_method must be 'analytic' or 'cluster_bootstrap'");
  }
  const nResamples = Number(input.n_resamples ?? 5000);
  if (!Number.isInteger(nResamples) || nResamples < 200) {
    throw new Error('n_resamples must be an integer >= 200');
  }
  const seed = Number(input.seed ?? 0);
  const paired = input.paired !== false;

  const a = asMatrix(input.scores_a, 'scores_a');
  const b = asMatrix(input.scores_b, 'scores_b');
  if (paired && a[0].length !== b[0].length) {
    throw new Error(`paired=true requires the same cases in scores_a (${a[0].length}) and scores_b (${b[0].length})`);
  }

  const nCasesA = a[0].length;
  const nCasesB = b[0].length;
  const caseA = Array.from({ length: nCasesA }, (_, j) => mean(a.map((r) => r[j])));
  const caseB = Array.from({ length: nCasesB }, (_, j) => mean(b.map((r) => r[j])));

  const meanA = mean(caseA);
  const meanB = mean(caseB);
  const diff = meanB - meanA;

  let pvalueAnalytic: number;
  let ciAnalytic: [number | null, number | null];

  if (paired) {
    const diffs = caseB.map((vb, j) => vb - caseA[j]);
    const sd = sampleStd(diffs);
    const se = sd / Math.sqrt(nCasesA);
    const df = nCasesA - 1;
    if (se === 0) {
      pvalueAnalytic = diff === 0 ? 1 : 0;
      ciAnalytic = [diff, diff];
    } else {
      const tStat = diff / se;
      pvalueAnalytic = 2 * tSf(Math.abs(tStat), df);
      const half = tQuantile(1 - alpha / 2, df) * se;
      ciAnalytic = [diff - half, diff + half];
    }
  } else {
    const varA = sampleVariance(caseA) / nCasesA;
    const varB = sampleVariance(caseB) / nCasesB;
    const se = Math.sqrt(varA + varB);
    if (se === 0) {
      pvalueAnalytic = diff === 0 ? 1 : 0;
      ciAnalytic = [diff, diff];
    } else {
      const df = (varA + varB) ** 2 / (varA ** 2 / (nCasesA - 1) + varB ** 2 / (nCasesB - 1));
      const tStat = diff / se;
      pvalueAnalytic = 2 * tSf(Math.abs(tStat), df);
      const half = tQuantile(1 - alpha / 2, df) * se;
      ciAnalytic = [diff - half, diff + half];
    }
  }

  const warnings: string[] = [];
  if (a.length < 2 || b.length < 2) {
    warnings.push(
      'Only one run in at least one config: run-to-run std cannot be estimated and case means include full sampling noise.'
    );
  }
  if (Math.min(nCasesA, nCasesB) < 30) {
    warnings.push(`Small eval suite (${Math.min(nCasesA, nCasesB)} cases): t-interval may be noisy.`);
  }

  const analyticDesc = paired
    ? 'paired t-test on run-averaged per-case scores'
    : 'Welch t-test on run-averaged per-case scores';

  if (ciMethod === 'cluster_bootstrap') {
    const rng = new SeededRng(seed);
    const ra = a.length;
    const rb = b.length;
    const bootDiffs: number[] = [];
    for (let s = 0; s < nResamples; s++) {
      let sumA = 0;
      let sumB = 0;
      if (paired) {
        for (let j = 0; j < nCasesA; j++) {
          const cIdx = rng.nextInt(nCasesA);
          let cSumA = 0;
          for (let r = 0; r < ra; r++) cSumA += a[rng.nextInt(ra)][cIdx];
          let cSumB = 0;
          for (let r = 0; r < rb; r++) cSumB += b[rng.nextInt(rb)][cIdx];
          sumA += cSumA / ra;
          sumB += cSumB / rb;
        }
        bootDiffs.push(sumB / nCasesA - sumA / nCasesA);
      } else {
        for (let j = 0; j < nCasesA; j++) {
          const cIdx = rng.nextInt(nCasesA);
          let cSumA = 0;
          for (let r = 0; r < ra; r++) cSumA += a[rng.nextInt(ra)][cIdx];
          sumA += cSumA / ra;
        }
        for (let j = 0; j < nCasesB; j++) {
          const cIdx = rng.nextInt(nCasesB);
          let cSumB = 0;
          for (let r = 0; r < rb; r++) cSumB += b[rng.nextInt(rb)][cIdx];
          sumB += cSumB / rb;
        }
        bootDiffs.push(sumB / nCasesB - sumA / nCasesA);
      }
    }
    bootDiffs.sort((x, y) => x - y);
    const ci: [number, number] = [quantileSorted(bootDiffs, alpha / 2), quantileSorted(bootDiffs, 1 - alpha / 2)];
    const leZero = bootDiffs.filter((d) => d <= 0).length / nResamples;
    const geZero = bootDiffs.filter((d) => d >= 0).length / nResamples;
    const pBoot = Math.min(1.0, Math.max(2 * Math.min(leZero, geZero), 1 / (nResamples + 1)));

    return {
      mean_a: meanA,
      mean_b: meanB,
      diff,
      ci,
      ci_level: 1 - alpha,
      pvalue: pBoot,
      significant: pBoot < alpha,
      ci_analytic: ciAnalytic,
      pvalue_analytic: cleanFloat(pvalueAnalytic),
      run_to_run_std_a: runStd(a),
      run_to_run_std_b: runStd(b),
      n_cases: paired ? nCasesA : { a: nCasesA, b: nCasesB },
      n_runs: a.length === b.length ? a.length : { a: a.length, b: b.length },
      ci_method: ciMethod,
      n_resamples: nResamples,
      seed,
      method: `two-level cluster bootstrap (cases, then runs; ${nResamples} resamples, seed=${seed}; ${paired ? 'paired cases' : 'independent cases'}); analytic ${analyticDesc} reported in ci_analytic/pvalue_analytic`,
      warnings,
    };
  }

  return {
    mean_a: meanA,
    mean_b: meanB,
    diff,
    ci: ciAnalytic,
    ci_level: 1 - alpha,
    pvalue: cleanFloat(pvalueAnalytic),
    significant: Number.isFinite(pvalueAnalytic) ? pvalueAnalytic < alpha : null,
    run_to_run_std_a: runStd(a),
    run_to_run_std_b: runStd(b),
    n_cases: paired ? nCasesA : { a: nCasesA, b: nCasesB },
    n_runs: a.length === b.length ? a.length : { a: a.length, b: b.length },
    ci_method: ciMethod,
    method: analyticDesc,
    warnings,
  };
}

// --------------------------------------------------------------------------- sequential_check

export interface SequentialLook {
  n_control: number;
  n_treatment: number;
  mean_control: number;
  mean_treatment: number;
  std_control?: number;
  std_treatment?: number;
}

export interface SequentialCheckInput {
  looks: SequentialLook[];
  metric_type?: 'mean' | 'proportion';
  alpha?: number;
  tau2?: number | null;
  mde_abs?: number | null;
  mde_rel?: number | null;
  max_n_per_arm?: number | null;
}

export function sequentialCheck(input: SequentialCheckInput): Record<string, unknown> {
  const alpha = checkAlpha(input.alpha ?? 0.05, 'alpha');
  const metricType = input.metric_type ?? 'mean';
  if (metricType !== 'mean' && metricType !== 'proportion') {
    throw new Error("metric_type must be 'mean' or 'proportion'");
  }
  if (!Array.isArray(input.looks) || input.looks.length === 0) {
    throw new Error('at least one look is required');
  }

  const parsedLooks = input.looks.map((look, k) => {
    const nC = Number(look.n_control);
    const nT = Number(look.n_treatment);
    const mC = Number(look.mean_control);
    const mT = Number(look.mean_treatment);
    if (!Number.isFinite(nC) || !Number.isFinite(nT) || nC < 2 || nT < 2) {
      throw new Error(`look ${k}: n_control and n_treatment must be >= 2`);
    }
    let varC: number;
    let varT: number;
    if (metricType === 'proportion') {
      if (mC <= 0 || mC >= 1 || mT <= 0 || mT >= 1) {
        throw new Error(`look ${k}: proportion means must be in (0, 1)`);
      }
      varC = mC * (1 - mC);
      varT = mT * (1 - mT);
    } else {
      const sC = Number(look.std_control);
      const sT = Number(look.std_treatment);
      if (!Number.isFinite(sC) || !Number.isFinite(sT) || sC <= 0 || sT <= 0) {
        throw new Error(`look ${k}: mean metrics need positive std_control and std_treatment`);
      }
      varC = sC * sC;
      varT = sT * sT;
    }
    return { nC, nT, mC, mT, varC, varT };
  });

  for (let k = 1; k < parsedLooks.length; k++) {
    if (parsedLooks[k].nC < parsedLooks[k - 1].nC || parsedLooks[k].nT < parsedLooks[k - 1].nT) {
      throw new Error(`look ${k}: sample sizes must be cumulative (non-decreasing)`);
    }
  }

  let tau2Source = 'given';
  let tau2 = input.tau2 !== undefined && input.tau2 !== null ? Number(input.tau2) : null;
  if (tau2 === null) {
    if (input.mde_abs !== undefined && input.mde_abs !== null) {
      tau2 = Number(input.mde_abs) ** 2;
      tau2Source = 'mde_abs^2';
    } else if (input.mde_rel !== undefined && input.mde_rel !== null) {
      tau2 = (Number(input.mde_rel) * parsedLooks[0].mC) ** 2;
      tau2Source = '(mde_rel * mean_control at first look)^2';
    } else {
      throw new Error('pass tau2, mde_abs or mde_rel to set the mixing variance');
    }
  }
  if (tau2 === null || !Number.isFinite(tau2) || tau2 <= 0) {
    throw new Error('tau2 must be a positive finite number');
  }
  const tau2Val: number = tau2;

  const logInvAlpha = Math.log(1 / alpha);
  let pRunning = 1.0;
  let loRunning = -Infinity;
  let hiRunning = Infinity;
  let stoppedAt: number | null = null as number | null;

  const outLooks = parsedLooks.map((st, k) => {
    const theta = st.mT - st.mC;
    const v = st.varC / st.nC + st.varT / st.nT;
    const logLr = 0.5 * Math.log(v / (v + tau2Val)) + (tau2Val * theta * theta) / (2 * v * (v + tau2Val));
    const pK = logLr < 700 ? Math.min(1.0, Math.exp(-logLr)) : 0.0;
    pRunning = Math.min(pRunning, pK);
    const half = Math.sqrt(((2 * v * (v + tau2Val)) / tau2Val) * (logInvAlpha + 0.5 * Math.log((v + tau2Val) / v)));
    loRunning = Math.max(loRunning, theta - half);
    hiRunning = Math.min(hiRunning, theta + half);
    if (stoppedAt === null && pRunning <= alpha) {
      stoppedAt = k;
    }
    return {
      look: k,
      n_control: Math.round(st.nC),
      n_treatment: Math.round(st.nT),
      effect: theta,
      always_valid_pvalue: pRunning,
      always_valid_ci: [cleanFloat(loRunning), cleanFloat(hiRunning)],
      log_likelihood_ratio: logLr,
    };
  });

  const last = outLooks[outLooks.length - 1];
  let decision: 'continue' | 'stop_reject' | 'stop_max_n' = 'continue';
  const stoppedIndex = stoppedAt;
  if (stoppedIndex !== null) {
    decision = 'stop_reject';
  } else if (
    input.max_n_per_arm !== undefined &&
    input.max_n_per_arm !== null &&
    Math.min(last.n_control, last.n_treatment) >= Number(input.max_n_per_arm)
  ) {
    decision = 'stop_max_n';
  }

  const warnings: string[] = [];
  if (stoppedIndex !== null && stoppedIndex < outLooks.length - 1) {
    warnings.push(
      `The rejection boundary was crossed at look ${String(stoppedIndex)}; later looks are shown but the decision was already final then.`
    );
  }
  if (Math.min(last.n_control, last.n_treatment) < 100) {
    warnings.push('Small samples: the plug-in normal approximation may be unreliable.');
  }

  return {
    looks: outLooks,
    always_valid_ci: last.always_valid_ci,
    always_valid_pvalue: last.always_valid_pvalue,
    effect: last.effect,
    decision,
    stopped_at_look: stoppedAt,
    alpha,
    method:
      'mSPRT (normal mixture, two-sided) on the difference in means; always-valid p-value and running-intersection CI (Johari et al. 2017)',
    assumptions: {
      tau2,
      tau2_source: tau2Source,
      metric_type: metricType,
      variance: `plug-in per look (${metricType === 'proportion' ? 'p(1-p)' : 'sample std'})`,
      max_n_per_arm: input.max_n_per_arm ?? null,
      notes:
        'Valid under any look schedule. Not a substitute for the fixed-horizon analyze(); use only when continuous monitoring was pre-registered.',
    },
    warnings,
  };
}

// --------------------------------------------------------------------------- agreement_kappa

export interface AgreementKappaInput {
  rater_a: string[];
  rater_b: string[];
  labels?: string[] | null;
  alpha?: number;
  n_resamples?: number;
  seed?: number;
}

function computeKappa(m: number[][], n: number): { kappa: number; po: number; pe: number } {
  let diag = 0;
  const k = m.length;
  const rowSums = new Array<number>(k).fill(0);
  const colSums = new Array<number>(k).fill(0);
  for (let i = 0; i < k; i++) {
    diag += m[i][i];
    for (let j = 0; j < k; j++) {
      rowSums[i] += m[i][j];
      colSums[j] += m[i][j];
    }
  }
  const po = diag / n;
  let pe = 0;
  for (let i = 0; i < k; i++) {
    pe += (rowSums[i] * colSums[i]) / (n * n);
  }
  const kappa = pe >= 1 ? Number.NaN : (po - pe) / (1 - pe);
  return { kappa, po, pe };
}

export function agreementKappa(input: AgreementKappaInput): Record<string, unknown> {
  const alpha = checkAlpha(input.alpha ?? 0.05, 'alpha');
  if (!Array.isArray(input.rater_a) || !Array.isArray(input.rater_b)) {
    throw new Error('rater_a and rater_b must be arrays of labels');
  }
  const a = input.rater_a.map(String);
  const b = input.rater_b.map(String);
  if (a.length !== b.length) {
    throw new Error(`rater_a and rater_b differ in length: ${a.length} vs ${b.length}`);
  }
  if (a.length === 0) {
    throw new Error('no items to compare');
  }
  const nResamples = Number(input.n_resamples ?? 2000);
  const seed = Number(input.seed ?? 3);

  const union = [...new Set([...a, ...b])].sort();
  const cats = input.labels && input.labels.length > 0 ? input.labels.map(String) : union;
  const idx = new Map<string, number>();
  cats.forEach((c, i) => idx.set(c, i));
  for (const label of union) {
    if (!idx.has(label)) {
      throw new Error(`label "${label}" is not in the labels list`);
    }
  }

  const k = cats.length;
  const n = a.length;
  const ia = a.map((x) => idx.get(x)!);
  const ib = b.map((x) => idx.get(x)!);
  const m = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  for (let i = 0; i < n; i++) {
    m[ia[i]][ib[i]] += 1;
  }

  const { kappa, po, pe } = computeKappa(m, n);
  const se = Number.isNaN(kappa) ? null : Math.sqrt((po * (1 - po)) / (n * (1 - pe) ** 2));
  const z = normalQuantile(1 - alpha / 2);

  const rng = new SeededRng(seed);
  const draws: number[] = [];
  for (let s = 0; s < nResamples; s++) {
    const mb = Array.from({ length: k }, () => new Array<number>(k).fill(0));
    for (let i = 0; i < n; i++) {
      const pick = rng.nextInt(n);
      mb[ia[pick]][ib[pick]] += 1;
    }
    const kb = computeKappa(mb, n).kappa;
    if (!Number.isNaN(kb)) draws.push(kb);
  }
  draws.sort((x, y) => x - y);
  const ci: [number | null, number | null] =
    draws.length > 0 ? [quantileSorted(draws, alpha / 2), quantileSorted(draws, 1 - alpha / 2)] : [null, null];

  const warnings: string[] = [];
  const singleA = new Set(a).size === 1;
  const singleB = new Set(b).size === 1;
  const degenerate = singleA || singleB;
  if (degenerate) {
    const who = singleA ? 'rater_a' : 'rater_b';
    const only = singleA ? a[0] : b[0];
    warnings.push(
      `Degenerate kappa: every ${who} label is "${only}", so expected agreement equals observed agreement and kappa is 0 (or undefined) by construction.`
    );
  }
  if (n < 30) {
    warnings.push(`Only ${n} items; kappa and its CI are very imprecise.`);
  }

  return {
    kappa: cleanFloat(kappa),
    ci,
    ci_level: 1 - alpha,
    agreement: po,
    expected_agreement: pe,
    confusion_matrix: m,
    labels: cats,
    n,
    kappa_se: se,
    ci_analytic: se !== null && !Number.isNaN(kappa) ? [kappa - z * se, kappa + z * se] : null,
    degenerate,
    method: `Cohen's kappa; CI: percentile bootstrap over items (${nResamples} resamples, seed=${seed}, ${draws.length} defined draws); kappa_se: Cohen (1960) large-sample SE`,
    warnings,
  };
}

// --------------------------------------------------------------------------- analyze

export interface AnalyzeInput {
  /** Either a path to a .csv/.json file, inline CSV text, or an array of row objects. */
  data_ref: string | Array<Record<string, unknown>>;
  variant_col: string;
  metrics: Array<MetricSpec | Record<string, unknown>>;
  control: string | number;
  covariates?: Record<string, unknown> | null;
  multiple_testing?: MultipleTesting | null;
  robust?: RobustSpec | null;
  alpha?: number;
  srm_alpha?: number;
  randomization_unit?: string | null;
  segment_col?: string | null;
  n_resamples?: number;
  seed?: number;
  non_inferiority_margin?: number | null;
}

function parseCsvText(text: string): Array<Record<string, unknown>> {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) throw new Error('CSV data requires a header row and at least one data row');
  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map((line) => {
    const vals = line.split(',').map((v) => v.trim().replace(/^"|"$/g, ''));
    const row: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      const raw = vals[i] ?? '';
      const num = Number(raw);
      row[h] = raw !== '' && Number.isFinite(num) ? num : raw;
    });
    return row;
  });
}

function loadRows(dataRef: string | Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  if (Array.isArray(dataRef)) return dataRef;
  if (typeof dataRef !== 'string' || !dataRef.trim()) {
    throw new Error('data_ref must be a file path, inline CSV/JSON string, or array of row objects');
  }
  const trimmed = dataRef.trim();
  if (trimmed.startsWith('[')) {
    return JSON.parse(trimmed) as Array<Record<string, unknown>>;
  }
  if (trimmed.includes('\n') && trimmed.includes(',')) {
    return parseCsvText(trimmed);
  }
  const resolved = path.resolve(trimmed);
  if (!fs.existsSync(resolved)) {
    throw new Error(`data file not found: ${trimmed}`);
  }
  const content = fs.readFileSync(resolved, 'utf8');
  if (resolved.endsWith('.json')) {
    return JSON.parse(content) as Array<Record<string, unknown>>;
  }
  return parseCsvText(content);
}

function welchCompare(
  cVals: number[],
  tVals: number[],
  alt: Direction,
  alpha: number,
  methodLabel: string
): {
  control: number;
  treatment: number;
  abs_effect: number;
  abs_ci: [number | null, number | null];
  rel_effect: number | null;
  rel_ci: [number | null, number | null];
  pvalue: number | null;
  method: string;
} {
  const mC = mean(cVals);
  const mT = mean(tVals);
  const absEffect = mT - mC;
  const vC = sampleVariance(cVals) / cVals.length;
  const vT = sampleVariance(tVals) / tVals.length;
  const se = Math.sqrt(vC + vT);
  const df = se > 0 ? (vC + vT) ** 2 / (vC ** 2 / (cVals.length - 1) + vT ** 2 / (tVals.length - 1)) : 1;

  let pvalue = 1.0;
  let absCi: [number | null, number | null] = [absEffect, absEffect];
  if (se > 0) {
    const tStat = absEffect / se;
    if (alt === 'greater') {
      pvalue = tSf(tStat, df);
      absCi = [absEffect - tQuantile(1 - alpha, df) * se, null];
    } else if (alt === 'less') {
      pvalue = tCdf(tStat, df);
      absCi = [null, absEffect + tQuantile(1 - alpha, df) * se];
    } else {
      pvalue = 2 * tSf(Math.abs(tStat), df);
      const half = tQuantile(1 - alpha / 2, df) * se;
      absCi = [absEffect - half, absEffect + half];
    }
  }

  let relEffect: number | null = null;
  let relCi: [number | null, number | null] = [null, null];
  if (mC !== 0) {
    relEffect = (mT - mC) / Math.abs(mC);
    if (mC > 0 && mT > 0 && se > 0) {
      const logSe = Math.sqrt(vC / (mC * mC) + vT / (mT * mT));
      const q = alt === 'two-sided' ? tQuantile(1 - alpha / 2, df) : tQuantile(1 - alpha, df);
      const factor = Math.exp(q * logSe);
      const ratio = mT / mC;
      if (alt === 'greater') {
        relCi = [ratio / factor - 1, null];
      } else if (alt === 'less') {
        relCi = [null, ratio * factor - 1];
      } else {
        relCi = [ratio / factor - 1, ratio * factor - 1];
      }
    }
  }

  return {
    control: mC,
    treatment: mT,
    abs_effect: absEffect,
    abs_ci: [cleanFloat(absCi[0]), cleanFloat(absCi[1])],
    rel_effect: cleanFloat(relEffect),
    rel_ci: [cleanFloat(relCi[0]), cleanFloat(relCi[1])],
    pvalue: cleanFloat(pvalue),
    method: methodLabel,
  };
}

function applyCuped(cY: number[], cX: number[], tY: number[], tX: number[]): { cAdj: number[]; tAdj: number[] } {
  const allY = [...cY, ...tY];
  const allX = [...cX, ...tX];
  const varX = sampleVariance(allX);
  if (varX <= 0) return { cAdj: cY, tAdj: tY };
  const theta = sampleCovariance(allY, allX) / varX;
  const meanX = mean(allX);
  return {
    cAdj: cY.map((y, i) => y - theta * (cX[i] - meanX)),
    tAdj: tY.map((y, i) => y - theta * (tX[i] - meanX)),
  };
}

function yuenCompare(cVals: number[], tVals: number[], trim: number, alt: Direction, alpha: number) {
  const winsorize = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    const g = Math.floor(trim * s.length);
    const lo = s[g];
    const hi = s[s.length - 1 - g];
    return s.map((v) => Math.max(lo, Math.min(hi, v)));
  };
  const stats = (xs: number[]) => {
    const n = xs.length;
    const g = Math.floor(trim * n);
    const h = n - 2 * g;
    const tm = trimMean(xs, trim);
    const wvar = sampleVariance(winsorize(xs));
    const d = ((n - 1) * wvar) / (h * (h - 1));
    return { tm, d, h };
  };
  const sc = stats(cVals);
  const st = stats(tVals);
  const absEffect = st.tm - sc.tm;
  const se = Math.sqrt(sc.d + st.d);
  const df = (sc.d + st.d) ** 2 / (sc.d ** 2 / (sc.h - 1) + st.d ** 2 / (st.h - 1));
  const tStat = se > 0 ? absEffect / se : 0;
  const pvalue =
    se > 0 ? (alt === 'greater' ? tSf(tStat, df) : alt === 'less' ? tCdf(tStat, df) : 2 * tSf(Math.abs(tStat), df)) : 1;
  const half = tQuantile(1 - alpha / 2, df) * se;
  const relEffect = sc.tm !== 0 ? absEffect / Math.abs(sc.tm) : null;
  const relHalf = sc.tm !== 0 ? half / Math.abs(sc.tm) : null;
  return {
    control: sc.tm,
    treatment: st.tm,
    abs_effect: absEffect,
    abs_ci: [cleanFloat(absEffect - half), cleanFloat(absEffect + half)] as [number | null, number | null],
    rel_effect: cleanFloat(relEffect),
    rel_ci:
      relEffect !== null && relHalf !== null
        ? ([cleanFloat(relEffect - relHalf), cleanFloat(relEffect + relHalf)] as [number | null, number | null])
        : ([null, null] as [number | null, number | null]),
    pvalue: cleanFloat(pvalue),
    method: `Yuen trimmed-mean t-test (trim=${trim})`,
  };
}

export function analyze(input: AnalyzeInput): Record<string, unknown> {
  const alpha = checkAlpha(input.alpha ?? 0.05, 'alpha');
  const srmAlpha = checkAlpha(input.srm_alpha ?? SRM_ALPHA_DEFAULT, 'srm_alpha');
  const segmentCol = input.segment_col?.trim() || null;
  const randUnit = input.randomization_unit?.trim() || null;
  const multipleTesting: MultipleTesting = input.multiple_testing ?? (segmentCol ? 'holm' : 'none');
  const nResamples = Number(input.n_resamples ?? 2000);
  const seed = Number(input.seed ?? 0);
  const niMargin =
    input.non_inferiority_margin !== undefined && input.non_inferiority_margin !== null
      ? Number(input.non_inferiority_margin)
      : null;

  const specs = (input.metrics ?? []).map(validateMetric);
  if (specs.length === 0) throw new Error('at least one metric is required');

  const rawRows = loadRows(input.data_ref);
  const variantCol = input.variant_col.trim();
  const controlStr = String(input.control);
  const covariates = input.covariates ?? {};
  const warnings: string[] = [];

  let rows = rawRows;
  if (randUnit) {
    const byUnit = new Map<string, Record<string, unknown>>();
    const unitVariants = new Map<string, string>();
    for (const r of rawRows) {
      const u = asStr(r[randUnit]);
      const v = asStr(r[variantCol]);
      if (unitVariants.has(u) && unitVariants.get(u) !== v) {
        throw new Error(`ValueError: randomization_unit ${u} appears in multiple variants`);
      }
      unitVariants.set(u, v);
      const existing = byUnit.get(u);
      if (!existing) {
        byUnit.set(u, { ...r, __rows__: 1 });
      } else {
        existing.__rows__ = Number(existing.__rows__ ?? 1) + 1;
        for (const k of Object.keys(r)) {
          if (k === randUnit || k === variantCol || k === segmentCol) continue;
          if (typeof r[k] === 'number') {
            existing[k] = Number(existing[k] ?? 0) + Number(r[k]);
          }
        }
      }
    }
    rows = [...byUnit.values()];
    warnings.push(`Cluster-randomized analysis: rows aggregated per ${randUnit}; SRM is checked on unit counts.`);
  }

  const segments: Array<string | null> = segmentCol
    ? [
        ...new Set(
          rows.map((r) => (r[segmentCol] === null || r[segmentCol] === undefined ? null : asStr(r[segmentCol])))
        ),
      ].sort()
    : [null];

  if (segmentCol) {
    warnings.push(
      `Segment results are exploratory (${segments.length} segments); correction: ${multipleTesting}. Confirm any segment finding in a new pre-registered experiment.`
    );
  }

  const results: Array<Record<string, unknown>> = [];
  const srmList: Array<Record<string, unknown>> = [];

  for (const seg of segments) {
    const segRows = segmentCol
      ? rows.filter((r) =>
          seg === null ? r[segmentCol] === null || r[segmentCol] === undefined : asStr(r[segmentCol]) === seg
        )
      : rows;

    const byVariant = new Map<string, Array<Record<string, unknown>>>();
    for (const r of segRows) {
      const v = asStr(r[variantCol]);
      const list = byVariant.get(v) ?? [];
      list.push(r);
      byVariant.set(v, list);
    }

    const controlRows = byVariant.get(controlStr);
    if (!controlRows || controlRows.length === 0) {
      throw new Error(`control variant "${controlStr}" not found`);
    }
    const treatmentVariants = [...byVariant.keys()].filter((v) => v !== controlStr).sort();
    if (treatmentVariants.length === 0) {
      throw new Error(`no treatment variants found besides control "${controlStr}"`);
    }

    for (const treatStr of treatmentVariants) {
      const treatRows = byVariant.get(treatStr)!;
      const srmRes = srmCheck({
        counts: { [controlStr]: controlRows.length, [treatStr]: treatRows.length },
        alpha: srmAlpha,
      });
      srmList.push({
        control_variant: input.control,
        treatment_variant: treatStr,
        observed: srmRes.observed,
        pvalue: srmRes.pvalue,
        is_srm: srmRes.is_srm,
        alpha: srmAlpha,
        method: srmRes.method,
        ...(segmentCol ? { segment: seg } : {}),
      });

      for (const m of specs) {
        if (m.type === 'ratio') {
          const cN = controlRows.map((r) => Number(r[m.numer!]));
          const cD = controlRows.map((r) => Number(r[m.denom!]));
          const tN = treatRows.map((r) => Number(r[m.numer!]));
          const tD = treatRows.map((r) => Number(r[m.denom!]));
          const rC = mean(cN) / mean(cD);
          const rT = mean(tN) / mean(tD);
          const varRatio = (num: number[], den: number[], r: number) => {
            const md = mean(den);
            const lin = num.map((n, i) => (n - r * den[i]) / md);
            return sampleVariance(lin) / lin.length;
          };
          const vC = varRatio(cN, cD, rC);
          const vT = varRatio(tN, tD, rT);
          const se = Math.sqrt(vC + vT);
          const df = (vC + vT) ** 2 / (vC ** 2 / (cN.length - 1) + vT ** 2 / (tN.length - 1));
          const absEffect = rT - rC;
          const pval = se > 0 ? 2 * tSf(Math.abs(absEffect / se), df) : 1;
          const half = tQuantile(1 - alpha / 2, df) * se;
          const relEffect = rC !== 0 ? absEffect / Math.abs(rC) : null;
          const relHalf = rC !== 0 ? half / Math.abs(rC) : null;

          results.push({
            metric: m.name,
            metric_type: m.type,
            control_variant: input.control,
            treatment_variant: treatStr,
            n_control: cN.length,
            n_treatment: tN.length,
            control: rC,
            treatment: rT,
            abs_effect: absEffect,
            abs_ci: [cleanFloat(absEffect - half), cleanFloat(absEffect + half)],
            rel_effect: cleanFloat(relEffect),
            rel_ci:
              relEffect !== null && relHalf !== null
                ? [cleanFloat(relEffect - relHalf), cleanFloat(relEffect + relHalf)]
                : [null, null],
            ci_level: 1 - alpha,
            pvalue: cleanFloat(pval),
            pvalue_adj: null,
            significant: pval < alpha,
            non_inferior:
              niMargin !== null && relEffect !== null && relHalf !== null ? relEffect - relHalf > -niMargin : null,
            method: 'Delta method RatioOfMeans (Welch t-test)',
            ...(segmentCol ? { segment: seg } : {}),
            ...(randUnit ? { randomization_unit: randUnit } : {}),
          });
          continue;
        }

        const col = m.column!;
        let cVals = controlRows.map((r) => Number(r[col]));
        let tVals = treatRows.map((r) => Number(r[col]));

        if (m.type === 'quantile' || m.type === 'bootstrap') {
          const rng = new SeededRng(seed);
          const statFn = (xs: number[]) => {
            if (m.type === 'quantile')
              return quantileSorted(
                [...xs].sort((a, b) => a - b),
                m.q ?? 0.5
              );
            if (m.statistic === 'median')
              return quantileSorted(
                [...xs].sort((a, b) => a - b),
                0.5
              );
            if (m.statistic === 'std') return sampleStd(xs);
            if (m.statistic === 'trimmed_mean_10') return trimMean(xs, 0.1);
            return mean(xs);
          };
          const cStat = statFn(cVals);
          const tStat = statFn(tVals);
          const absEffect = tStat - cStat;
          const draws: number[] = [];
          for (let s = 0; s < nResamples; s++) {
            const cb = Array.from({ length: cVals.length }, () => cVals[rng.nextInt(cVals.length)]);
            const tb = Array.from({ length: tVals.length }, () => tVals[rng.nextInt(tVals.length)]);
            draws.push(statFn(tb) - statFn(cb));
          }
          draws.sort((a, b) => a - b);
          const lo = quantileSorted(draws, alpha / 2);
          const hi = quantileSorted(draws, 1 - alpha / 2);
          const relEffect = cStat !== 0 ? absEffect / Math.abs(cStat) : null;
          const relCi: [number | null, number | null] =
            cStat !== 0 ? [cleanFloat(lo / Math.abs(cStat)), cleanFloat(hi / Math.abs(cStat))] : [null, null];

          results.push({
            metric: m.name,
            metric_type: m.type,
            control_variant: input.control,
            treatment_variant: treatStr,
            n_control: cVals.length,
            n_treatment: tVals.length,
            control: cStat,
            treatment: tStat,
            abs_effect: absEffect,
            abs_ci: [cleanFloat(lo), cleanFloat(hi)],
            rel_effect: cleanFloat(relEffect),
            rel_ci: relCi,
            ci_level: 1 - alpha,
            pvalue: null,
            pvalue_adj: null,
            significant: lo > 0 || hi < 0,
            non_inferior: niMargin !== null && relCi[0] !== null ? relCi[0] > -niMargin : null,
            method: `bootstrap: ${m.type === 'quantile' ? `${m.q}-quantile` : m.statistic} (${nResamples} resamples, seed=${seed})`,
            ...(segmentCol ? { segment: seg } : {}),
          });
          continue;
        }

        const covCol = typeof covariates[m.name] === 'string' ? (covariates[m.name] as string) : null;
        if (covCol) {
          const cX = controlRows.map((r) => Number(r[covCol]));
          const tX = treatRows.map((r) => Number(r[covCol]));
          const adj = applyCuped(cVals, cX, tVals, tX);
          cVals = adj.cAdj;
          tVals = adj.tAdj;
        }

        const methodLabel =
          m.type === 'proportion'
            ? `Two-sample proportion test${covCol ? ' (CUPED)' : ''}`
            : `Welch t-test${covCol ? ' (CUPED)' : ''}`;
        const cmp = welchCompare(cVals, tVals, m.alternative, alpha, methodLabel);
        results.push({
          metric: m.name,
          metric_type: m.type,
          control_variant: input.control,
          treatment_variant: treatStr,
          n_control: cVals.length,
          n_treatment: tVals.length,
          ...cmp,
          ci_level: 1 - alpha,
          pvalue_adj: null,
          significant: cmp.pvalue !== null ? cmp.pvalue < alpha : null,
          non_inferior: niMargin !== null && cmp.rel_ci[0] !== null ? cmp.rel_ci[0] > -niMargin : null,
          ...(segmentCol ? { segment: seg } : {}),
          ...(randUnit ? { randomization_unit: randUnit } : {}),
        });

        if (input.robust && m.type === 'mean') {
          const trim = Number(input.robust.winsorize_pct ?? 0.05);
          const rawC = controlRows.map((r) => Number(r[col]));
          const rawT = treatRows.map((r) => Number(r[col]));
          const yuen = yuenCompare(rawC, rawT, trim, m.alternative, alpha);
          results.push({
            metric: `${m.name}__yuen`,
            metric_type: 'mean',
            control_variant: input.control,
            treatment_variant: treatStr,
            n_control: rawC.length,
            n_treatment: rawT.length,
            ...yuen,
            ci_level: 1 - alpha,
            pvalue_adj: null,
            significant: yuen.pvalue !== null ? yuen.pvalue < alpha : null,
            non_inferior: niMargin !== null && yuen.rel_ci[0] !== null ? yuen.rel_ci[0] > -niMargin : null,
            ...(segmentCol ? { segment: seg } : {}),
          });
        }
      }
    }
  }

  // Apply multiple-testing correction (Holm or BH) across non-robust p-value rows.
  if (multipleTesting !== 'none') {
    const pRows = results.filter((r) => typeof r.pvalue === 'number' && !String(r.metric).endsWith('__yuen'));
    const mCount = pRows.length;
    const indexed = pRows.map((r, i) => ({ r, i, p: Number(r.pvalue) })).sort((a, b) => a.p - b.p);

    if (multipleTesting === 'holm') {
      let runningMax = 0;
      for (let k = 0; k < mCount; k++) {
        const adj = Math.min(1, indexed[k].p * (mCount - k));
        runningMax = Math.max(runningMax, adj);
        indexed[k].r.pvalue_adj = runningMax;
        indexed[k].r.significant = runningMax < alpha;
      }
    } else if (multipleTesting === 'bh') {
      let runningMin = 1;
      for (let k = mCount - 1; k >= 0; k--) {
        const adj = Math.min(1, (indexed[k].p * mCount) / (k + 1));
        runningMin = Math.min(runningMin, adj);
        indexed[k].r.pvalue_adj = runningMin;
        indexed[k].r.significant = runningMin < alpha;
      }
    }
  }

  if (srmList.some((s) => s.is_srm)) {
    warnings.push(
      'SAMPLE RATIO MISMATCH (SRM) DETECTED: Observed variant traffic split differs significantly from expected. Do NOT interpret metric lifts until SRM root cause is resolved.'
    );
  }

  return {
    results,
    srm: srmList,
    randomization_unit: randUnit,
    segment_col: segmentCol,
    segments: segmentCol ? segments : null,
    multiple_testing: multipleTesting,
    warnings,
  };
}

// --------------------------------------------------------------------------- report

export interface ReportInput {
  plan_id?: string | null;
  results?: Record<string, unknown> | Array<Record<string, unknown>> | null;
  srm?: Record<string, unknown> | Array<Record<string, unknown>> | null;
  sequential?: Record<string, unknown> | null;
  audience?: Audience;
}

function fmtPct(x: unknown): string {
  if (x === null || x === undefined || !Number.isFinite(Number(x))) return 'n/a';
  const v = Number(x) * 100;
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

function fmtNum(x: unknown): string {
  if (x === null || x === undefined || !Number.isFinite(Number(x))) return 'n/a';
  return Number(x).toPrecision(4);
}

export function report(input: ReportInput): Record<string, unknown> {
  const audience: Audience = input.audience ?? 'stakeholder';
  const plan = input.plan_id ? getSavedPlan(input.plan_id) : undefined;
  const rows: Array<Record<string, unknown>> = Array.isArray(input.results)
    ? input.results
    : Array.isArray((input.results as { results?: unknown })?.results)
      ? (input.results as { results: Array<Record<string, unknown>> }).results
      : [];
  const srmList: Array<Record<string, unknown>> = Array.isArray(input.srm)
    ? input.srm
    : Array.isArray((input.results as { srm?: unknown })?.srm)
      ? (input.results as { srm: Array<Record<string, unknown>> }).srm
      : input.srm && typeof input.srm === 'object'
        ? [input.srm]
        : [];

  const srmFailed = srmList.some((s) => Boolean(s.is_srm));
  const md: string[] = [];

  md.push(audience === 'stakeholder' ? '# Experiment Executive Summary' : '# Technical Experiment Report');
  if (input.plan_id) {
    md.push('', `- **Plan ID:** \`${input.plan_id}\``);
  }

  if (srmFailed) {
    md.push(
      '',
      '> **BLOCKED BY SAMPLE RATIO MISMATCH (SRM):** Traffic split failed data integrity check. Metric lifts are suppressed and must not be used for shipping decisions.',
      ''
    );
    for (const s of srmList) {
      md.push(`- SRM p-value: \`${asStr(s.pvalue, 'n/a')}\` (observed: \`${JSON.stringify(s.observed)}\`)`);
    }
    return { markdown: `${md.join('\n')}\n` };
  }

  if (rows.length > 0) {
    const primaryName = (plan?.primary_metric as { name?: string } | undefined)?.name ?? asStr(rows[0].metric);
    const primaryRow = rows.find((r) => r.metric === primaryName) ?? rows[0];
    const sig = Boolean(primaryRow.significant);
    const rel = Number(primaryRow.rel_effect ?? primaryRow.abs_effect ?? 0);
    const headline = sig
      ? rel > 0
        ? '**Ship-worthy:** the primary metric improved with statistical significance.'
        : '**Do not ship:** the primary metric declined significantly.'
      : '**Inconclusive:** no statistically significant change in the primary metric.';

    md.push('', headline, '');
    for (const r of rows) {
      const ci = (r.rel_ci as [unknown, unknown] | undefined) ??
        (r.abs_ci as [unknown, unknown] | undefined) ?? [null, null];
      md.push(
        `- **${asStr(r.metric)}** (${asStr(r.control_variant, 'control')} → ${asStr(r.treatment_variant, 'treatment')}): ${fmtNum(r.control)} → ${fmtNum(r.treatment)}, effect ${fmtPct(r.rel_effect)} (CI [${fmtPct(ci[0])}, ${fmtPct(ci[1])}], p = ${asStr(r.pvalue_adj ?? r.pvalue, 'n/a')}, method: ${asStr(r.method, 'n/a')}).`
      );
    }
  } else if (input.sequential) {
    const seq = input.sequential;
    const ci = (seq.always_valid_ci as [unknown, unknown] | undefined) ?? [null, null];
    md.push(
      '',
      `**Sequential monitoring decision:** \`${asStr(seq.decision)}\` (always-valid p = ${fmtNum(seq.always_valid_pvalue)}, CI [${fmtNum(ci[0])}, ${fmtNum(ci[1])}]).`
    );
  } else {
    md.push('', 'No metric results were provided.');
  }

  const warnings: string[] = [
    ...((input.results as { warnings?: string[] } | undefined)?.warnings ?? []),
    ...((input.sequential as { warnings?: string[] } | undefined)?.warnings ?? []),
  ];
  if (warnings.length > 0) {
    md.push('', audience === 'technical' ? '## Warnings' : '**Caveats**', '');
    for (const w of warnings) md.push(`- ${w}`);
  }

  return { markdown: `${md.join('\n')}\n` };
}
