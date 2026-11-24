# Spec: Phase 5: Sandbox Execution Module (agents' VM)

**Status:** Implemented (Phases 5.0 to 5.6); D1, D2 and the no-Daytona decision accepted 2026-10-30. Off in code when `SANDBOX_BACKEND` is unset; the shipped `app.yaml` now sets `databricks` (falls back to `python_exec`). Set `off` to disable. Also supports `python_exec` backend / Databricks→python_exec fallback with truthful session labeling.
**Origin:** Matheus's Sandbox Execution Module TDD (Python), adapted to BricksBot (TypeScript, Lakebase, AppKit).
**Supersedes:** the "Daytona default, E2B Desktop alt" lock in [project-context.md](../project-context.md) for the *execution* sandbox. A desktop/"computer" UI is still out of scope.

## 1. Intent

Let a Bot run generated code, shell commands and file operations in an isolated, ephemeral Linux sandbox. The sandbox is a replaceable compute resource. Chats, approvals, artifacts and audit state stay in Lakebase and UC Volumes.

## 2. Decisions needed before build

| # | Decision | Recommendation |
|---|----------|----------------|
| D1 | Reopen the Phase 5 lock (Daytona first)? | **Accepted.** Databricks Sandbox first, then E2B; no Daytona for now: Databricks Sandbox first, no new infrastructure. |
| D2 | Accept a Public Beta backend in the OSS release? | **Accepted**, only behind a flag that is off by default, with the beta caveats in the README. |
| D3 | Is E2B Embed (self-hosted) in scope? | No. Treat it as a power-user doc at most. A Databricks App cannot host a KVM VM. |
| D4 | Automatic backend routing? | No. Select the backend via config or per-Bot setting. |

## 3. Verified facts and open verification

- Databricks Sandbox: Public Beta, workspace admin opt-in on the Previews page, regional availability only. Fixed 4 vCPU / 8 GB RAM, persistent `/home/sandbox-agent` (up to 100 GB). Commands run without a shell, so use `/bin/bash -c`. Free during the beta. At GA, compute and storage billing is expected, and the storage purge risk applies.
- REST endpoints (`api/2.0/sandboxes` and `api/2.0/sandbox-exec`):
  - `POST /api/2.0/sandboxes?sandbox_id={id}` with JSON body `{ "spec": { "compute": { "inactivity_timeout": "900s" } } }` → returns `{ "name": "sandboxes/{id}", ... }`.
  - `POST /api/2.0/sandbox-exec/sandboxes/{id}/exec-sync` with JSON body `{ "cmd": "/bin/bash", "args": ["-c", script], "envs": {...}, "execution_timeout": "120s" }` → returns `{ "stdout", "stderr", "exit_code", "status" }`.
  - `POST /api/2.0/sandboxes/{id}/stop` and `DELETE /api/2.0/sandboxes/{id}`.
- `@databricks/sdk-experimental` 0.17.0 (installed) has **no** sandbox API. Use the REST API directly with the app's service-principal / workspace bearer auth.
- Service-principal permissions & identity: the sandbox receives a short-lived delegated OAuth profile (`~/.databrickscfg`) mapped to the invoking service principal, scoped to UC resources granted to the App SP. Never inject user tokens or LLM API keys.
- Egress: standard Databricks Sandboxes have unrestricted egress by default in Beta; workspace/account-level Serverless Egress Control policies govern outbound traffic where configured.
- File transfer: there is no dedicated file upload/download endpoint under `/api/2.0/sandbox-exec`; transfer files via base64 over `exec-sync` (and sync artifacts out to UC Volumes via `/Volumes/...` mount or `/api/2.0/fs/files`).
- E2B: Cloud REST API (`POST /sandboxes` with `X-API-Key` header) or injectable driver. Embed needs `/dev/kvm` and is out of scope.

**Verification checklist (Phase 5.0):**

- [x] Read the sandbox REST reference (endpoints, auth scopes, error codes, limits, region list).
- [x] Confirm the service-principal permissions needed to call the API from a Databricks App.
- [x] Confirm the egress behaviour of sandboxes (can an allowlist be enforced?).
- [x] Confirm how file upload and download work (API or `cat`/base64 through the exec endpoint).

## 4. Requirements (EARS)

| ID | Requirement |
|----|-------------|
| SB-1 | When a Bot calls `sandbox_exec`, the system shall run the command in the Bot-chat's sandbox and return stdout, stderr, exit code and duration. |
| SB-2 | The system shall create a sandbox lazily on the first call in a chat and reuse it until stopped or idle. |
| SB-3 | Where the sandbox flag is off, no sandbox tool shall be registered or listed in the capability catalog. |
| SB-4 | When a sandbox tool call is pending, the system shall require Ask-first approval. `sandbox_delete` shall never offer "Always allow". |
| SB-5 | While a sandbox has been idle for 15 minutes, a reaper shall stop and delete it. |
| SB-6 | When a Bot files an artifact from the sandbox, the system shall copy it to a UC Volume and pin it via the existing `pin_artifact` flow before any teardown. |
| SB-7 | If the sandbox fails or times out, then the tool shall return a clear error to the Bot and the chat turn shall continue. |
| SB-8 | The system shall record sandbox lifecycle events and command previews in Lakebase, with truncated output and secrets redacted. |
| SB-9 | The system shall never put long-lived credentials or user tokens into a sandbox. |
| SB-10 | Where an LLM tool-call replay occurs, sandbox tool rows shall keep matching `toolCallId` per the existing replay rules. |

## 5. Design

