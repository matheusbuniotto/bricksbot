/**
 * Default meta tools for every bot (Primary and teammates).
 * Always registered when ChatService boots; never Ask-first; never Primary-only.
 * Handoff stays Primary-only and is not in this set.
 */
export const DEFAULT_META_TOOL_NAMES = [
  'remember',
  'forget',
  'save_skill',
  'activate_skill',
  'read_skill_resource',
  'list_memories',
] as const;

export type DefaultMetaToolName = (typeof DEFAULT_META_TOOL_NAMES)[number];

const DEFAULT_META_TOOL_SET: ReadonlySet<string> = new Set(DEFAULT_META_TOOL_NAMES);

export function isDefaultMetaTool(name: string): name is DefaultMetaToolName {
  return DEFAULT_META_TOOL_SET.has(name);
}
