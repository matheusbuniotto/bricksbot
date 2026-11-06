/**
 * Catalog of installable Agent Skill packs (bundled in `skills/<name>/`).
 * Shared by client (Skills tab in ConnectorsDialog) and server (skill pack loader).
 */

export interface SkillPackCatalogEntry {
  name: string;
  title: string;
  description: string;
  category: string;
  /** Companion MCP service (e.g. `plugin.teatools`) that provides the skill's tools. */
  companionMcpService?: string;
  resources: string[];
}

export const SKILL_PACK_CATALOG: readonly SkillPackCatalogEntry[] = [
  {
    name: 'hypothesis-testing-playbook',
    title: 'Hypothesis Testing Playbook',
    description:
      "Runs A/B tests, non-inferiority/superiority trials, and agent-eval comparisons incorporating Ron Kohavi's experimentation best practices (OEC, guardrails, Twyman's Law, SRM, CUPED, mSPRT).",
    category: 'Experimentation & Stats',
    companionMcpService: 'plugin.teatools',
    resources: [
      'SKILL.md',
      'references/tool-contract.md',
      'references/interpretation-pitfalls.md',
      'assets/PREREGISTRATION_TEMPLATE.md',
      'assets/REPORT_TEMPLATE.md',
    ],
  },
];
