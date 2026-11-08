import { describe, expect, it } from 'vitest';
import { MemoryChatStore } from '../../../chat/memory-store.js';
import { MemoryMemorySkillStore } from '../../memory/memory-store.js';
import { loadBundledSkillPack } from '../../memory/skill-packs.js';
import { McpDiscoveryService } from '../mcp-discovery.js';
import { buildConnectedMcpTools } from '../mcp-tools.js';
import { createActivateSkillTool, createReadSkillResourceTool } from '../pi-skills-tools.js';
import {
  agreementKappa,
  analyze,
  compareEvalRuns,
  design,
  power,
  report,
  sequentialCheck,
  srmCheck,
} from './engine.js';
import { TEATOOLS_MCP_SERVICE } from './mcp-server.js';

describe('teatools MCP + hypothesis-testing-playbook skill pack', () => {
  it('designs and sizes a pre-registered experiment', () => {
    const plan = design({
      hypothesis: 'New checkout layout increases conversion rate',
      primary_metric: { name: 'conversion', type: 'proportion' },
      guardrails: [{ name: 'latency_ms', type: 'mean', higher_is_better: false }],
      baseline_mean: 0.1,
      mde_rel: 0.05,
    });
    expect(plan.plan_id).toContain('new-checkout-layout');
    expect(String(plan.preregistration_md)).toContain('conversion');

    const pwr = power({
      metric: { name: 'conversion', type: 'proportion' },
      baseline_mean: 0.1,
      mde_rel: 0.05,
      alpha: 0.05,
      power: 0.8,
    });
    expect(Number(pwr.n_per_arm)).toBeGreaterThan(50_000);
    expect(Number(pwr.total_n)).toBe(Number(pwr.n_per_arm) * 2);
  });

  it('detects SRM and passes balanced splits', () => {
    const balanced = srmCheck({ counts: { control: 5010, treatment: 4990 } });
    expect(balanced.is_srm).toBe(false);
    expect(Number(balanced.pvalue)).toBeGreaterThan(0.5);

    const skewed = srmCheck({ counts: { control: 5500, treatment: 4500 } });
    expect(skewed.is_srm).toBe(true);
    expect(Number(skewed.pvalue)).toBeLessThan(0.001);
  });

  it('analyzes an experiment with Welch t-test, CUPED, and Yuen trimmed mean, then renders report', () => {
    const rows = [
      { user_id: 'u1', variant: 'control', rev: 10, pre_rev: 9 },
      { user_id: 'u2', variant: 'control', rev: 12, pre_rev: 11 },
      { user_id: 'u3', variant: 'control', rev: 11, pre_rev: 10 },
      { user_id: 'u4', variant: 'control', rev: 9, pre_rev: 9 },
      { user_id: 'u5', variant: 'control', rev: 10, pre_rev: 10 },
      { user_id: 'u6', variant: 'control', rev: 11, pre_rev: 11 },
      { user_id: 'u7', variant: 'treatment', rev: 15, pre_rev: 10 },
      { user_id: 'u8', variant: 'treatment', rev: 16, pre_rev: 11 },
      { user_id: 'u9', variant: 'treatment', rev: 14, pre_rev: 9 },
      { user_id: 'u10', variant: 'treatment', rev: 15, pre_rev: 10 },
      { user_id: 'u11', variant: 'treatment', rev: 17, pre_rev: 11 },
      { user_id: 'u12', variant: 'treatment', rev: 15, pre_rev: 10 },
    ];
    const res = analyze({
      data_ref: rows,
      variant_col: 'variant',
      control: 'control',
      metrics: [{ name: 'rev', type: 'mean' }],
      covariates: { rev: 'pre_rev' },
      robust: { winsorize_pct: 0.1, test: 'yuen' },
    });
    const list = res.results as Array<Record<string, unknown>>;
    expect(list).toHaveLength(2);
    expect(list[0].metric).toBe('rev');
    expect(list[0].significant).toBe(true);
    expect(list[1].metric).toBe('rev__yuen');

    const rep = report({ results: res, audience: 'stakeholder' });
    expect(String(rep.markdown)).toContain('Ship-worthy');
  });

  it('compares repeated agent eval runs (analytic and seeded cluster bootstrap)', () => {
    const a = [
      [0.1, 0.5, 0.9, 0.3],
      [0.2, 0.4, 0.8, 0.4],
    ];
    const b = a.map((run) => run.map((x) => x + 0.1));
    const an = compareEvalRuns({ scores_a: a, scores_b: b, paired: true });
    expect(Number(an.diff)).toBeCloseTo(0.1, 6);
    expect(Number(an.run_to_run_std_a)).toBeCloseTo(0, 6);

    const bs1 = compareEvalRuns({
      scores_a: a,
      scores_b: b,
      ci_method: 'cluster_bootstrap',
      n_resamples: 300,
      seed: 7,
    });
    const bs2 = compareEvalRuns({
      scores_a: a,
      scores_b: b,
      ci_method: 'cluster_bootstrap',
      n_resamples: 300,
      seed: 7,
    });
    expect(bs1.ci).toEqual(bs2.ci);
  });

  it('monitors sequential looks with mSPRT and computes Cohen kappa', () => {
    const seq = sequentialCheck({
      looks: [
        {
          n_control: 200,
          n_treatment: 200,
          mean_control: 1.0,
          mean_treatment: 1.5,
          std_control: 1.0,
          std_treatment: 1.0,
        },
      ],
      metric_type: 'mean',
      mde_abs: 0.2,
    });
    expect(seq.decision).toBe('stop_reject');

    const kap = agreementKappa({
      rater_a: ['pass', 'pass', 'fail', 'pass', 'fail', 'fail'],
      rater_b: ['pass', 'pass', 'fail', 'fail', 'fail', 'fail'],
      n_resamples: 200,
      seed: 1,
    });
    expect(Number(kap.kappa)).toBeGreaterThan(0.5);
  });

  it('registers plugin.teatools via McpDiscoveryService and exposes all 8 MCP tools', async () => {
    const discovery = new McpDiscoveryService({});
    const connected = await discovery.connect(TEATOOLS_MCP_SERVICE);
    expect(connected.connected).toBe(true);
    expect(connected.tools).toContain('design');
    expect(connected.tools).toContain('compare_eval_runs');

    const mcpTools = await buildConnectedMcpTools(discovery, discovery.getClientConfig());
    const names = mcpTools.map((t) => t.definition.name);
    expect(names).toContain('mcp_plugin_teatools_design');
    expect(names).toContain('mcp_plugin_teatools_srm_check');
    expect(names).toContain('mcp_plugin_teatools_analyze');

    const srmTool = mcpTools.find((t) => t.definition.name === 'mcp_plugin_teatools_srm_check')!;
    const out = JSON.parse(await srmTool.execute({ counts: { c: 1000, t: 1000 } }, { chatId: 'c1', bot: null })) as {
      is_srm: boolean;
    };
    expect(out.is_srm).toBe(false);
  });

  it('loads bundled hypothesis-testing-playbook skill pack and serves its resources via read_skill_resource', async () => {
    const pack = await loadBundledSkillPack('hypothesis-testing-playbook');
    expect(pack).not.toBeNull();
    expect(pack!.resources['references/tool-contract.md']).toContain('compare_eval_runs');

    const store = new MemoryChatStore();
    const bot = await store.ensurePrimaryBot();
    const memory = new MemoryMemorySkillStore();
    await memory.upsertSkill(bot.id, pack!.entry.name, pack!.body);

    const activate = createActivateSkillTool(memory);
    const actRes = JSON.parse(
      await activate.execute({ name: 'hypothesis-testing-playbook' }, { chatId: 'c1', bot })
    ) as { ok: boolean; resources: string[] };
    expect(actRes.ok).toBe(true);
    expect(actRes.resources).toContain('references/tool-contract.md');
    expect(actRes.resources).toContain('assets/PREREGISTRATION_TEMPLATE.md');

    const readResTool = createReadSkillResourceTool(memory);
    const contract = JSON.parse(
      await readResTool.execute(
        { name: 'hypothesis-testing-playbook', path: 'references/tool-contract.md' },
        { chatId: 'c1', bot }
      )
    ) as { ok: boolean; content: string };
    expect(contract.ok).toBe(true);
    expect(contract.content).toContain('srm_check');
  });
});
