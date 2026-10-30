/** Human-facing labels for tool ids — keep snake_case out of the UI. */

const TOOL_LABELS: Record<string, string> = {
  sql_query: 'SQL query',
  lakehouse_catalog: 'Catalog browse',
  volume_read: 'Volume read',
  web_fetch: 'Web fetch',
  handoff_to_bot: 'Message another bot',
  create_bot: 'Create a bot',
  remember: 'Save memory',
  forget: 'Forget memory',
  save_skill: 'Save skill',
  activate_skill: 'Activate skill',
  read_skill_resource: 'Read skill resource',
  list_memories: 'List memories',
  pin_artifact: 'Pin finding',
  ask_choice: 'Ask for your choice',
  schedule_routine: 'Schedule a routine',
  list_routines: 'List routines',
  update_routine: 'Update a routine',
  delete_routine: 'Delete a routine',
};

export function toolLabel(name: string): string {
  if (TOOL_LABELS[name]) return TOOL_LABELS[name];
  return name
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

export function approvalTitle(toolName: string): string {
  switch (toolName) {
    case 'sql_query':
      return 'Allow this bot to run a SQL query?';
    case 'lakehouse_catalog':
      return 'Allow this bot to browse the lakehouse catalog?';
    case 'volume_read':
      return 'Allow this bot to read a volume file?';
    case 'web_fetch':
      return 'Allow this bot to fetch a web page?';
    case 'handoff_to_bot':
      return 'Allow this bot to message another bot?';
    case 'create_bot':
      return 'Allow Primary to create a new bot?';
    case 'remember':
      return 'Allow this bot to save a memory?';
    case 'forget':
      return 'Allow this bot to forget a memory?';
    case 'save_skill':
      return 'Allow this bot to save a skill?';
    case 'activate_skill':
      return 'Allow this bot to activate a skill?';
    case 'read_skill_resource':
      return 'Allow this bot to read a skill resource?';
    case 'list_memories':
      return 'Allow this bot to list memories?';
    case 'pin_artifact':
      return 'Allow this bot to pin a finding on this chat?';
    case 'ask_choice':
      return 'Allow this bot to ask you to choose an option?';
    case 'schedule_routine':
      return 'Allow this bot to schedule a routine?';
    case 'list_routines':
      return 'Allow this bot to list routines?';
    case 'update_routine':
      return 'Allow this bot to update a routine?';
    case 'delete_routine':
      return 'Allow this bot to delete a routine?';
    default:
      return `Allow this bot to run “${toolLabel(toolName)}”?`;
  }
}
