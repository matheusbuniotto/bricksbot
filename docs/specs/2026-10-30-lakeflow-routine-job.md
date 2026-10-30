# Spec: Parameterized Lakeflow Job → routine webhook

**Status:** Implemented (2026-10-30)  
**Roadmap:** [roadmap-next.md](../roadmap-next.md) P1 #2 (in flight)  
**Depends on:** [2026-10-29-routine-trust.md](2026-10-29-routine-trust.md) (shipped)  
**Scope:** DAB variables + wired Job resource + ping script + docs/UI hints. No App-side Job CRUD, no Genie, no cron enforcement on the server.

## Problem

Phase 4 shipped routines, webhook auth, and trust UI, but **scheduled** runs still require operators to hand-build a Lakeflow Job from comments in `routine-webhook.job.yml.stub`. The stub is intentionally **not** in `databricks.yml` because the App public URL and per-routine webhook secret are install-time values.

Without a parameterized bundle path, the Databricks-native demo ("bot on a schedule via Job → webhook") stays manual and error-prone (wrong URL, missing secret scope, cron mismatch with the routine row).

## Goals

1. **One PR-sized slice** that lets `databricks bundle deploy` create (or update) a **single example Job** which POSTs to `POST /api/webhooks/routines/:routineId` on a Quartz schedule.
2. **Bundle variables** for App base URL, routine id, secret scope/key, never commit secret values.
3. **`scripts/ping_routine_webhook.py`** used by the Job task; reads URL/id from Job parameters and secret from Databricks secret scope at runtime.
4. **Operator docs** (README + stub comments) with ordered steps: create routine → `put-secret` → set target variables → deploy → verify **Test** vs Job path.
5. **Optional (same PR if small):** human-readable **Quartz schedule hint** next to routine cron in UI; optional `appPublicUrl` on `GET /api/setup/status` when an env var is set.

## Non-goals

- Auto-create or sync Jobs from the App API when a routine is created/updated.
- Secret rotation UI, run history, or server-side validation that Job cron matches `routine.cron`.
- Replacing Unix 5-field cron in Lakebase with Quartz (routine `cron` stays opaque metadata + UI copy).
- Genie, computer, PartnerOps, or multi-routine Job templates (one Job ↔ one routine id for v1).
- Requiring the Job for local dev (`npm run dev`); webhook tests stay in vitest + **Test** button.

## Current behavior (unchanged)

| Path | Auth | `enabled` | Prompt source |
| --- | --- | --- | --- |
| `POST /api/routines/:id/run` (**Test**) | Session / App user | Ignored (runs when disabled) | `routine.prompt` |
| `POST /api/webhooks/routines/:routineId` | `x-bricksbot-webhook-key` or `Authorization: Bearer` | **Must be enabled** | `routine.prompt` |

Webhook header constant: `ROUTINE_WEBHOOK_HEADER` → `x-bricksbot-webhook-key` (`shared/routines/types.ts`, `server/routines/webhook-auth.ts`).

Plaintext `webhookSecret` only in `CreateRoutineResult` at create time; stored hash in Lakebase.

## Design

### 1. Bundle variables (`databricks.yml`)

Add variables (names stable for docs/UI references):

| Variable | Purpose | Default |
| --- | --- | --- |
| `routine_webhook_app_base_url` | App origin, **no trailing slash** (e.g. `https://bricksbot-….databricksapps.com`) | `""` (document: must set before Job deploy) |
| `routine_webhook_routine_id` | UUID from Routines trust banner / list row | `""` |
| `routine_webhook_secret_scope` | Scope holding the webhook shared secret | `${var.app_secret_scope}` → `bricksbot` |
| `routine_webhook_secret_key` | Secret key name (value is operator-supplied) | `routine-webhook-key` |
| `routine_webhook_quartz_cron` | Job schedule (Quartz, 6-field) | `0 0 9 * * ?` |
| `routine_webhook_timezone_id` | Job schedule timezone | `America/Sao_Paulo` |

**Target overrides:** Document a gitignored `*.databricks.env` or `dev.local.yml` pattern for `routine_webhook_app_base_url` + `routine_webhook_routine_id` so clones do not commit workspace-specific ids. Dev target may ship **example** values only in README, not in committed YAML.

**Discover App URL:** `databricks apps get bricksbot -p dev` → use `url` field as `routine_webhook_app_base_url`.

### 2. Secret scope (operator, not committed)

After creating a routine and copying the one-time secret from the trust banner:

