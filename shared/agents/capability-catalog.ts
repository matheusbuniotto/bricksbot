import { toolLabel } from './tool-labels.js';

/**
 * Pi-shaped capability registration (mirrors `defineExtension` without importing
 * `@earendil-works/pi-durable` — no Lakebase storage adapter yet).
 * Each lakehouse or memory factory is one named bundle: tools + optional prompt sections.
 */

export interface CapabilityToolOffer {
  name: string;
  label: string;
}

/** Agent Skills / Pi index entry — name + short description only. */
export interface SkillIndexEntry {
  name: string;
  description: string;
}

export interface CapabilitySoftLimits {
  /** False unless Phase 5 sandbox tools are enabled. */
  computer: boolean;
  sqlReadOnly: boolean;
  webFetchRegistered: boolean;
}

export interface CapabilityCatalog {
  tools: CapabilityToolOffer[];
  softLimits: CapabilitySoftLimits;
  teammates: Array<{ id: string; name: string }>;
  memoryKeys: string[];
  skills: SkillIndexEntry[];
}

export type BuildCapabilityCatalogInput = {
  toolNames: Iterable<string>;
  isPrimary?: boolean;
  teammates?: Array<{ id: string; name: string }>;
  memoryKeys?: string[];
  skills?: Array<{ name: string; body: string; description?: string }>;
};

const DESCRIPTION_MAX = 160;

