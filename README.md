# BricksBot

Greenfield Databricks App (AppKit, TypeScript, React) for a Grok Bot–style roster and transcript. This tree is not a Rakazo fork. There is no computer or sandbox runtime in the MVP.

Product locks and build order live in [docs/project-context.md](docs/project-context.md) and [docs/databricks-grokbot-marketplace-plan.md](docs/databricks-grokbot-marketplace-plan.md).

## Prerequisites

- Node.js 22+ and npm
- [Databricks CLI](https://docs.databricks.com/aws/en/dev-tools/cli/install) 1.0.0 or newer

Auth uses the existing `dev` profile on this machine (`~/.databrickscfg`). Confirm it:

```bash
databricks -v
databricks current-user me -p dev
```

## Local development

```bash
npm ci
npm run dev
```

The dev server prints its URL (default port 8000). Copy `.env.example` to `.env` if you need to override the profile or port. `.env` is gitignored.

## Deploy

The bundle target `dev` is the default. It deploys the App named `bricksbot` to the workspace on the `dev` profile. Lakebase is not bound yet.

```bash
databricks bundle validate -p dev
databricks bundle deploy -p dev
databricks bundle run app -p dev
```

`bundle run app` starts the app resource declared in `databricks.yml`. Equivalent one-shot deploy-and-start:

```bash
databricks apps deploy -p dev
```

After a deploy, status and logs:

```bash
databricks apps get bricksbot -p dev
databricks apps logs bricksbot -p dev
```

Stopped apps can be started again without a redeploy:

```bash
databricks apps start bricksbot -p dev
```

## Lakebase

Bots, chats, memories, and spaces will live in Lakebase Autoscaling. Phase 0 only stubs the resource so a project is not created or billed yet.

The shape to paste later is [resources/lakebase.postgres.yml.stub](resources/lakebase.postgres.yml.stub). `app.yaml` has the matching `LAKEBASE_ENDPOINT` env block commented out. Do not guess project, branch, or database ids — list them with `databricks postgres list-projects -p dev` or create a project explicitly before wiring the stub.

## What this skeleton is

AppKit `server` plugin only: Express plus a React shell. Model Serving, SQL warehouse, Genie, and the `lakebase()` plugin stay off until a later phase binds real resources.