```bash
databricks secrets put-secret bricksbot routine-webhook-key --string-value '<paste webhookSecret>' -p dev
```

- Scope/key names must match bundle variables (defaults above).
- Job task needs **READ** on that secret (cluster/job identity or user running the task, document UC/identity expectations for the dev workspace).
- Never log the secret in Job output; script should only print HTTP status / routine id on success.

Optional second routine later: use a **different** secret key name and a second Job resource, out of scope for v1 single example.

### 3. Job resource shape

Promote stub → **`resources/jobs/routine-webhook.job.yml`** (drop `.stub` or keep stub as pointer to the real file, prefer one canonical YAML).

Wire under `resources.jobs` in `databricks.yml`, e.g. job key `bricksbot_routine_webhook`:

```yaml
# Illustrative — implementer fills DAB-correct fields
resources:
  jobs:
    bricksbot_routine_webhook:
      name: "[${bundle.target}] bricksbot routine webhook"
      schedule:
        quartz_cron_expression: ${var.routine_webhook_quartz_cron}
        timezone_id: ${var.routine_webhook_timezone_id}
      tasks:
        - task_key: ping_routine
          spark_python_task:
            python_file: ../../scripts/ping_routine_webhook.py
            parameters:
              - ${var.routine_webhook_app_base_url}
              - ${var.routine_webhook_routine_id}
              - ${var.routine_webhook_secret_scope}
              - ${var.routine_webhook_secret_key}
```

**Task type choice:** `spark_python_task` with repo-relative `python_file` matches the existing stub comment and keeps the task self-contained. If DAB path resolution requires a workspace path, use the bundle's documented `source_code_path` / artifact pattern, align with how the App resource already deploys `./`.

**Job permissions:** Document that the Job run-as identity must reach the App URL (HTTPS egress) and read the secret scope. No App resource binding is required for the HTTP call.

**Deploy guard:** If `routine_webhook_app_base_url` or `routine_webhook_routine_id` is empty, either skip Job sync (document manual `bundle deploy` without jobs, only if DAB supports) or accept deploy with a Job that fails fast in the script with a clear error. Prefer **fail fast in script** + README checklist over silent skip (simpler one PR).

### 4. Ping script (`scripts/ping_routine_webhook.py`)

CLI contract (positional args from Job parameters):

1. `app_base_url`
2. `routine_id`
3. `secret_scope`
4. `secret_key`

Behavior:

- `secret = dbutils.secrets.get(scope, key)` when `dbutils` is available; for local dry-run, allow env overrides documented in README only (optional `--dry-run` or `if __name__` guard, keep minimal).
- `POST {app_base_url}/api/webhooks/routines/{routine_id}` with header `x-bricksbot-webhook-key: {secret}`, body `{}` or empty JSON.
- Treat HTTP 201 as success; raise or non-zero exit on 401/403/404/5xx with response body snippet (no secret in logs).

Add a **unit test** only if logic is extracted (e.g. URL builder in TS already exists); Python can stay integration-tested via manual Job run + documented curl equivalent.

### 5. Cron: `routine.cron` vs Job schedule

- **App** stores **Unix 5-field** cron (`0 9 * * *`) for display and future use; **does not** trigger runs.
- **Job** uses **Quartz 6-field** (`0 0 9 * * ?`) on the workspace scheduler.

Operators must keep them aligned manually for v1.

**Conversion hint (common cases):**

| Routine cron (Unix) | Quartz `quartz_cron_expression` |
| --- | --- |
| `m h * * *` (daily) | `0 m h * * ?` |
| `m h * * dow` (weekly) | `0 m h ? * DOW` with `DOW` = `SUN`…`SAT` (Quartz) from Unix 0=Sunday |

**Optional implementation:** `unixCronToQuartzHint(cron: string): string | null` in `shared/routines/types.ts` + test for the two supported patterns in `describeCronExpression`; show in trust banner and routine list as "Job schedule (Quartz): …" when non-null.

Set `routine_webhook_quartz_cron` default to match the README example (`0 0 9 * * ?` ↔ routine default `0 9 * * *`).

### 6. UI / setup status (optional, same PR)

**RoutinesPanel** (post-create trust banner only, no new secrets):

- Short paragraph: store secret in scope `bricksbot` / key `routine-webhook-key`, set bundle variables, `bundle deploy`.
- Link text to README anchor `#wiring-a-scheduled-job`.
- If `unixCronToQuartzHint` exists, show Quartz hint under cron fields.

**Setup status** (`buildSetupStatus`):

