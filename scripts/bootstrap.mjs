#!/usr/bin/env node
// Prepare a workspace for `databricks bundle deploy`: pick Lakebase and a SQL warehouse,
// create the LLM secret, and write dev.local.yml. Safe to re-run.
//
//   npm run bootstrap -- -p <profile>

import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const SCOPE = 'bricksbot';
const LLM_SECRET_KEY = 'openrouter-api-key';
const LOCAL_CONFIG = 'dev.local.yml';

async function main() {
  const profile = profileFromArgs() ?? ((await ask('Databricks CLI profile', 'DEFAULT')) || 'DEFAULT');
  const cli = (...args) => databricks(...args, '-p', profile);

  const me = cli('current-user', 'me');
  console.log(`Signed in as ${me.userName}\n`);

  const branch = await chooseLakebaseBranch(cli);
  const database = await choose(
    'Lakebase database',
    cli('postgres', 'list-databases', branch).map((db) => db.name)
  );
  const warehouse = await choose(
    'SQL warehouse',
    cli('warehouses', 'list').map((wh) => ({ value: wh.id, label: `${wh.name} (${wh.state})` }))
  );

  await ensureLlmSecret(cli, profile);

  if (await confirmWrite(LOCAL_CONFIG)) {
    writeFileSync(LOCAL_CONFIG, localConfig({ branch, database, warehouse }));
    console.log(`Wrote ${LOCAL_CONFIG}`);
  }

  console.log('\nValidating bundle…');
  databricksInteractive('bundle', 'validate', '-p', profile);

  console.log(`
Ready. Deploy with:
  databricks bundle deploy -p ${profile}
  databricks bundle run app -p ${profile}`);
}

async function chooseLakebaseBranch(cli) {
  const projects = cli('postgres', 'list-projects').map((project) => project.name);

  if (projects.length === 0) {
    const projectId = await ask('No Lakebase project found. Create one named', 'bricksbot');
    console.log(`Creating Lakebase project ${projectId} (takes a minute)…`);
    cli('postgres', 'create-project', projectId);
    projects.push(`projects/${projectId}`);
  }

  const project = await choose('Lakebase project', projects);
  const branches = cli('postgres', 'list-branches', project);
  const defaultFirst = [...branches].sort(
    (a, b) => Number(Boolean(b.status?.default)) - Number(Boolean(a.status?.default))
  );
  return choose(
    'Lakebase branch',
    defaultFirst.map((b) => b.name)
  );
}

async function ensureLlmSecret(cli, profile) {
  const scopes = cli('secrets', 'list-scopes').map((scope) => scope.name);
  if (!scopes.includes(SCOPE)) {
    console.log(`Creating secret scope ${SCOPE}`);
    cli('secrets', 'create-scope', SCOPE);
  }

  const keys = cli('secrets', 'list-secrets', SCOPE).map((secret) => secret.key);
  if (keys.includes(LLM_SECRET_KEY)) {
    console.log(`Secret ${SCOPE}/${LLM_SECRET_KEY} already set`);
    return;
  }

  if (!(await yes(`Store your OpenRouter API key in ${SCOPE}/${LLM_SECRET_KEY} now?`))) {
    console.log(`Skipped. The App needs ${SCOPE}/${LLM_SECRET_KEY} before deploy (or switch to Serving in app.yaml).`);
    return;
  }
  // Let the CLI prompt for the value so the key never appears in argv or shell history.
  releaseTerminal();
  databricksInteractive('secrets', 'put-secret', SCOPE, LLM_SECRET_KEY, '-p', profile);
}

function localConfig({ branch, database, warehouse }) {
  return `# Written by scripts/bootstrap.mjs. Gitignored: never commit real ids or hosts.
targets:
  dev:
    variables:
      lakebase_branch: ${branch}
      lakebase_database: ${database}
      sql_warehouse_id: '${warehouse}'
`;
}

// --- prompts ---------------------------------------------------------------

// A line iterator buffers input, so piped answers are not lost between questions.
let prompt;
let lines;

async function ask(question, fallback) {
  if (!prompt) {
    prompt = createInterface({ input: process.stdin, output: process.stdout });
    lines = prompt[Symbol.asyncIterator]();
  }
  process.stdout.write(`${question} [${fallback}]: `);
  const { value = '' } = await lines.next();
  return value.trim() || fallback;
}

/** Hand the terminal to a child process that prompts on its own. */
function releaseTerminal() {
  prompt?.close();
  prompt = undefined;
}

async function yes(question) {
  return /^y/i.test(await ask(`${question} (y/n)`, 'y'));
}

async function confirmWrite(path) {
  return !existsSync(path) || yes(`${path} exists. Overwrite?`);
}

/** Pick one option; options are strings or `{ value, label }`. Auto-picks a single option. */
async function choose(title, options) {
  const items = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
  if (items.length === 0) fail(`No ${title} found in this workspace.`);
  if (items.length === 1) {
    console.log(`${title}: ${items[0].label}`);
    return items[0].value;
  }

  console.log(`${title}:`);
  items.forEach((item, i) => console.log(`  ${i + 1}. ${item.label}`));
  const index = Number(await ask('Choose', '1')) - 1;
  if (!items[index]) fail(`Invalid choice for ${title}.`);
  return items[index].value;
}

// --- databricks CLI --------------------------------------------------------

function databricks(...args) {
  try {
    const out = execFileSync('databricks', [...args, '-o', 'json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return out.trim() ? JSON.parse(out) : [];
  } catch (error) {
    fail(`databricks ${args.join(' ')} failed:\n${error.stderr || error.message}`);
  }
}

function databricksInteractive(...args) {
  try {
    execFileSync('databricks', args, { stdio: 'inherit' });
  } catch {
    fail(`databricks ${args.join(' ')} failed.`);
  }
}

function profileFromArgs() {
  const args = process.argv.slice(2);
  const i = args.findIndex((arg) => arg === '-p' || arg === '--profile');
  return i >= 0 ? args[i + 1] : undefined;
}

function fail(message) {
  console.error(`\n${message}`);
  process.exit(1);
}

await main();
releaseTerminal();
