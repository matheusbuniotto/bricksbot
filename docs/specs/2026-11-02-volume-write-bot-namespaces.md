# Spec: `volume_write`, per-user quotas, per-bot Volume namespaces

**Status:** plan (not implemented)  
**Date:** 2026-11-02  
**Roadmap:** [roadmap-next.md](../roadmap-next.md) P1 #2  
**Depends on:** [2026-10-29-pin-artifact.md](2026-10-29-pin-artifact.md), [2026-10-30-phase5-sandbox-execution.md](2026-10-30-phase5-sandbox-execution.md)  
**Decision lock:** Prefer UC Volumes over Workspace Files write ([investigation 2026-11-02](../roadmap-next.md)). Workspace `/Workspace/...` writers stay out of scope.

## Problem

Bots can pin short findings and sandbox code can upload to `/Volumes/...`, but there is no general Ask-first write tool for chat-authored files. Sandbox uploads use `{root}/{chatId}/{file}`, which does not isolate by user or bot. Unity Catalog has no native per-user byte quota on Volumes, so unbounded writes would rely on hope.

## Goals

1. **`volume_write`** Ask-first tool: write bytes (text or small binary) under a governed Volume path.
2. **Per-user namespace** under a BricksBot Volume root so OBO grants and quotas stay accountable.
3. **Per-bot folder** inside that user namespace so Library and cleanup stay bot-scoped.
4. **App-enforced quotas** (per write + per user total). Databricks does not provide this natively.
5. **Align sandbox saves** with the same layout so one mental model covers chat writes and sandbox egress.

## Non-goals

- Workspace Files (`/Workspace/...`), DBFS, or My Files as the primary write target.
- Browsing or opening Volume objects inside Library (titles + path tooltip stay v1).
- Native UC storage quotas or cloud-account billing caps.
- Cross-user shared folders inside BricksBot (use UC grants on a shared volume path later if needed).
- Auto-creating UC Volume resources in the DAB (operator provisions volume + grants; we document the path).

## Path layout

Configurable root (env / `app.yaml`):

```text
BRICKSBOT_VOLUME_ROOT=/Volumes/<catalog>/<schema>/<volume>/bricksbot
```

Canonical object path:

```text
{BRICKSBOT_VOLUME_ROOT}/users/{userId}/bots/{botId}/{relativePath}
```

| Segment | Source | Notes |
| --- | --- | --- |
| `userId` | `resolveOwnerId(req)` (email when Apps proxy sends it) | Sanitize for path: lowercase, replace unsafe chars with `_` |
| `botId` | Active bot UUID | Stable across renames |
| `relativePath` | Tool arg | No `..`, no absolute `/Volumes`, no empty; basename required |

Examples:

```text
/Volumes/main/default/bricksbot_artifacts/bricksbot/users/alice@co.com/bots/3f2a…/reports/q3.md
/Volumes/main/default/bricksbot_artifacts/bricksbot/users/alice@co.com/bots/3f2a…/charts/spend.json
```

**Sandbox alignment.** Change `resolveArtifactVolumePath` default from `{root}/{chatId}/{file}` to:

```text
{BRICKSBOT_VOLUME_ROOT}/users/{userId}/bots/{botId}/sandbox/{chatId}/{file}
```

Keep explicit `volume_path` on `sandbox_save_artifact` for power users, but still require `/Volumes/` + `validateVolumePath`. Prefer documenting the namespaced default.

**Alias.** `SANDBOX_ARTIFACT_VOLUME_PATH` may remain as a legacy alias for `BRICKSBOT_VOLUME_ROOT` for one release, then deprecate in docs.

## Quotas (app-enforced)

UC Volumes do not expose per-user byte quotas. BricksBot owns the meter.

| Limit | Env / default | Behavior |
| --- | --- | --- |
| Max bytes per write | `BRICKSBOT_VOLUME_WRITE_MAX_BYTES` (default **8 MiB**) | Preflight / execute reject before PUT |
| Max bytes per user (under root) | `BRICKSBOT_VOLUME_USER_QUOTA_BYTES` (default **256 MiB**) | Reject when `used + new > quota` |
| Optional max bytes per bot | `BRICKSBOT_VOLUME_BOT_QUOTA_BYTES` (default **unset** = no bot cap) | Same check under `.../bots/{botId}/` |

**Accounting store (Lakebase).** Table `bricksbot.volume_usage`:

| Column | Type | Notes |
| --- | --- | --- |
| `user_id` | text | PK part |
| `bot_id` | text | PK part; use `*` rollup row optional or sum in query |
| `bytes_used` | bigint | Soft counter |
| `updated_at` | timestamptz | |

On successful PUT: increment by written size (overwrite of same path: increment by `max(0, new - old)` if old size known, else treat overwrite as full new size for v1 simplicity and accept slight over-count).

