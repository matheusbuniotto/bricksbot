# Contributing to BricksBot

BricksBot is licensed under [Apache-2.0](LICENSE). By submitting a contribution you agree it is licensed under the same terms.

## Dev loop

Requirements: Node.js 22+, npm.

```bash
npm ci
npm run dev        # http://localhost:8000
```

Without `LAKEBASE_ENDPOINT` / `PGHOST` the server uses an in-memory store, and without an LLM key it uses a stub client. Both are enough to work on the UI and most server logic. Copy `.env.example` to `.env` for anything more.

## Checks before a PR

```bash
npm test           # vitest
npm run typecheck
npm run lint
npm run format
```

Run `npm run build` if you touched build config or shared types.

## Where code goes

Types in `shared/`, logic in `server/`, UI in `client/`. Keep changes small and aligned to one domain. [AGENTS.md](AGENTS.md) describes the layout and the agent-loop invariants (valid OpenAI tool-call history, durable approvals, idempotent `requestId`). Read it before changing `server/chat/` or `server/agents/`.

## Secrets

Never commit secrets, tokens, workspace hostnames, or personal Lakebase endpoints. Use placeholders in docs and `.env.example`. Do not invent secret values in code or tests.

## Deploying to a workspace (optional)

Deploys use the Databricks CLI and the bundle in `databricks.yml`. Pass your own profile with `-p <profile>`:

```bash
databricks bundle validate -p <profile>
databricks bundle deploy -p <profile> && databricks bundle run app -p <profile>
```

The bundle's `dev` target still carries maintainer defaults for Lakebase and secrets. A self-contained install path is tracked in [docs/oss-community-release.md](docs/oss-community-release.md). Pull requests do not need a deploy.

## Pull requests

- One logical change per PR, with tests for new behavior.
- Describe what changes for users and what reviewers should check.
- Do not use models with `fast` in the id for the default LLM config.
