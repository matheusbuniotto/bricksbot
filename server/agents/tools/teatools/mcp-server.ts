import type { McpToolCallResult, McpToolDefinition } from '../../../../shared/agents/mcp-types.js';
import {
  agreementKappa,
  type AgreementKappaInput,
  analyze,
  type AnalyzeInput,
  compareEvalRuns,
  type CompareEvalRunsInput,
  design,
  type DesignInput,
  power,
  type PowerInput,
  report,
  type ReportInput,
  sequentialCheck,
  type SequentialCheckInput,
  srmCheck,
  type SrmCheckInput,
} from './engine.js';

export const TEATOOLS_MCP_SERVICE = 'plugin.teatools';

export const TEATOOLS_MCP_DEFINITIONS: McpToolDefinition[] = [
  {
    name: 'design',
    description:
      'Write a pre-registration plan for an A/B test or non-inferiority trial. Returns plan_id and preregistration_md.',
    inputSchema: {
      type: 'object',
      properties: {
        hypothesis: { type: 'string', description: 'Hypothesis statement' },
        primary_metric: {
          type: 'object',
          description:
            'Primary OEC metric spec: {name, type: mean|ratio|proportion|quantile|bootstrap, column?, numer?, denom?}',
        },
        guardrails: {
          type: 'array',
          description: 'Optional list of guardrail metric specs',
          items: { type: 'object' },
        },
        trial_type: {
          type: 'string',
          enum: ['superiority', 'non_inferiority', 'equivalence'],
          description: 'Trial objective (default superiority)',
        },
        non_inferiority_margin: {
          type: 'number',
          description: 'Relative non-inferiority margin (e.g. 0.005 for 0.5%) when trial_type is non_inferiority',
        },
        unit: { type: 'string', description: 'Randomization unit (default "user")' },
        alpha: { type: 'number', description: 'Significance level (default 0.05)' },
        mde_rel: { type: 'number', description: 'Relative minimum detectable effect (default 0.05)' },
        direction: {
          type: 'string',
          enum: ['two-sided', 'greater', 'less'],
          description: 'Alternative hypothesis direction (default "two-sided")',
        },
        min_duration_days: {
          type: 'number',
          description: 'Minimum duration in days (default 7 for full weekly cycle)',
        },
        baseline_mean: { type: 'number', description: 'Optional historical baseline mean to embed sample size' },
        baseline_std: { type: 'number', description: 'Optional historical baseline std' },
      },
      required: ['hypothesis', 'primary_metric'],
    },
  },
  {
    name: 'power',
    description:
      'Sample size per arm to detect a relative effect mde_rel (or non_inferiority_margin) at target power and alpha.',
    inputSchema: {
      type: 'object',
      properties: {
        metric: {
          type: 'object',
          description: 'Metric spec {name, type: mean|ratio|proportion}',
        },
        baseline_mean: { type: 'number', description: 'Historical baseline mean or conversion rate in (0, 1)' },
        baseline_std: { type: 'number', description: 'Historical std (optional for proportion)' },
        mde_rel: { type: 'number', description: 'Relative MDE (e.g. 0.05 for +5%)' },
        alpha: { type: 'number', description: 'Significance level (default 0.05)' },
        power: { type: 'number', description: 'Target statistical power (default 0.8)' },
        ratio: { type: 'number', description: 'Treatment / control allocation ratio (default 1.0)' },
        cuped_r2: { type: 'number', description: 'Expected R^2 of pre-experiment CUPED covariate in [0, 1)' },
        non_inferiority_margin: { type: 'number', description: 'Optional relative non-inferiority margin' },
      },
      required: ['metric', 'baseline_mean'],
    },
  },
  {
    name: 'srm_check',
    description:
      'Sample ratio mismatch (SRM) chi-square check from unit counts per variant (default 1:1 split, alpha=0.001). Always run before reading metric effects.',
    inputSchema: {
      type: 'object',
      properties: {
        counts: {
          type: 'object',
          description: 'Mapping of variant name to unit count, e.g. {"control": 5012, "treatment": 4988}',
        },
        expected_ratio: {
          type: 'object',
          description: 'Optional expected traffic weights per variant, e.g. {"control": 0.5, "treatment": 0.5}',
        },
        alpha: { type: 'number', description: 'SRM threshold (default 0.001)' },
      },
      required: ['counts'],
    },
  },
  {
    name: 'analyze',
    description:
      'Fixed-horizon A/B(/n) analysis with automatic SRM check, Welch t-test, delta-method ratio metrics, CUPED covariates, Holm/BH corrections, Yuen trimmed means, and bootstrap quantiles.',
    inputSchema: {
      type: 'object',
      properties: {
        data_ref: {
          type: 'string',
          description: 'CSV/JSON file path, inline CSV text, or JSON array of unit rows',
        },
        variant_col: { type: 'string', description: 'Column identifying the assigned variant' },
        metrics: {
          type: 'array',
          description: 'List of MetricSpec objects to analyze',
          items: { type: 'object' },
        },
        control: { type: 'string', description: 'Control variant value' },
        covariates: { type: 'object', description: 'Optional CUPED covariates map {metric_name: pre_period_col}' },
        multiple_testing: {
          type: 'string',
          enum: ['none', 'holm', 'bh'],
          description: 'Multiple testing adjustment across metrics/segments',
        },
        robust: {
          type: 'object',
          description: 'Optional {winsorize_pct: 0.05, test: "yuen"} for trimmed-mean sensitivity rows',
        },
        alpha: { type: 'number', description: 'Significance level (default 0.05)' },
        randomization_unit: {
          type: 'string',
          description: 'Column of randomized unit (e.g. user_id) when rows are finer analysis units',
        },
        segment_col: { type: 'string', description: 'Optional exploratory subgroup column' },
        n_resamples: {
          type: 'number',
          description: 'Bootstrap resamples for quantile/bootstrap metrics (default 2000)',
        },
        seed: { type: 'number', description: 'RNG seed (default 0)' },
        non_inferiority_margin: { type: 'number', description: 'Optional relative non-inferiority margin' },
      },
      required: ['data_ref', 'variant_col', 'metrics', 'control'],
    },
  },
  {
    name: 'sequential_check',
    description:
      'Opt-in continuous monitoring via mSPRT (always-valid p-value and running-intersection CI). Use only when sequential monitoring was pre-registered.',
    inputSchema: {
      type: 'object',
      properties: {
        looks: {
          type: 'array',
          description:
            'Cumulative stats per look in time order: [{n_control, n_treatment, mean_control, mean_treatment, std_control?, std_treatment?}]',
          items: { type: 'object' },
        },
        metric_type: { type: 'string', enum: ['mean', 'proportion'], description: 'Metric type (default "mean")' },
        alpha: { type: 'number', description: 'Always-valid alpha (default 0.05)' },
        tau2: { type: 'number', description: 'Mixing variance tau^2 (or pass mde_abs / mde_rel)' },
        mde_abs: { type: 'number', description: 'Absolute MDE used to set tau^2 = mde_abs^2' },
        mde_rel: { type: 'number', description: 'Relative MDE used to set tau^2 = (mde_rel * mean_control_0)^2' },
        max_n_per_arm: { type: 'number', description: 'Maximum planned sample size per arm' },
      },
      required: ['looks'],
    },
  },
  {
    name: 'compare_eval_runs',
    description:
      'Compare two agent/prompt/model eval configurations across repeated runs (scores_a and scores_b are runs x cases matrices). Supports paired t-test and seeded two-level cluster bootstrap.',
    inputSchema: {
      type: 'object',
      properties: {
        scores_a: {
          type: 'array',
          description: 'runs x cases matrix of scores for baseline A',
          items: { type: 'array' },
        },
        scores_b: {
          type: 'array',
          description: 'runs x cases matrix of scores for candidate B',
          items: { type: 'array' },
        },
        paired: {
          type: 'boolean',
          description: 'Whether A and B were evaluated on the same ordered cases (default true)',
        },
        alpha: { type: 'number', description: 'Significance level (default 0.05)' },
        ci_method: {
          type: 'string',
          enum: ['analytic', 'cluster_bootstrap'],
          description: 'Confidence interval method (default "analytic")',
        },
        n_resamples: {
          type: 'number',
          description: 'Bootstrap resamples when ci_method="cluster_bootstrap" (default 5000)',
        },
        seed: { type: 'number', description: 'Bootstrap RNG seed (default 0)' },
      },
      required: ['scores_a', 'scores_b'],
    },
  },
  {
    name: 'agreement_kappa',
    description:
      "Cohen's kappa inter-rater agreement between two raters (e.g. LLM judge vs human labels) with bootstrap CI and confusion matrix.",
    inputSchema: {
      type: 'object',
      properties: {
        rater_a: { type: 'array', description: 'Ordered labels from rater A', items: { type: 'string' } },
        rater_b: { type: 'array', description: 'Ordered labels from rater B', items: { type: 'string' } },
        labels: { type: 'array', description: 'Optional explicit class list', items: { type: 'string' } },
        alpha: { type: 'number', description: 'Significance level (default 0.05)' },
        n_resamples: { type: 'number', description: 'Bootstrap resamples (default 2000)' },
        seed: { type: 'number', description: 'Bootstrap seed (default 3)' },
      },
      required: ['rater_a', 'rater_b'],
    },
  },
  {
    name: 'report',
    description:
      'Render a traceable Markdown experiment report (stakeholder or technical audience) from analyze, srm_check, or sequential_check outputs.',
    inputSchema: {
      type: 'object',
      properties: {
        plan_id: { type: 'string', description: 'Optional pre-registration plan_id from design()' },
        results: { type: 'object', description: 'Output object from analyze()' },
        srm: { type: 'object', description: 'Optional output from srm_check()' },
        sequential: { type: 'object', description: 'Optional output from sequential_check()' },
        audience: {
          type: 'string',
          enum: ['stakeholder', 'technical'],
          description: 'Report audience (default stakeholder)',
        },
      },
      required: [],
    },
  },
];

export function callTeatoolsMcp(toolName: string, args: Record<string, unknown> = {}): McpToolCallResult {
  try {
    let out: Record<string, unknown>;
    switch (toolName) {
      case 'design':
        out = design(args as unknown as DesignInput);
        break;
      case 'power':
        out = power(args as unknown as PowerInput);
        break;
      case 'srm_check':
        out = srmCheck(args as unknown as SrmCheckInput);
        break;
      case 'analyze':
        out = analyze(args as unknown as AnalyzeInput);
        break;
      case 'sequential_check':
        out = sequentialCheck(args as unknown as SequentialCheckInput);
        break;
      case 'compare_eval_runs':
        out = compareEvalRuns(args as unknown as CompareEvalRunsInput);
        break;
      case 'agreement_kappa':
        out = agreementKappa(args as unknown as AgreementKappaInput);
        break;
      case 'report':
        out = report(args as unknown as ReportInput);
        break;
      default:
        return {
          isError: true,
          content: [{ type: 'text', text: `Unknown teatools MCP tool: ${toolName}` }],
        };
    }
    return {
      isError: false,
      content: [{ type: 'text', text: JSON.stringify(out, null, 2) }],
    };
  } catch (err) {
    return {
      isError: true,
      content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
    };
  }
}
