#!/usr/bin/env node
// Prepare a workspace for `databricks bundle deploy`: pick Lakebase, a SQL warehouse and the LLM
// provider (OpenRouter key, or a Model Serving endpoint so no key leaves Databricks), and write
// dev.local.yml. Safe to re-run.
//
//   npm run bootstrap -- -p <profile>

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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

  const choice = await choose('LLM provider', [
    { value: 'serving', label: 'Databricks Model Serving (no API key, model calls stay in Databricks)' },
    { value: 'openrouter', label: 'OpenRouter (needs an API key)' },
  ]);
  const servingEndpoint = choice === 'serving' ? await chooseServingEndpoint(cli) : '';
  const provider = servingEndpoint ? 'serving' : 'openrouter';
  if (provider === 'openrouter') await ensureLlmSecret(cli, profile);

  if (await confirmWrite(LOCAL_CONFIG)) {
    writeFileSync(LOCAL_CONFIG, localConfig({ branch, database, warehouse, servingEndpoint }));
    console.log(`Wrote ${LOCAL_CONFIG}`);
  } else if (servingEndpoint) {
    setServingEndpoint(LOCAL_CONFIG, servingEndpoint);
    console.log(`Kept ${LOCAL_CONFIG}, set serving_endpoint_name: ${servingEndpoint}`);
  }
  selectProvider(provider);

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

/** Returns '' when the workspace has no chat endpoints and the user falls back to OpenRouter. */
async function chooseServingEndpoint(cli) {
  const chatEndpoints = cli('serving-endpoints', 'list').filter((endpoint) => endpoint.task === 'llm/v1/chat');
  if (chatEndpoints.length === 0) {
    if (!(await yes('No Model Serving chat endpoints in this workspace. Use OpenRouter instead?'))) {
      fail('Create a chat endpoint (e.g. a Foundation Model API one) and re-run bootstrap.');
    }
    return '';
  }
  return choose(
    'Serving endpoint',
    chatEndpoints.map((endpoint) => ({
      value: endpoint.name,
      label: `${endpoint.name} (${endpoint.state?.ready ?? 'unknown'})`,
    }))
  );
}

/** Keep an existing dev.local.yml, changing only the endpoint. */
function setServingEndpoint(path, name) {
  const text = readFileSync(path, 'utf8');
  const existing = /^(\s*)serving_endpoint_name:.*$/m;
  const variables = /^(\s*)variables:[ \t]*$/m;
  if (existing.test(text))
    return writeFileSync(
      path,
      text.replace(existing, (_, indent) => `${indent}serving_endpoint_name: ${name}`)
    );
  if (variables.test(text)) {
    return writeFileSync(
      path,
      text.replace(variables, (line, indent) => `${line}\n${indent}  serving_endpoint_name: ${name}`)
    );
  }
  fail(`Add serving_endpoint_name: ${name} under targets.dev.variables in ${path}, then re-run.`);
}

/**
 * databricks.yml and app.yaml each carry an `llm:openrouter` and an `llm:serving` block between
 * `# llm:<name> begin` / `end` markers. Enable one by uncommenting it and comment the other out.
 * This edits those tracked files: the app env and resource list cannot be overridden from the
 * gitignored dev.local.yml (bundle lists append, and app.yaml is read as is).
 */
function selectProvider(provider) {
  const edits = ['databricks.yml', 'app.yaml'].map((file) => {
    const before = readFileSync(file, 'utf8');
    let after = before;
    for (const name of ['openrouter', 'serving']) after = toggleBlock(after, file, name, name === provider);
    return { file, before, after };
  });

  const changed = edits.filter(({ before, after }) => before !== after);
  for (const { file, after } of changed) writeFileSync(file, after);
  if (changed.length > 0) {
    console.warn(
      `\nNOTE: switched the ${provider} LLM blocks in tracked files: ${changed.map(({ file }) => file).join(', ')}.\n` +
        'Do not commit that by accident; undo with `git checkout databricks.yml app.yaml`.'
    );
  }
}

function toggleBlock(text, file, name, enabled) {
  const count = (marker) => text.split('\n').filter((line) => line.includes(`# llm:${name} ${marker}`)).length;
  if (count('begin') !== 1 || count('end') !== 1) {
    fail(`${file} needs exactly one "# llm:${name} begin" and one "# llm:${name} end" marker.`);
  }

  let inside = false;
  let indent = '';
  return text
    .split('\n')
    .map((line) => {
      if (line.includes(`# llm:${name} begin`)) {
        inside = true;
        indent = line.match(/^\s*/)[0];
      } else if (line.includes(`# llm:${name} end`)) inside = false;
      else if (inside) {
        const code = line.startsWith(`${indent}# `) ? line.slice(indent.length + 2) : line.slice(indent.length);
        return enabled ? `${indent}${code}` : `${indent}# ${code}`;
      }
      return line;
    })
    .join('\n');
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
    console.log(
      `Skipped. The App needs ${SCOPE}/${LLM_SECRET_KEY} before deploy (or re-run bootstrap and pick Model Serving).`
    );
    return;
  }
  // Let the CLI prompt for the value so the key never appears in argv or shell history.
  releaseTerminal();
  databricksInteractive('secrets', 'put-secret', SCOPE, LLM_SECRET_KEY, '-p', profile);
}

function localConfig({ branch, database, warehouse, servingEndpoint }) {
  const serving = servingEndpoint ? `\n      serving_endpoint_name: ${servingEndpoint}` : '';
  return `# Written by scripts/bootstrap.mjs. Gitignored: never commit real ids or hosts.
targets:
  dev:
    variables:
      lakebase_branch: ${branch}
      lakebase_database: ${database}
      sql_warehouse_id: '${warehouse}'${serving}
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
