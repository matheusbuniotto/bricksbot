# ADR 0001: Plugin and extension contract layer

- **Status:** Proposed
- **Date:** 2026-11-07
- **Deciders:** Engineering team
- **Consulted:** Pi coding agent extension model, Databricks App runtime guidelines
- **Technical design document:** [docs/specs/2026-11-07-plugin-extension-system.md](../specs/2026-11-07-plugin-extension-system.md)

## Context

BricksBot currently hard-codes all agent tools inside `server/chat/service.ts`. The `ChatService` constructor instantiates SQL query, catalog, volume, handoff, routine, memory, and sandbox tools directly.

This design presents several operational drawbacks:

1. Adding custom enterprise tools requires modifying monorepo source files.
2. Teams must rebuild and redeploy the Databricks App bundle (`databricks bundle deploy`) to introduce new capabilities.
3. Workspace operators cannot install domain-specific connectors (such as ERP APIs, internal BI endpoints, or custom compliance guardrails) without maintaining a fork of the codebase.
4. Prompt additions and tool lifecycle policies lack a shared abstraction.

Pi coding agent (`@earendil-works/pi-coding-agent`) demonstrates a decoupled alternative. Pi exposes an `ExtensionAPI` contract. External packages and standalone scripts export factory functions that register tools, lifecycle hooks, and prompt sections. Pi discovers and loads those extensions at startup from configured directories, npm packages, or git checkouts without touching the core codebase.

## Decision

We will introduce a first-class plugin and extension abstraction layer for BricksBot. We will support loading plugins dynamically from outside the monorepo.

### 1. Pure TypeScript contract (`shared/plugins/types.ts`)

We will define domain types in `shared/plugins/types.ts` without dependencies on Express or Lakebase internals:

- `BricksbotPlugin`: A named manifest containing tools, prompt sections, and lifecycle hooks.
- `PluginToolDefinition`: A tool specification containing name, description, JSON schema parameters, approval requirements, and an `execute` handler.
- `PluginPromptSection`: A dynamic prompt contributor evaluated during turn construction.
- `PluginHooks`: Lifecycle interceptors (`beforeTurn`, `afterTurn`, `beforeTool`, `afterTool`).
- `BricksbotPluginAPI`: The registration API passed to plugin factory functions.

### 2. Runtime host (`server/plugins/plugin-host.ts`)

We will implement `PluginHost` inside `server/plugins/`. The host will:

1. Maintain an internal registry of loaded plugins.
2. Validate incoming tool definitions and parameter schemas at the system boundary.
3. Provide tools to `ChatService` alongside built-in capabilities.
4. Execute lifecycle hooks during turn execution and tool invocation.
5. Apply Ask-first approvals by default to all plugin tools unless a tool explicitly declares itself read-only.

### 3. Dynamic loading vectors without monorepo edits

We will support three dynamic loader sources:

1. **Unity Catalog Volume loader:** The host scans a configured UC Volume path (for example, `/Volumes/catalog/schema/bricksbot_plugins/`). Operators drop standalone JavaScript or bundled ECMAScript modules (`.mjs`) into the Volume. The host dynamically imports these modules at runtime without rebuilding the application bundle.
2. **Lakebase configuration registry:** A new table `bricksbot.plugins` will track plugin metadata, activation status per Space or Bot, and environment parameters.
3. **Pre-installed package loader:** The `BRICKSBOT_PLUGINS` environment variable will accept comma-separated package names for pre-bundled npm packages.

### 4. Built-in tools as first-class plugins

Over time, we will refactor existing lakehouse, memory, and routine tools into built-in plugins. They will use the exact same contract that external plugins use.

## Consequences

### Positive

- Operators can add custom tools by uploading files to a Unity Catalog Volume. No code changes or redeployments are necessary.
- Core agent orchestration stays decoupled from individual tool implementations.
- Third-party plugins follow a standardized lifecycle for prompt contribution, argument validation, and result redaction.
- The approval system treats plugin tools securely by defaulting to Ask-first confirmation.

### Negative and tradeoffs

- The Databricks App container filesystem is read-only at runtime. External plugins in UC Volumes cannot run `npm install`. They must be self-contained bundles or depend only on libraries exported by BricksBot.
- In-process plugin execution shares memory with the Node.js server. Untrusted third-party code requires careful governance over who has write permissions to the plugin Volume.
- Untrusted user scripts that require process isolation must continue to route through the Phase 5 execution sandbox rather than in-process plugins.