### 5.1 Layout

```text
shared/sandbox/types.ts          ExecutionResult, SandboxSession, SandboxEvent, BackendId
server/sandbox/
  backend.ts                     ExecutionBackend interface
  registry.ts                    flag/config → backend
  databricks-backend.ts          REST client
  e2b-backend.ts                 (phase 2 backend, optional)
  session-service.ts             create/reuse/stop/delete, idle tracking
  artifact-sync.ts               sandbox file → UC Volume → pin_artifact
  reaper.ts                      idle cleanup
  store.ts / memory-store.ts     Lakebase + test store
server/agents/tools/sandbox-*.ts tool definitions
```

### 5.2 Interface (TypeScript port of the TDD)

```ts
interface ExecutionBackend {
  createSession(sessionId: string): Promise<string>;           // external id
  runCommand(ext: string, cmd: string[], opts: { cwd?: string; timeoutSec: number; env?: Record<string,string> }): Promise<ExecutionResult>;
  uploadFile(ext: string, data: Uint8Array | string, dest: string): Promise<string>;
  downloadFile(ext: string, src: string): Promise<Uint8Array>;
  stopSession(ext: string): Promise<void>;
  deleteSession(ext: string): Promise<void>;
}
```

### 5.3 Tools

| Tool | Approval |
|------|----------|
| `sandbox_exec` | Ask-first (Always allow permitted per chat) |
| `sandbox_upload` / `sandbox_download` | Ask-first |
| `sandbox_save_artifact` | Ask-first; wraps `pin_artifact` |
| `sandbox_stop` | auto-run |
| `sandbox_delete` | Ask-first, never "Always allow" |

Register in the `ChatService` constructor so `buildCapabilityCatalog` lists them. Do not add them to `DEFAULT_META_TOOL_NAMES`. Whether they are Primary-only is open (default: all Bots, once enabled for the Space).

### 5.4 Data (Lakebase schema `bricksbot`)

- `sandbox_sessions(id, chat_id, bot_id, user_id, backend, external_id, status, created_at, last_used_at, stopped_at, metadata jsonb)`
- `sandbox_events(id, session_id, type, payload jsonb, created_at)`, command previews truncated (for example 2 KB), full output only if written to a Volume.

Add the DDL to the existing schema module and a memory-store equivalent.

### 5.5 Config

| Var | Meaning |
|-----|---------|
| `SANDBOX_BACKEND` | `off` (default) \| `databricks` \| `python_exec` \| `e2b` |
| `SANDBOX_IDLE_MINUTES` | default 15 |
| `SANDBOX_EXEC_TIMEOUT_SEC` | default 120 |
| `SANDBOX_MAX_SESSION_MINUTES` | default 120 (hard age cap + reaper) |
| `SANDBOX_MAX_ACTIVE_PER_USER` | default 3 |
| `SANDBOX_ARTIFACT_VOLUME_PATH` | optional default UC Volume root for artifacts |
| `E2B_API_KEY` / `E2B_DOMAIN` | secrets (scope `bricksbot`), e2b only |
| `SANDBOX_EGRESS_ALLOWLIST` | reserved; **not enforced in-app**, use workspace Serverless Egress Control / E2B account policy |

### 5.6 Security

- The Databricks backend uses the App service principal. Do not pass user tokens into the sandbox. Give scoped, short-lived data access only if a later spec adds it.
- Redact secrets in logs and event payloads. Use sandbox ids `bricksbot-{chatId}`.
- Never expose raw sandbox paths in the UI. Show artifact names only.
- E2B Cloud: allowlist egress at the account level. Self-hosted Embed, if ever documented, stays on a private subnet.

## 6. Phases

| Phase | Work | Exit check |
|-------|------|------------|
| 5.0 | Verify the open items in §3. Update this spec. | Open items checked off |
| 5.1 | Types, interface, registry, stores, flag off by default | Unit tests (registry, store, redaction) |
| 5.2 | Databricks backend + `sandbox_exec` + approvals + capability catalog | Integration test: `echo hello`, write/read file, delete (skipped without workspace) |
| 5.3 | Artifact sync to UC Volume + `pin_artifact` | E2E: "analyze and return a CSV" |
| 5.4 | Reaper + cost caps (max sandboxes per user, max runtime) | Idle sandbox cleaned in test |
| 5.5 | UI: update Bot details "Computer asleep" panel to show sandbox state | Presence reflects `working` while a command runs |
| 5.6 | E2B Cloud backend (optional, flag) | Same contract tests as Databricks backend |

## 7. Tests

- Unit: registry rejects unknown or disabled backends; result normalization; redaction; idle logic (fake clock); store parity (memory vs Lakebase shape).
- Service: sandbox tool call → pending approval → run → tool row has matching `toolCallId`; failure returns an error result and the turn continues.
- Integration (opt-in via env): the Databricks scenario in §6, 5.2.
- Contract test suite run against every backend.

## 8. Out of scope

Desktop/browser "computer" UI, Playwright in the App, E2B Embed hosting, automatic routing, `run_skill_script`, mounting user tokens in sandboxes, Genie.

## 9. Risks

| Risk | Mitigation |
|------|------------|
| Beta API changes, a regional gap, or a storage purge | Flag off by default; artifacts always synced out; README caveat |
| Billing at GA | Idle reaper, per-user caps, delete after one-shot tasks |
| Prompt-injected commands | Ask-first approvals, no credentials in the sandbox, egress limits |
| Orphaned sandboxes after an app restart | Reaper reconciles `sandbox_sessions` against the backend at startup |