/** First meaningful line of a skill body, used when no frontmatter description exists. */
export function skillDescriptionFromBody(body: string, maxLen = DESCRIPTION_MAX): string {
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const preferred = lines.find((line) => !/^#+\s/.test(line)) ?? lines[0] ?? 'Saved skill. Activate for full steps.';
  const cleaned = preferred.replace(/^#+\s*/, '').replace(/^[-*]\s+/, '');
  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, Math.max(1, maxLen - 1))}…`;
}

export function toSkillIndexEntry(skill: { name: string; body: string; description?: string }): SkillIndexEntry {
  const description = skill.description?.trim() || skillDescriptionFromBody(skill.body);
  return { name: skill.name, description };
}

export function buildCapabilityCatalog(input: BuildCapabilityCatalogInput): CapabilityCatalog {
  const names = [...new Set([...input.toolNames])].sort((a, b) => a.localeCompare(b));
  const tools = names.map((name) => ({ name, label: toolLabel(name) }));
  const webFetchRegistered = names.includes('web_fetch');
  const sqlReadOnly = names.includes('sql_query');
  const computer = names.includes('sandbox_exec');

  return {
    tools,
    softLimits: {
      computer,
      sqlReadOnly,
      webFetchRegistered,
    },
    teammates: input.isPrimary ? [...(input.teammates ?? [])] : [],
    memoryKeys: [...(input.memoryKeys ?? [])].sort((a, b) => a.localeCompare(b)),
    skills: [...(input.skills ?? [])].map(toSkillIndexEntry).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/**
 * Prompt sections for Capabilities (tools, soft limits, teammates) and Skills index.
 * OpenAI tool schemas remain the parameter detail on `complete()` — do not dump schemas here.
 */
export function formatCapabilityPrompt(catalog: CapabilityCatalog): string {
  const toolLine =
    catalog.tools.length > 0 ? catalog.tools.map((tool) => `${tool.label} (\`${tool.name}\`)`).join(', ') : 'none';

  const limits: string[] = [
    catalog.softLimits.computer
      ? 'Isolated Linux sandbox is enabled for this chat; never place secrets in the sandbox, and use sandbox_save_artifact before deleting a sandbox.'
      : 'Sandbox tools are disabled (SANDBOX_BACKEND=off).',
  ];
  if (catalog.softLimits.sqlReadOnly) {
    limits.push('SQL via sql_query is read-only (SELECT, WITH, SHOW, DESCRIBE, EXPLAIN).');
  }
  if (catalog.softLimits.webFetchRegistered) {
    limits.push('web_fetch is registered for allowlisted HTTPS URLs only.');
  } else {
    limits.push('web_fetch is not registered (empty allowlist).');
  }
  if (catalog.tools.some((tool) => tool.name === 'pin_chart')) {
    limits.push(
      'pin_chart builds a chart from an earlier sql_query result (max 1000 rows, never truncated results); aggregate in SQL first.'
    );
  }
  if (catalog.tools.some((tool) => tool.name === 'pin_artifact')) {
    limits.push(
      'pin_artifact pins are short shareable findings (no secrets); use kind volume_path for large content on a Volume.'
    );
  }

  const blocks: string[] = [
    [
      '## Capabilities',
      `Tools: ${toolLine}.`,
      `Soft limits: ${limits.join(' ')}`,
      'Prefer tools over guessing. Memory and skill meta tools (remember, forget, save_skill, activate_skill, read_skill_resource, list_memories) are always available on every bot — use them freely; they do not need approval. Do not remember secrets.',
      'Memory is not a source of truth: for consequential answers, cite or reopen live lakehouse/web tools instead of relying on remembered facts alone.',
      'After a successful multi-step lakehouse workflow, offer to save_skill with: when to use, inputs/access, steps, validation, return shape, and what needs approval.',
    ].join('\n'),
  ];

  if (catalog.tools.some((tool) => tool.name === 'activate_skill')) {
    blocks[0] +=
      ' When a listed skill matches the task, call activate_skill before following its steps; use read_skill_resource for bundled paths; use list_memories when a key is outside the prompt window. Built-in seed skills (sql-explore, catalog-recon, weekly-table-health, pin-finding, dataviz) appear in the index even before any bot saves its own.';
  }

  if (catalog.tools.some((tool) => tool.name === 'pin_artifact')) {
    blocks[0] +=
      ' Use pin_artifact (Ask-first) for durable shareable findings on this chat; use remember for lasting rules and preferences.';
  }

  if (catalog.tools.some((tool) => tool.name === 'volume_write')) {
    blocks[0] +=
      ' Use volume_write (Ask-first) for durable files under this user and bot on the Volume; use pin_artifact for short findings; sandbox_save_artifact saves sandbox outputs into the same tree. volume_write is unavailable on routine runs.';
  }

  if (catalog.tools.some((tool) => tool.name === 'pin_chart')) {
    blocks[0] +=
      ' Interactive charts, tables, and diagrams render directly in the chat UI: use pin_chart for sql_query results, or pin_artifact (kind "chart" with a Vega-Lite v6 spec and inline data.values, "table", or "mermaid") for any other data. Always use a chart tool when asked for a plot—never draw ASCII/text charts or claim you cannot attach images.';
  }

  if (catalog.tools.some((tool) => tool.name === 'ask_choice')) {
    blocks[0] +=
      ' Use ask_choice (Ask-first, no Always allow) when the user must pick between genuinely different options; the answer is stored in the transcript. Never use it, or a text question like "Proceed?", to confirm an action: Ask-first tools (create_bot, sql_query, schedule_routine, handoff_to_bot, …) already show an approval card, so just call the tool.';
  }

  if (catalog.tools.some((tool) => tool.name === 'schedule_routine')) {
    blocks[0] +=
      ' Routines CRUD: list_routines (auto), schedule_routine / update_routine (Ask-first), delete_routine (Ask every time). Job wiring stays a human step after create.';
  }

  if (catalog.tools.some((tool) => tool.name === 'sandbox_exec')) {
    blocks[0] +=
      ' Sandbox tools: python_exec / sandbox_exec / sandbox_upload / sandbox_download / sandbox_save_artifact (Ask-first), sandbox_stop (auto), sandbox_delete (Ask every time). Prefer python_exec for self-contained Python calculations or data scripts.';
  }

  if (catalog.tools.some((tool) => tool.name === 'genie_ask')) {
    blocks[0] +=
      ' Genie (Databricks One via genie_ask) is available for natural-language analytics grounded in the Genie Ontology. Prefer cheap tools (sql_query, lakehouse_catalog) for direct exploration; escalate to genie_ask for business metrics and definitions. genie_ask always requires approval.';
  }

  if (catalog.tools.some((tool) => tool.name.startsWith('mcp_'))) {
    blocks[0] +=
      ' Connected Unity Catalog MCP tools (names starting with mcp_) are Ask-first; prefer cheap lakehouse tools when they cover the need.';
  }

  const creatable: string[] = [];
  if (catalog.tools.some((tool) => tool.name === 'schedule_routine')) {
    creatable.push('routines (schedule_routine)');
  }
  if (catalog.tools.some((tool) => tool.name === 'create_bot')) {
    creatable.push('teammate bots (create_bot, Primary only)');
  }
  if (catalog.tools.some((tool) => tool.name === 'pin_artifact')) {
    creatable.push('artifact pins (pin_artifact)');
  }
  if (catalog.tools.some((tool) => tool.name === 'volume_write')) {
    creatable.push('volume files (volume_write)');
  }
  if (catalog.tools.some((tool) => tool.name === 'pin_chart')) {
    creatable.push('charts from query results (pin_chart)');
  }
  if (catalog.tools.some((tool) => tool.name === 'save_skill')) {
    creatable.push('skills (save_skill)');
  }
  if (catalog.tools.some((tool) => tool.name === 'remember')) {
    creatable.push('memories (remember)');
  }
  if (creatable.length > 0) {
    blocks.push(
      `You can create: ${creatable.join('; ')}. Use ask_choice only when details are ambiguous, not to confirm.`
    );
  }

  const canCreateBot = catalog.tools.some((tool) => tool.name === 'create_bot');
  const canHandoff = catalog.tools.some((tool) => tool.name === 'handoff_to_bot');

  if (catalog.teammates.length > 0) {
    const list = catalog.teammates.map((bot) => `${bot.name} (${bot.id})`).join(', ');
    blocks.push(
      `Teammates (Primary handoff only): ${list}. Use handoff_to_bot for one brief, then summarize the reply.`
    );
  } else if (canHandoff) {
    blocks.push(
      'You are the Primary bot. Use handoff_to_bot to hand one brief to a teammate when the roster lists any. Only you may hand off.'
    );
  }

  if (canCreateBot) {
    blocks.push(
      'You can create focused teammates with create_bot when a job needs a long-lived owner and no teammate fits. Prefer handoff_to_bot otherwise. Creating a bot always shows an approval card, so call create_bot directly (once per bot) without asking to proceed. Pass job as an operational brief: goal/ownership, sources, working style, and approval boundary (what never happens without the user).'
    );
  } else if (!canHandoff) {
    blocks.push(
      'You cannot create bots. Ask the user to have Primary create a focused teammate, or describe the role so they can.'
    );
  }

  if (catalog.memoryKeys.length > 0) {
    const keyCap = 40;
    const shown = catalog.memoryKeys.slice(0, keyCap);
    const more = catalog.memoryKeys.length - shown.length;
    const suffix = more > 0 ? ` (+${more} more; call list_memories)` : '';
    blocks.push(`Memory keys in store: ${shown.join(', ')}${suffix}.`);
  }

  if (catalog.skills.length > 0) {
    blocks.push(
      [
        '## Skills',
        'Index only — activate a skill to load its full body.',
        ...catalog.skills.map((skill) => `- ${skill.name}: ${skill.description}`),
      ].join('\n')
    );
  } else {
    blocks.push('## Skills\n(none saved yet)');
  }

  return blocks.join('\n\n');
}