On failed pin after PUT: bytes stay on Volume; counter still increments (same race as today's sandbox save).

**Recompute.** Optional admin/tool later: list directory under user prefix and refresh counter. Not required for v1 if we only write through BricksBot tools.

**Bypass.** Anyone with UC write outside BricksBot can fill the volume without updating the counter. Mitigate with UC grants limited to the BricksBot path where possible, and document that quotas are app policy.

## Tool: `volume_write`

**Registration.** All bots when `BRICKSBOT_VOLUME_ROOT` is set (or always registered but execute fails clearly if unset). Mirror sandbox: prefer register only when root configured so capability catalog stays honest.

**Ask-first.** Never auto on handoff (`autoApproveAll` does not bypass). Allow "Always allow" for the chat (same as `volume_read`), unless we later harden like `sandbox_delete`.

**Args:**

| Arg | Required | Meaning |
| --- | --- | --- |
| `relative_path` | yes | Path under the bot folder (e.g. `notes/summary.md`) |
| `content` | yes* | UTF-8 text body |
| `content_base64` | yes* | Alternative for small binary (*exactly one of content / content_base64) |
| `overwrite` | no | Default `true` to match current PUT; set `false` to fail if exists (v1.1 if Files API supports HEAD cheaply) |
| `pin` | no | Default `true`: after write, `pin_artifact` kind `volume_path` |

**Resolved path** is never taken as a free `/Volumes/...` string from the model in v1. That keeps namespaces and quotas enforceable. Power-user absolute path can be a later flag behind install config.

**Execute flow:**

1. Resolve `userId`, `botId`, sanitize, build absolute path.
2. Validate size ≤ per-write max.
3. Load usage; reject if over user (and bot) quota.
4. PUT via shared helper extracted from `ArtifactSyncService.writeToVolume`.
5. Update `volume_usage`.
6. Optional pin with full path as body.
7. Return `{ ok, path, bytes, pinnedMessageId? }`.

**Approval card.** Show bot name, relative path, resolved absolute path, byte size, and remaining quota if known.

## Auth

Interactive: user OBO token (same as `volume_read` / sandbox upload today).  
Routines: PAT or app SP. Document that routine writes count against the identity's path only if we namespace by that principal; **v1: disallow `volume_write` on routine turns** (or write under `users/{routinePrincipal}/bots/{botId}/`) to avoid surprising SP fills. Prefer **disallow on routines** until explicit design.

UC: operator grants the signed-in users (and optionally the App SP) write on the Volume. Bundle still does not create the Volume.

## Library / Biblioteca

- Pins continue to store the absolute Volume path.
- Optional later: Library group by bot folder; "Open in Catalog Explorer" deep link.
- Empty copy can mention "files this bot wrote under your Volume folder".

## Capability prompt / seed

- Catalog line: prefer `volume_write` for durable files; `pin_artifact` for short findings; sandbox_save for sandbox outputs (same tree).
- Extend `pin-finding` or add `volume-write` seed: when to write vs pin; never write secrets; stay under bot folder.

## Install / ops checklist

1. Create UC Volume (or reuse).
2. Set `BRICKSBOT_VOLUME_ROOT=/Volumes/.../bricksbot` (and migrate sandbox env).
3. Grant users WRITE on that volume (or a managed location they already use).
4. Optional: tune quota env vars.
5. Redeploy App.

## Implementation slices

| Slice | Deliverable | Verify |
| --- | --- | --- |
| A | Path helpers: sanitize userId, build bot namespace, tests | unit |
| B | Extract `writeToVolume` + optional HEAD/size helper; sandbox default path uses new layout | unit + existing sandbox tests updated |
| C | Lakebase `volume_usage` + memory store mirror; quota checks | unit |
| D | `volume_write` tool + ChatService registration + Ask-first + approval labels | unit + approval card |
| E | Docs: README, roadmap, capability / seed | review |
| F | (Optional) Library hint + remaining quota on setup status | UI smoke |

## Acceptance

- [ ] Model cannot write outside `{root}/users/{userId}/bots/{botId}/`
- [ ] Over-quota and over-size writes fail before PUT with clear tool errors
- [ ] Successful write can pin `volume_path`; Library lists the pin
- [ ] Sandbox default save lands under `.../bots/{botId}/sandbox/{chatId}/`
- [ ] Handoff does not auto-approve `volume_write`
- [ ] `npm test` green; no Workspace Files writer

## Open product calls (defaults chosen)

| Call | Default in this plan | Operator can override by |
| --- | --- | --- |
| Destination | UC Volume only | N/A (Workspace deferred) |
| Path freedom | Relative under bot folder only | Future install flag |
| Per-write max | 8 MiB | env |
| Per-user quota | 256 MiB | env |
| Per-bot quota | off | env |
| Pin after write | yes | tool arg |
| Routines | no `volume_write` | later design |
| Overwrite | allow | tool arg later |

## Related

- Platform Biblioteca posture: [databricks-platform-integration-plan.md](../databricks-platform-integration-plan.md)
- Agent track C: [agent-improvement-plan.md](../agent-improvement-plan.md)