- Optional `appPublicUrl: string | null` from env `BRICKSBOT_PUBLIC_APP_URL` (document in `app.yaml` comments, **not** auto-discovered from Databricks).
- Optional `routineWebhookSecretPutExample: string[]` mirroring LLM examples (scope/key from env or defaults `bricksbot` / `routine-webhook-key`), never including a real secret.

Install wizard consumer can ignore new fields until wired.

### 7. Docs

| Doc | Change |
| --- | --- |
| `README.md` | Replace "manual only" with variable table + ordered checklist; keep curl/CLI alternatives |
| `resources/jobs/routine-webhook.job.yml` | Header comment mirroring README |
| `docs/oss-community-release.md` | P1 row → link this spec while in flight; P0 §2 still "promote stub" until shipped |
| `.env.example` | Optional `BRICKSBOT_PUBLIC_APP_URL=` comment |

## File touch list (implementation PR)

| File | Action |
| --- | --- |
| `databricks.yml` | Add variables + `resources.jobs.bricksbot_routine_webhook` |
| `resources/jobs/routine-webhook.job.yml` | Promote from `.stub`; delete or redirect stub |
| `scripts/ping_routine_webhook.py` | New |
| `README.md` | Parameterized Job section |
| `shared/routines/types.ts` | Optional `unixCronToQuartzHint` |
| `server/routines/setup-status.ts` | Optional `appPublicUrl`, put-secret examples |
| `client/src/components/RoutinesPanel.tsx` | Optional trust banner Job copy |
| `server/routines/setup-status.test.ts` | Optional new fields |
| `shared/routines/*.test.ts` or `trust-display.test.ts` | Optional Quartz hint tests |

No changes to webhook auth semantics, `RoutineService.runFromWebhook`, or Lakebase schema.

## Acceptance checklist

- [x] `databricks bundle validate -p dev` succeeds with committed defaults (empty URL/id allowed if documented).
- [x] README documents: create routine → copy secret once → `put-secret` → set `routine_webhook_*` target vars → deploy → enable routine.
- [x] Job resource deploys from bundle and references `scripts/ping_routine_webhook.py`.
- [x] Manual **Test** (`POST /api/routines/:id/run`) still works with routine disabled; webhook returns 403 when disabled (existing behavior).
- [x] With routine **enabled** and secret in scope, Job **Run now** returns **201** and enqueues prompt in bot chat (`[routine:Lakeflow Job Probe] scheduled run`). Verified 2026-10-30 on `dev` (Job `361443667185267`, serverless + OAuth M2M).
- [x] Wrong/missing webhook secret → **401**; missing header → **401** (unchanged).
- [x] `npm test` passes; any new Quartz-hint / setup-status tests included.
- [x] No secret values committed to git (grep / review).
- [x] **Apps ingress:** Job uses OAuth M2M (`apps-oauth-client-id` / `apps-oauth-client-secret`) + `body.webhookKey`; serverless `environment_key` (classic clusters rejected in this workspace).

## Manual UI verification (later agent)

1. Deploy App; open bot **Details → Routines**.
2. **Add** routine: name, cron `0 9 * * *`, prompt; confirm human schedule line under cron field.
3. After create, copy **Secret**, **Webhook URL**, and header lines from trust banner; confirm routine id in URL matches list row.
4. Run **Test**, transcript shows prompt; works even if **On** is unchecked (optional check).
5. Toggle **On**; store secret via CLI (`put-secret`); configure bundle variables + deploy Job per README.
6. Trigger Job once from workspace UI (**Run now**), same chat receives scheduled run as webhook (not session **Test**).
7. Toggle **Off**; Job run → **403**; **Test** still succeeds.

## Risks / open decisions (implementer)

| Topic | Options |
| --- | --- |
| Empty bundle vars at deploy | Fail in script vs omit Job resource, spec prefers fail in script + README |
| `spark_python_task` path | Confirm DAB resolves `python_file` from repo root vs job file location |
| Job run-as identity | Document which principal needs secret READ + public App egress |
| Multiple routines | v1 one Job; later template or App API remains out of scope |
| `BRICKSBOT_PUBLIC_APP_URL` | Optional; UI can keep using `window.location.origin` when App is open |
| Quartz hint coverage | Match `describeCronExpression` v1 patterns only; else omit hint |

## Related

- Prior UI spec: [2026-10-29-routine-trust.md](2026-10-29-routine-trust.md)
- OSS packaging: [oss-community-release.md](../oss-community-release.md) P0 §2, P1 table
- Product lock: routines = Job → webhook ([project-context.md](../project-context.md))
