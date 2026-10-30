# Spec: Routine trust polish

**Status:** Implemented (2026-10-29)  
**Status:** implemented (2026-10-29)  
**Roadmap:** closed — Phase 4 finish; see [roadmap-next.md](../roadmap-next.md)  
**Scope:** UI + shared helpers + Job stub docs. No Genie, no auto-deploy Jobs.

## Problem

Cron expressions and webhook wiring are opaque. Operators must manually create Lakeflow Jobs; the App returns a one-time webhook secret but the UI did not explain schedule, URL, or headers clearly. Manual **Run now** should read as **Test** (Grok-shaped).

## Goals

1. Human-readable schedule next to stored cron (EN + `pt*` browser locale).
2. Webhook path template `POST /api/webhooks/routines/:routineId` with copy-friendly URL and auth header names from server code.
3. After create, keep one-time secret banner with copy fields (secret, URL, header line, Bearer line).
4. Rename primary run action to **Test** (still `POST /api/routines/:id/run`).
5. Improve `resources/jobs/routine-webhook.job.yml.stub` with placeholder App URL and header name.

## Non-goals

- Auto-create Databricks Jobs from the App.
- Run history UI, cron editor, secret rotation.
- Changes to `App.tsx`, `BotDetailsSheet`, agent loop, presence, choice tools, pin-artifact, Genie.

## Implementation

| Area | Change |
| --- | --- |
| `shared/routines/types.ts` | `describeCronExpression`, `routineWebhookPath`, `ROUTINE_WEBHOOK_*` constants |
| `server/routines/trust-display.ts` | Re-exports for tests / ops |
| `server/routines/webhook-auth.ts` | `WEBHOOK_HEADER` sourced from shared constant |
| `client/.../RoutinesPanel.tsx` | Schedule copy, webhook copy UI, Test label, post-create trust banner |
| `resources/jobs/routine-webhook.job.yml.stub` | Example App URL + curl comments |
| `README.md` | Pointer to stub + header names |

## Auth (unchanged behavior)

- `POST /api/webhooks/routines/:routineId`
- Secret via header `x-bricksbot-webhook-key` or `Authorization: Bearer <secret>`
- Plaintext secret only in `CreateRoutineResult.webhookSecret` (once)

## Cron humanization (v1)

Five-field cron only. Supported patterns:

- `m h * * *` → daily at `h:m`
- `m h * * dow` → weekly on weekday `dow` (0 = Sunday)

Unknown shapes fall back to the raw cron string.

## Verification

- `npm test` — includes `server/routines/trust-display.test.ts`
- Manual: create routine → copy banner → **Test** run → toggle enabled → webhook with saved secret (see `routes.test.ts`)
