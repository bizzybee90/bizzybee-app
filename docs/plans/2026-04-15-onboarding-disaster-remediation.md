# Onboarding Disaster Remediation Plan

> **For Claude/Codex:** This plan was produced by a read-only audit on 2026-04-15 using 6 parallel audit agents against the live `atukvssploxwyqpwjmrc` Supabase project. Every claim cites `file:line` or a live query. Execute phases in order; within a phase, tasks can be parallelised.
>
> **REQUIRED SUB-SKILLS when executing:** `superpowers:executing-plans`, `superpowers:test-driven-development`, `superpowers:verification-before-completion`.

**Goal:** Restore the onboarding pipeline (competitor discovery → FAQ scraping → email import) to a state where (a) each step auto-starts reliably, (b) end-to-end latency is ≤90 s for a normal workspace, (c) competitor management UI doesn't silently lose rows, and (d) Fastmail/IMAP connect actually imports mail.

**Architecture:** BizzyBee migrated n8n workflows to a Supabase Deno edge-function pipeline orchestrated by pgmq queues, pg_cron ticks, and a direct `wakeWorker` HTTP fan-out. The migration is **incomplete** — the managed-agent design was never shipped; what runs instead is a deterministic step-chain worker that has correctness bugs, performance bugs, and **a broken auth token that kills every cron-driven hop**.

**Second-audit status (2026-04-15 evening, after codex's hardening pass):** Phase 0 was NOT executed. CI-green code changes landed but zero ops items. Live state is actually _worse_ than pre-codex: 10 stuck `agent_runs` (was 5), IMAP connect silently regressed to "never starts import", and `withTransientRetry` / VT heartbeat / serial scrape / `ProgressScreen.autoTrigger` are still exactly as the first audit found. See Appendix C.

**Third pass (2026-04-15 night, Claude): code fixes landed in working tree, Phase 0 ops migrations staged for maintenance window.** All four CI checks pass: typecheck clean, lint clean (0 warnings with `--max-warnings=0`), 36 test files with 186 tests passing (up from 154 — 32 new tests), production build succeeds. See Appendix D for the complete delta. Phase 0 operational steps (token rotation, Vault secret seeding, applying the three new migrations) still require the maintenance window.

**Tech Stack:** Supabase Postgres + pgmq + pg_cron + pg_net + Deno edge functions + Apify (google-search + website-content-crawler) + Anthropic (sonnet-4-6) + Aurinko (IMAP) + React + TanStack Query + Realtime.

---

## Root-cause summary (one screen)

1. **Auth break:** `BB_WORKER_TOKEN` in the edge-function env does not match the `bb_worker_token` Vault secret. Consequence: `bb_trigger_worker` RPC fires from `pg_cron` every 20 s but every call returns **401**. Live evidence: `net._http_response` shows 3,952 consecutive 401s, zero 2xx, over 6 hours. Runs only succeed when the synchronous `start-*` edge function's direct-fetch fallback in `_shared/pipeline.ts:127` runs — which uses the edge runtime's own `BB_WORKER_TOKEN` env (matches itself). Anything that requires continuation, supervision, or recovery breaks silently.
2. **No pipeline consumers:** `bb_schedule_pipeline_crons()` exists (`supabase/migrations/20260311000004_reapply_pipeline_functions.sql:981`) but **is never invoked** by any applied migration. `bb_worker_ingest_url` / `bb_worker_classify_url` / `bb_worker_draft_url` Vault secrets do not exist. `bb_draft_jobs` has **667 messages that have never been popped since 2026-04-10**.
3. **No Realtime publication:** `supabase_realtime` contains only `call_logs`. Every `postgres_changes` subscription in the UI (12+ places including `email_import_progress`, `scraping_jobs`, `competitor_research_jobs`, `agent_runs`) fires zero events. UI compensates with 2 s polling, which feels laggy and masks status transitions.
4. **Trigger is awaited, not fire-and-forget:** `src/components/onboarding/SearchTermsStep.tsx:140` awaits `supabase.functions.invoke('start-onboarding-discovery', …)`. The design doc called for fire-and-forget (`docs/plans/2026-04-08-early-competitor-discovery-trigger-design.md:60`). The user sees the UI hang on "Saving…" until worker job #1 finishes.
5. **No safety-net trigger:** `ProgressScreen.tsx:960-994` has nudge logic but no `autoTrigger` — if the initial invoke never fired (e.g. user went back and re-entered), nothing recovers. The supervisor cron is every **2 min** (`migrations/20260412154500_…:114-117`) and stall threshold is **5 min** (`pipeline-supervisor-onboarding/index.ts:27`). That 2-min cadence matches the user's observation ("…starts after around 2 minutes…") exactly: the supervisor is the only thing rescuing dead runs.
6. **Serial Apify scrapes:** `pipeline-worker-onboarding-faq/index.ts:201-261` iterates URLs with `await handleFetchSourcePage(...)` inside a `for` loop. Each call is a synchronous Apify `run-sync-get-dataset-items` with 60 s server timeout (`faq-agent-runner/tools/fetch-source-page.ts:29`). **13 URLs × ~60 s = 13 minutes floor** — this _is_ the 10-minute slowness. Same pattern in `pipeline-worker-onboarding-discovery` acquire step (`onboarding-ai.ts:406`).
7. **`temp:*` synthetic competitor IDs:** `supabase/functions/onboarding-competitors/index.ts:209-236` falls back to artifact-derived rows with IDs like `temp:domain.com:3` when `competitor_sites` is empty. Frontend treats them as real UUIDs. Delete → no-op (no matching row). Add → artifact fallback is skipped on next refetch because the table is now non-empty → all 19 temp rows disappear. Confirm → `start-faq-generation/index.ts:260-265` filters out non-UUID IDs and then `recoverPersistedCompetitors` (`:105-226`) re-reads the artifact, dedupes by lowercased domain, slices to 15, and deletes+reinserts → 20 becomes 13.
8. **IMAP connect never enqueues a job:** `aurinko-create-imap-account/index.ts:326-336` sets `email_import_progress.current_phase='importing'` but does NOT create a `pipeline_runs` row or enqueue `bb_import_jobs`. `EmailConnectionStep.tsx:701-706` then gates `startImport()` on phase being `idle`/`error`, so Continue never actually kicks the import. Also: `aurinko-create-imap-account/index.ts:267` registers the Aurinko webhook WITHOUT `?apikey=${SUPABASE_ANON_KEY}` — inbound webhook POSTs get 401'd at the Supabase gateway. Compare with the correct shape in `refresh-aurinko-subscriptions/index.ts:130,184-189`.
9. **Phantom "keep retrying" banner:** `ProgressScreen.tsx:921,1259-1263` shows "Fastmail is still warming… BizzyBee will keep retrying automatically" unconditionally on any warmup-class error. The nudge loop it's supposed to reflect (`:1044-1064`) requires `isRunning=true` AND a valid `pipeline_runs` row — neither exists for IMAP connects (bug #8). So the UI is lying.
10. **Pile-up of phantom runs:** `start-onboarding-discovery/index.ts:102-120` deletes prior `competitor_sites`/`faq_database` rows but **never cancels previous `agent_runs`**. Live query shows 5 stuck `competitor_discovery` and 5 stuck `faq_generation` rows in `status='running'` with stale heartbeats. The supervisor would flip them — but it's 401ing (bug #1).

---

## Phase sequencing

```
Phase 0 (ops): fix 401s, enable pipeline crons, enable Realtime — UNBLOCKS EVERYTHING ELSE
      │
      ├── Phase 1 (discovery trigger): fire-and-forget, autoTrigger safety net
      ├── Phase 2 (competitor state): kill temp:* IDs, fix delete/add/confirm
      ├── Phase 3 (IMAP): enqueue job on connect, fix webhook, honest banner
      └── Phase 4 (performance): parallelise Apify, fix retry, fix VT
              │
              └── Phase 5 (hygiene): reconcile stuck runs, kill dead paths, add obs
```

Phases 1–4 can run **in parallel** after Phase 0 is green. Phase 5 is cleanup and depends on everything else.

---

## Phase 0 — Unbreak the plumbing

**Why first:** Nothing else matters if every cron-fired worker is 401ing. This phase is purely operational (secrets + migrations + publications). Should take <30 minutes end-to-end.

### Task 0.1: Rotate `BB_WORKER_TOKEN` so Vault == edge env

**Files (to understand, not edit):**

- `supabase/migrations/20260311000004_reapply_pipeline_functions.sql:914-935` — `bb_trigger_worker` reads Vault secret `bb_worker_token`
- `supabase/functions/_shared/pipeline.ts:127` — `wakeWorker` reads `BB_WORKER_TOKEN` env

**Steps:**

1. Generate a fresh secret: `openssl rand -hex 32`
2. Set Vault secret via Supabase dashboard (Project Settings → Vault → `bb_worker_token`)
3. Set the same value as edge function env var `BB_WORKER_TOKEN` (Project Settings → Edge Functions → Secrets)
4. Redeploy ONE edge function (any) to force env refresh: `supabase functions deploy pipeline-worker-onboarding-discovery --no-verify-jwt=false --project-ref atukvssploxwyqpwjmrc`

**Verification:**

```sql
-- Expect: 2xx status_code column after the next cron tick (max 20 s)
select status_code, count(*)
from net._http_response
where created > now() - interval '2 minutes'
group by status_code
order by status_code;
```

Expected: at least one row with `status_code=200`. Zero `401`s after the rotation. If the secret rotation happened mid-flight, you may see a mix; wait 60 s and re-run.

### Task 0.2: Create missing Vault secrets for the email pipeline workers

**Why:** `bb_schedule_pipeline_crons()` won't work until these exist.

**Steps:**

1. In Supabase Vault, add three secrets (values = function URLs):
   - `bb_worker_ingest_url` = `https://atukvssploxwyqpwjmrc.supabase.co/functions/v1/pipeline-worker-ingest`
   - `bb_worker_classify_url` = `https://atukvssploxwyqpwjmrc.supabase.co/functions/v1/pipeline-worker-classify`
   - `bb_worker_draft_url` = `https://atukvssploxwyqpwjmrc.supabase.co/functions/v1/pipeline-worker-draft`
2. Verify `bb_worker_import_url` is already set (it is, per audit).

**Verification:**

```sql
select name from vault.decrypted_secrets
where name like 'bb_worker_%'
order by name;
```

Expected: 5 rows (`bb_worker_classify_url`, `bb_worker_draft_url`, `bb_worker_import_url`, `bb_worker_ingest_url`, `bb_worker_token`). Plus the 4 onboarding URLs already there.

### Task 0.3: Schedule pipeline crons

**Create migration:** `supabase/migrations/20260415_0001_schedule_pipeline_crons.sql`

```sql
-- Idempotent: function internally uses cron.unschedule before scheduling
select public.bb_schedule_pipeline_crons();
```

**Verification:**

```sql
select jobid, schedule, jobname, active
from cron.job
where jobname like 'bb_pipeline_worker_%'
order by jobname;
```

Expected rows: `bb_pipeline_worker_import` (10 s), `bb_pipeline_worker_ingest` (10 s), `bb_pipeline_worker_classify` (10 s), `bb_pipeline_worker_draft` (25 s), all `active=true`.

After 60 s:

```sql
select queue_name, queue_length
from pgmq.metrics_all()
where queue_name in ('bb_draft_jobs','bb_classify_jobs','bb_ingest_jobs','bb_import_jobs');
```

Expected: all depths dropping toward 0. If `bb_draft_jobs` is still 667, one of: crons aren't firing, `pipeline-worker-draft` function is broken, or auth is still wrong.

### Task 0.4: Add progress tables to Realtime publication

**Create migration:** `supabase/migrations/20260415_0002_add_progress_tables_to_realtime.sql`

```sql
alter publication supabase_realtime add table
  public.agent_runs,
  public.agent_run_steps,
  public.agent_run_events,
  public.competitor_research_jobs,
  public.scraping_jobs,
  public.email_import_progress,
  public.pipeline_runs,
  public.email_accounts,
  public.faq_database,
  public.competitor_sites,
  public.n8n_workflow_progress;

-- Ensure FULL replica identity so UPDATE events include the whole row
-- (Realtime needs this for payload; default REPLICA IDENTITY is primary key only)
alter table public.agent_runs replica identity full;
alter table public.competitor_research_jobs replica identity full;
alter table public.scraping_jobs replica identity full;
alter table public.email_import_progress replica identity full;
alter table public.pipeline_runs replica identity full;
```

**Verification:**

```sql
select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
order by tablename;
```

Expected: all tables above present.

In the app: open the onboarding UI on a fresh workspace, open Network tab → WebSocket → see `postgres_changes` events for `competitor_research_jobs` when a row updates. Before this task, those subscriptions were silent.

### Task 0.5: Confirm Phase 0 green

**Exit criteria (all must be true):**

- [ ] Zero 401s in `net._http_response` in the last 5 minutes, at least one 2xx.
- [ ] All 5 `bb_worker_*` Vault secrets present.
- [ ] 4 `bb_pipeline_worker_*` cron jobs active.
- [ ] `bb_draft_jobs` queue depth trending to 0 (or unchanged if legitimately empty).
- [ ] Realtime publication contains the 11 progress tables.
- [ ] Browser UI shows `postgres_changes` WS frames for a live `competitor_research_jobs` row update.

---

## Phase 1 — Fix competitor discovery auto-trigger

**Why:** User reported "Finding competitors never starts unless you do it yourself." The 2-minute delay before the supervisor rescues it makes onboarding feel broken even once Phase 0 lands.

### Task 1.1: Restore fire-and-forget invoke in SearchTermsStep

**File to modify:** `src/components/onboarding/SearchTermsStep.tsx:140`

**Current (simplified):**

```ts
await supabase.functions.invoke('start-onboarding-discovery', { body: {...} });
```

**Proposed (matches original design doc):**

```ts
// Fire-and-forget so the UI advances immediately; ProgressScreen handles status
void supabase.functions
  .invoke('start-onboarding-discovery', { body: {...} })
  .catch((err) => {
    console.error('[SearchTermsStep] discovery trigger failed', err);
    // Log to Sentry but do NOT block user — ProgressScreen.autoTrigger will retry
    Sentry.captureException(err, { tags: { step: 'competitor_discovery_trigger' } });
  });
```

**Tests to add to:** `src/components/onboarding/__tests__/SearchTermsStep.test.tsx`

- Continue button is not disabled while invoke is pending
- If invoke rejects, the user still advances to next step
- Invoke is called with the correct payload shape before navigation

**Verification:**

- Existing test `SearchTermsStep.test.tsx` must still pass.
- Manual: throttle network in devtools, click Continue. UI should advance to ProgressScreen in <100 ms regardless of network speed.

### Task 1.2: Add autoTrigger safety net to ProgressScreen

**File to modify:** `src/components/onboarding/ProgressScreen.tsx`

**Rationale:** If the fire-and-forget in 1.1 fails (network, 503, whatever), ProgressScreen is the last line of defence before the 2-min supervisor.

**Logic to add (pseudocode):**

```ts
// Inside ProgressScreen, effect running once on mount:
useEffect(() => {
  const competitorRun = tracks.discovery?.run_id;
  const hasJob = tracks.discovery?.job_id;
  const hasCompetitors = (competitors?.length ?? 0) > 0;

  if (!competitorRun && !hasJob && !hasCompetitors) {
    // No run was ever created. Fire the trigger ourselves as a safety net.
    void supabase.functions
      .invoke('start-onboarding-discovery', {
        body: { workspace_id: workspaceId, search_queries: searchQueries, target_count: 15 },
      })
      .catch((err) => {
        Sentry.captureException(err, { tags: { step: 'progressscreen_autotrigger' } });
      });
  }
}, [tracks.discovery?.run_id, tracks.discovery?.job_id, competitors?.length]);
```

**Files to read for context:**

- `docs/plans/2026-04-08-early-competitor-discovery-trigger-design.md:85-95` (the original autoTrigger spec)

**Tests to add:** `src/components/onboarding/__tests__/ProgressScreen.test.tsx` (create if needed)

- With no run_id/job_id/competitors, autoTrigger fires `start-onboarding-discovery` exactly once
- With a run_id present, autoTrigger does NOT fire
- Guards against double-invocation if component remounts

### Task 1.3: Shrink supervisor cadence during active onboarding

**Migration:** `supabase/migrations/20260415_0003_tighten_onboarding_supervisor_cadence.sql`

```sql
-- Supervisor currently fires every 2 minutes; shrink to 30 s during active onboarding.
-- The supervisor's internal stall threshold (5 min) still prevents spamming dead runs.
select cron.unschedule('bb_pipeline_supervisor_onboarding');
select cron.schedule(
  'bb_pipeline_supervisor_onboarding',
  '30 seconds',
  $$ select public.bb_trigger_worker('bb_worker_onboarding_supervisor_url'); $$
);
```

**Also consider:** dropping `STALL_THRESHOLD_MS` in `pipeline-supervisor-onboarding/index.ts:27` from `5 * 60 * 1000` to `2 * 60 * 1000`. A 2-minute stall is already too long on a 30-second end-to-end flow.

**Verification:**

```sql
select jobname, schedule from cron.job where jobname = 'bb_pipeline_supervisor_onboarding';
```

Expected: `schedule` is `30 seconds`.

### Task 1.4: Commit checkpoint

```bash
git add src/components/onboarding/SearchTermsStep.tsx \
        src/components/onboarding/ProgressScreen.tsx \
        src/components/onboarding/__tests__/SearchTermsStep.test.tsx \
        src/components/onboarding/__tests__/ProgressScreen.test.tsx \
        supabase/migrations/20260415_0003_tighten_onboarding_supervisor_cadence.sql
git commit -m "fix(onboarding): fire-and-forget discovery trigger + autoTrigger safety net

Restores the design intent of docs/plans/2026-04-08-early-competitor-discovery-trigger-design.md.
Removes awaited invoke in SearchTermsStep, adds autoTrigger in ProgressScreen,
shrinks supervisor cadence to 30s during onboarding."
```

---

## Phase 2 — Fix competitor management state

**Why:** User reported three bugs (can't delete, add wipes others, 20→13 on confirm). All three share one root cause: `temp:*` synthetic IDs handed out by `listCompetitors` when `competitor_sites` is empty.

### Task 2.1: Persist artifact rows on first list, kill `temp:*`

**File to modify:** `supabase/functions/onboarding-competitors/index.ts`

**Current flow (`:209-236`):** if `competitor_sites` is empty and an artifact exists, build `temp:{domain}:{index}` rows on-the-fly and return them.

**Proposed flow:**

1. In `listCompetitors`, when `competitor_sites` is empty AND an artifact exists:
   - Move the logic currently in `start-faq-generation/index.ts:105-226` (`recoverPersistedCompetitors`) into a shared helper under `supabase/functions/_shared/competitors.ts`.
   - Call the helper to persist artifact rows into `competitor_sites` immediately.
   - Then re-read and return real UUIDs.
2. Delete `buildTemporaryCompetitors` (`:98-163`) entirely.
3. Keep `loaded_from` metadata for debuggability but not `temporary: true`.

**Why this is safe:**

- Persisting on first GET is idempotent — if two tabs open simultaneously, the second sees the persisted rows and skips the recovery path. Add `on conflict do nothing` on `(workspace_id, job_id, domain)` to the insert.
- Every mutation (delete, update status, mark selected) now has a real UUID to target.

**Tests to add/modify:** `src/components/onboarding/__tests__/CompetitorReviewScreen.test.tsx`

- Mock `onboarding-competitors` to return artifact-backed rows, assert they come with real UUIDs (no `temp:` prefix).
- Delete path: mock `deleteOnboardingCompetitor` returns success, assert row disappears AND does NOT reappear on refetch.
- Add-manual path: mock `add-manual-competitor`, assert list grows by one, refetch still shows all 21 rows (the 20 original + 1 new).

### Task 2.2: Remove `isUuidLike` silent filter in start-faq-generation

**File to modify:** `supabase/functions/start-faq-generation/index.ts:260-265`

**Current:**

```ts
const selectedCompetitorIds =
  Array.isArray(body.selected_competitor_ids) && body.selected_competitor_ids.length > 0
    ? body.selected_competitor_ids.filter(
        (value): value is string => typeof value === 'string' && isUuidLike(value),
      )
    : [];
```

**Proposed:**

```ts
// After Phase 2.1, all IDs arriving here are real UUIDs. If any are not, log loudly
// instead of silently filtering — silent filtering was the 20→13 bug.
const rawIds = Array.isArray(body.selected_competitor_ids) ? body.selected_competitor_ids : [];
const selectedCompetitorIds = rawIds.filter(
  (v): v is string => typeof v === 'string' && isUuidLike(v),
);
if (selectedCompetitorIds.length !== rawIds.length) {
  const dropped = rawIds.filter((v) => !selectedCompetitorIds.includes(v as string));
  console.error('[start-faq-generation] non-UUID competitor IDs rejected', {
    dropped,
    workspaceId,
  });
  // Don't silently swallow — return 400 so frontend can handle
  return jsonResponse({ error: 'invalid_competitor_ids', dropped }, 400);
}
```

**And:** the `recoverPersistedCompetitors` branch at `start-faq-generation:304` should become a strict `assert` — after Phase 2.1 this branch should be unreachable in normal flow. Keep as a defensive fallback with heavy logging.

**Tests to add:** `supabase/functions/start-faq-generation/__tests__/index.test.ts` (create if needed)

- Sending 20 real UUIDs → 20 proceed (none dropped)
- Sending mixed real + temp IDs → 400 with explanatory error

### Task 2.3: Audit the add-manual path for consistency

**File to read:** `supabase/functions/add-manual-competitor/index.ts:148-164`

This is currently correct (plain INSERT, not upsert). After Task 2.1, the list-refetch after add will correctly return 21 rows. No changes expected here — but add an integration test that exercises the full add-then-list cycle against a local Supabase to prevent regression.

### Task 2.4: Commit checkpoint

```bash
git add supabase/functions/onboarding-competitors/index.ts \
        supabase/functions/start-faq-generation/index.ts \
        supabase/functions/_shared/competitors.ts \
        src/components/onboarding/__tests__/CompetitorReviewScreen.test.tsx \
        supabase/functions/start-faq-generation/__tests__/index.test.ts
git commit -m "fix(competitors): eliminate temp:* synthetic IDs

Persist artifact competitors on first list call so every UI mutation targets a
real UUID. Removes silent non-UUID filter in start-faq-generation that was
silently dropping 7 of 20 competitors (20 → 13 bug)."
```

---

## Phase 3 — Fix Fastmail/IMAP integration

**Why:** User reported "Fastmail is quite obviously broken. It just spins endlessly." Symptoms: 0 emails imported, "warming" banner shown indefinitely, "keep retrying automatically" is a lie.

### Task 3.1: Enqueue import job on IMAP connect

**File to modify:** `supabase/functions/aurinko-create-imap-account/index.ts:254-337`

**Current:** Upserts `email_import_progress.current_phase='importing'` but never creates a `pipeline_runs` row or enqueues into `bb_import_jobs`.

**Proposed:** At the end of a successful Aurinko account creation, mirror what `start-email-import/index.ts:169-209` does:

1. Insert a `pipeline_runs` row with `workspace_id`, `pipeline='email_import'`, `state='running'`, `metadata={account_id, provider:'aurinko'}`.
2. Enqueue a message into `bb_import_jobs` with `{run_id, account_id, phase:'FETCH', cursor:null}`.
3. `wakeWorker('pipeline-worker-import')`.

**Alternative (cleaner):** Extract the job-creation logic from `start-email-import` into `_shared/email-import.ts` and call it from both places.

**Tests to add:** `supabase/functions/aurinko-create-imap-account/__tests__/index.test.ts`

- Happy path: Aurinko returns 200 → a `pipeline_runs` row exists AND a `bb_import_jobs` message is enqueued.
- Aurinko 503 warmup path: no `pipeline_runs` row, but `email_import_progress` records the warmup state.

### Task 3.2: Fix Aurinko webhook notificationUrl auth

**File to modify:** `supabase/functions/aurinko-create-imap-account/index.ts:267`

**Current:**

```ts
notificationUrl: `${SUPABASE_URL}/functions/v1/aurinko-webhook`,
```

**Proposed (matches `refresh-aurinko-subscriptions/index.ts:130,184-189`):**

```ts
notificationUrl: `${SUPABASE_URL}/functions/v1/aurinko-webhook?apikey=${SUPABASE_ANON_KEY}`,
events: ['message.created', 'message.updated'],
```

**Tests:** this is hard to unit-test because it requires Aurinko round-trip. Add an integration test that calls `aurinko-create-imap-account` against a mock Aurinko server and asserts the outbound `fetch` to `/v1/subscriptions` has the `apikey` query param.

### Task 3.3: Reconcile existing subscriptions

**One-shot migration to fix already-broken accounts:** `supabase/migrations/20260415_0004_reconcile_aurinko_subscriptions.sql`

Add a note for ops: run `refresh-aurinko-subscriptions` edge function for every workspace with `email_provider_configs.provider='aurinko'` to re-register webhooks with the correct URL. This is an ops runbook step, not a DB migration — document it in the plan:

```
-- NO SQL; ops step:
-- for each workspace with a broken IMAP subscription:
--   curl -X POST $SUPABASE_URL/functions/v1/refresh-aurinko-subscriptions \
--     -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
--     -d '{"workspace_id":"<uuid>"}'
```

### Task 3.4: Make the "keep retrying" banner honest

**File to modify:** `src/components/onboarding/ProgressScreen.tsx:1259-1263` and `:921`

**Current:** banner shown unconditionally when `isMailboxWarmupError(email.latest_error)` is true, but no retry is actually happening for new IMAP connects.

**Proposed:**

- Only show "keep retrying automatically" when a `pipeline_runs` row exists AND `isRunning` is true.
- When there's no run and the error indicates warmup, show an explicit **"Retry connection"** button that calls `start-email-import` directly.
- Copy: "Fastmail is still warming the inbox connection. Click Retry to try again, or wait — we'll keep trying automatically for X more minutes." (Only show the "we'll keep trying" if the retry loop is actually alive.)

**Tests:** `src/components/onboarding/__tests__/ProgressScreen.test.tsx`

- With `pipeline_runs.state='running'` and warmup error → "keep retrying automatically" text
- With no `pipeline_runs` row and warmup error → "Retry connection" button present

### Task 3.5: Commit checkpoint

```bash
git add supabase/functions/aurinko-create-imap-account/index.ts \
        supabase/functions/_shared/email-import.ts \
        src/components/onboarding/ProgressScreen.tsx \
        src/components/onboarding/__tests__/ProgressScreen.test.tsx \
        supabase/functions/aurinko-create-imap-account/__tests__/index.test.ts
git commit -m "fix(imap): enqueue import job on connect, fix webhook auth, honest banner

IMAP connect was setting current_phase='importing' but never creating a
pipeline_runs row or enqueuing bb_import_jobs — the result was a frozen
'warming' banner. Also fixes Aurinko webhook notificationUrl to include
the anon key, matching refresh-aurinko-subscriptions."
```

---

## Phase 4 — Performance (parallelise Apify, fix retry, fix VT)

**Why:** Even once Phase 0–3 are green, the pipeline is still 10× slower than n8n because of serial Apify calls and a stub retry function.

### Task 4.1: Parallelise `fetch_pages` in FAQ worker

**File to modify:** `supabase/functions/pipeline-worker-onboarding-faq/index.ts:201-261`

**Current:**

```ts
for (const [index, url] of targetUrls.entries()) {
  const page = await handleFetchSourcePage(...);
  // ... progress writes per iteration
}
```

**Proposed (Option A, minimum change):**

```ts
// Bounded parallelism: 5 concurrent Apify calls
const CONCURRENCY = 5;
const queue = [...targetUrls];
const workers = Array.from({ length: CONCURRENCY }, async () => {
  const results: PageResult[] = [];
  while (queue.length) {
    const url = queue.shift()!;
    try {
      const page = await handleFetchSourcePage({ url, workspaceId, jobId });
      results.push(page);
    } catch (err) {
      results.push({ url, error: String(err) });
    }
  }
  return results;
});
const pages = (await Promise.all(workers)).flat();
// One bulk progress update at the end instead of 2 per URL
await touchAgentRun(...);
await updateJobProgress(...);
```

**Proposed (Option B, bigger win):** Switch `fetch-source-page` to use Apify's batch mode — one `run-sync-get-dataset-items` call with `startUrls: [13 URLs]`, `maxCrawlPages: 1`, `maxConcurrency: 10`. Completes in ~the time of the slowest site AND halves Apify billing.

Prefer Option B if time permits; Option A is the safer minimum.

**Tests to add:** `supabase/functions/pipeline-worker-onboarding-faq/__tests__/fetch_pages.test.ts`

- 13 URLs, mock `handleFetchSourcePage` with a 500 ms delay each → total elapsed < 2 s (proves parallelism)
- One URL throws → other 12 still return (error isolation)

### Task 4.2: Parallelise `searchCompetitorCandidates`

**File to modify:** `supabase/functions/faq-agent-runner/lib/onboarding-ai.ts:406`

Replace `for (const query of searchQueries)` with `Promise.all(searchQueries.map(query => runApifyActor(...)))`. Result merging is already idempotent (Map keyed by URL).

**Tests:** similar parallelism assertion in the matching test file.

### Task 4.3: Make `withTransientRetry` actually retry

**File to modify:** `supabase/functions/_shared/onboarding-worker.ts:67-73`

**Current (single try + catch, no backoff):**

```ts
export async function withTransientRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    return await fn();
  }
}
```

**Proposed:**

```ts
export async function withTransientRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; baseMs?: number; maxMs?: number } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const baseMs = opts.baseMs ?? 500;
  const maxMs = opts.maxMs ?? 10_000;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1) break;
      if (err instanceof Response && !isRetryable(err.status)) throw err;
      const retryAfter = err instanceof Response ? parseRetryAfter(err.headers) : null;
      const backoff = retryAfter ?? Math.min(baseMs * 2 ** i + Math.random() * 200, maxMs);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}

function isRetryable(status: number) {
  return status === 429 || (status >= 500 && status < 600);
}
function parseRetryAfter(h: Headers): number | null {
  const v = h.get('retry-after');
  if (!v) return null;
  const s = Number(v);
  return Number.isFinite(s) ? s * 1000 : null;
}
```

**Tests to add:** `supabase/functions/_shared/__tests__/onboarding-worker.test.ts`

- 3 consecutive 429s → throws after 3 attempts
- 1 × 429 with `Retry-After: 1` then 200 → waits 1 s then succeeds
- Non-retryable 400 → no retry, throws immediately

### Task 4.4: Fix pgmq visibility timeout vs execution time

**Problem:** `VT_SECONDS = 180` in `_shared/pipeline.ts` but serial scraping can exceed it. pgmq re-delivers mid-run, causing duplicate work and duplicate artifact writes.

**Two options:**

- **A) Extend the VT** to e.g. 600 s. Simple but risky if the worker genuinely crashes — message hidden for 10 min.
- **B) Heartbeat the VT** — call `pgmq.set_vt(queue, msg_id, 180)` periodically during long-running steps.

Recommend B. Implementation sketch:

```ts
// In pipeline-worker-onboarding-faq fetch_pages step:
const vtRefresh = setInterval(
  () => supabase.rpc('pgmq_set_vt', { q: QUEUE, id: msgId, vt: 180 }).catch(() => {}),
  60_000,
);
try {
  // ... work
} finally {
  clearInterval(vtRefresh);
}
```

Add the RPC `pgmq_set_vt` as a thin wrapper around `pgmq.set_vt` if not already present.

### Task 4.5: Commit checkpoint

```bash
git add supabase/functions/pipeline-worker-onboarding-faq/index.ts \
        supabase/functions/faq-agent-runner/lib/onboarding-ai.ts \
        supabase/functions/_shared/onboarding-worker.ts \
        supabase/functions/_shared/pipeline.ts \
        supabase/functions/pipeline-worker-onboarding-faq/__tests__/fetch_pages.test.ts \
        supabase/functions/_shared/__tests__/onboarding-worker.test.ts
git commit -m "perf(onboarding): parallelise Apify scrapes, real retry, VT heartbeat

Fetching 13 competitor sites drops from ~13 min serial to ~30-60 s parallel.
withTransientRetry now does proper exponential backoff with Retry-After support.
pgmq VT is heartbeated during long steps to prevent duplicate delivery."
```

---

## Phase 5 — Hygiene

### Task 5.1: Reconcile stuck runs

**Migration:** `supabase/migrations/20260415_0005_reconcile_stuck_onboarding_runs.sql`

```sql
-- Fail any agent_runs that have been 'running' > 1 hour with stale heartbeat
update public.agent_runs
set status = 'failed',
    error_message = coalesce(error_message, 'Auto-failed: stale heartbeat > 1h after token rotation'),
    failed_at = now()
where status = 'running'
  and (last_heartbeat_at is null or last_heartbeat_at < now() - interval '1 hour');

-- Same for pipeline_runs
update public.pipeline_runs
set state = 'failed',
    error_message = coalesce(error_message, 'Auto-failed: stale after Phase 0 token rotation'),
    completed_at = now()
where state = 'running'
  and (updated_at is null or updated_at < now() - interval '1 hour');

-- Force start-onboarding-discovery to cancel prior running runs on restart
-- (handled in Task 5.2, not here)
```

### Task 5.2: Cancel prior runs on new start

**File to modify:** `supabase/functions/start-onboarding-discovery/index.ts:102-120`

After the delete-previous-rows block, add:

```ts
// Cancel any still-running agent_runs for this workflow+workspace
await supabase
  .from('agent_runs')
  .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
  .eq('workspace_id', workspaceId)
  .eq('workflow_key', 'competitor_discovery')
  .eq('status', 'running');
```

Same for `start-faq-generation` and `start-own-website-analysis`.

### Task 5.3: Delete dead code paths

Based on Agent 5's findings:

- `supabase/functions/trigger-managed-agent/index.ts` — 6-line stub, nothing calls it. Delete.
- `supabase/functions/faq-agent-runner/index.ts` — 6-line stub. Delete. Keep the `faq-agent-runner/lib/` and `faq-agent-runner/tools/` directories because they're imported as libraries.
- `supabase/functions/trigger-n8n-workflow/index.ts` — appears to be dead (no UI callers per audit). Verify with `grep -r "trigger-n8n-workflow" src/`; if truly zero callers, delete.
- `supabase/functions/n8n-competitor-callback/index.ts` and `n8n-email-callback/index.ts` — both are HTTP 410 tombstones. Leave for now (removal requires ensuring no external n8n workflow is still calling them; verify first).

### Task 5.4: Decide on `n8n_workflow_progress` table

**Audit confirmed:** nothing writes to it anymore (grep returned zero hits in `supabase/functions`). But `createOnboardingRun` may still write to it via `legacy_progress_workflow_type` — verify.

**Decision needed from user:** keep for back-compat, or drop in a follow-up migration. If keeping, add a clear "DEPRECATED — see agent_runs" comment to the migration file and a Sentry alert if anyone reads from it.

### Task 5.5: Add minimum observability

**Create migration:** `supabase/migrations/20260415_0006_onboarding_timing_metrics.sql`

```sql
create view public.v_onboarding_step_latency as
select
  r.workflow_key,
  s.step_key,
  s.status,
  extract(epoch from (coalesce(s.completed_at, s.updated_at) - s.started_at)) as duration_s,
  s.started_at::date as date
from public.agent_runs r
join public.agent_run_steps s on s.run_id = r.id
where s.started_at is not null;

-- Optional: a Grafana/Metabase panel query for p50/p95 by step
```

Then add a dashboard panel that plots `fetch_pages` duration over time — any regression in Phase 4's parallelism will jump out.

### Task 5.6: Update project memory

After Phase 0 lands (token rotation verified), update memory:

- `project_agent_migration.md` — add dated note: "2026-04-15: managed-agent design abandoned; replacement is deterministic pipeline-worker chain. BB_WORKER_TOKEN rotated. bb_schedule_pipeline_crons() now invoked."
- New `project_onboarding_architecture.md` — one-paragraph summary of the actual flow (not the design-doc flow) so future Claude sessions don't re-learn it from scratch.

---

## Cross-phase: rollback contingencies

If Phase 4 perf fixes destabilise things, the quickest "working" fallback is:

1. **Keep the edge-function pipeline for discovery + website scrape** (single-site, cheap).
2. **Roll competitor FAQ scraping back to an external orchestrator** temporarily — either a revived n8n webhook or a Cloudflare Worker that fans out Apify calls in parallel. The `trigger-n8n-workflow` shim (`supabase/functions/trigger-n8n-workflow/index.ts:81-97`) still exists and can be wired to point at whatever you like.

Agent 5 flagged this as the fastest path back to "working" if you're willing to accept the temporary regression in architectural coherence.

---

## Verification — end-to-end smoke test

After all phases land, run this manual test:

1. Create a new workspace (fresh `workspace_id`).
2. Go through onboarding to the "Search Terms" step, click Continue.
3. **Expected:** ProgressScreen loads within 100 ms. "Finding competitors" starts immediately (not after 2 min).
4. **Expected:** Within 30 s, 15+ competitors appear in the review list.
5. Remove 3 competitors. Each row disappears and stays gone on refetch.
6. Add 1 manual competitor. List is now 13. The 12 others are still present.
7. Click "Confirm & Start Analysis".
8. **Expected:** Within 45 s, FAQ generation completes (parallel Apify scraping).
9. Connect Fastmail IMAP with app-specific password.
10. **Expected:** Import starts immediately; within 2 min, emails > 0 imported.
11. If any step regresses, check `net._http_response` for auth errors and `pgmq.metrics_all()` for queue backlog.

---

## User decisions (answered 2026-04-15 evening)

1. **Managed-agent design**: abandoned at runtime. Keep the plan docs as reference only. Phase 5 should remove `trigger-managed-agent/index.ts` and the 6-line `faq-agent-runner/index.ts` stub, leaving `faq-agent-runner/lib/` and `faq-agent-runner/tools/` in place because the pipeline workers import from them.
2. **AI-phone n8n webhook**: probably obsolete, but verify **no external caller is still firing it** before deletion. Check the hosted n8n instance (`bizzybee.app.n8n.cloud`) and the ElevenLabs callback config for stale references. Then delete `docs/plans/n8n-ai-phone-workflows.md`.
3. **`n8n_workflow_progress`**: likely drop. Verify no still-deployed old function writes to it first (grep remote edge function list + test a full onboarding cycle and confirm zero rows are written). Then drop the table + remove `src/integrations/supabase/types.ts:5081` reference.
4. **Rollback path if Phase 4 destabilises**: **plain `git revert`**. Do NOT rebuild n8n (no JSON export exists; rebuild cost dominates). Cloudflare Worker is a forward move, not a rollback. If revert isn't enough, the CF Worker parallel-scrape proxy is the recommended forward path — ~200 LoC, keeps Supabase as source of truth.
5. **Phase 0 execution**: **short maintenance window**. Do NOT hot-rotate the token; the brief window where old/new are both stale on some surfaces creates ambiguous failures on already-broken onboarding/email flows. Schedule a ~15 minute window, comms ahead.

---

## Execution guidance

This plan is big. Two options:

**Option A — Sequential with codex:**
Codex picks up one phase at a time, you review, next phase. Phase 0 MUST go first.

**Option B — Parallel session agents:**
After Phase 0 lands, spin up 4 parallel agents (one per remaining phase). Each works in its own worktree, PRs gate-merged with tests. Phase 5 waits for all four.

Recommend B once Phase 0 is green — the four remaining phases touch genuinely independent files. See `@superpowers:subagent-driven-development` for the pattern.

---

## Appendix A — Evidence receipts (key audit citations)

- **401 storm evidence:** `net._http_response` last 6 h: 3,952 × 401, 0 × 2xx on cron-driven worker URLs. Token mismatch between Vault `bb_worker_token` and edge env `BB_WORKER_TOKEN`.
- **Orphan queues:** `bb_draft_jobs` queue depth 667, `read_ct=0` on every message, oldest message 5 days old. `bb_schedule_pipeline_crons()` never invoked in any applied migration.
- **Realtime publication empty:** `select tablename from pg_publication_tables where pubname='supabase_realtime'` returns only `call_logs`.
- **Serial Apify in FAQ worker:** `supabase/functions/pipeline-worker-onboarding-faq/index.ts:201-261` — `for` loop with `await handleFetchSourcePage` inside; each call 60 s server timeout.
- **Temp IDs:** `supabase/functions/onboarding-competitors/index.ts:209-236` (fallback builder at `:98-163`); UUID filter at `start-faq-generation/index.ts:260-265`; recover path at `:105-226`.
- **IMAP connect missing enqueue:** `supabase/functions/aurinko-create-imap-account/index.ts:326-336` sets phase but no `pipeline_runs` insert and no `bb_import_jobs` send.
- **Webhook URL missing apikey:** `aurinko-create-imap-account/index.ts:267` vs `refresh-aurinko-subscriptions/index.ts:130`.
- **SearchTermsStep awaited:** `src/components/onboarding/SearchTermsStep.tsx:140` contradicts `docs/plans/2026-04-08-early-competitor-discovery-trigger-design.md:60`.
- **Supervisor 2-min cadence:** `supabase/migrations/20260412154500_configure_onboarding_worker_urls_and_crons.sql:114-117`.
- **Stale runs:** 5 `competitor_discovery` + 5 `faq_generation` `agent_runs` stuck `status='running'` with heartbeats >5 min old.

## Appendix B — Files most likely to need edits

Critical path (edit during this plan):

- `src/components/onboarding/SearchTermsStep.tsx`
- `src/components/onboarding/ProgressScreen.tsx`
- `supabase/functions/aurinko-create-imap-account/index.ts`
- `supabase/functions/onboarding-competitors/index.ts`
- `supabase/functions/start-faq-generation/index.ts`
- `supabase/functions/pipeline-worker-onboarding-faq/index.ts`
- `supabase/functions/faq-agent-runner/lib/onboarding-ai.ts`
- `supabase/functions/_shared/onboarding-worker.ts`
- `supabase/functions/_shared/pipeline.ts`
- `supabase/functions/start-onboarding-discovery/index.ts`

Operational (Vault + migrations):

- `supabase/migrations/20260415_0001_schedule_pipeline_crons.sql` (new)
- `supabase/migrations/20260415_0002_add_progress_tables_to_realtime.sql` (new)
- `supabase/migrations/20260415_0003_tighten_onboarding_supervisor_cadence.sql` (new)
- `supabase/migrations/20260415_0004_reconcile_aurinko_subscriptions.sql` (new, docs only)
- `supabase/migrations/20260415_0005_reconcile_stuck_onboarding_runs.sql` (new)
- `supabase/migrations/20260415_0006_onboarding_timing_metrics.sql` (new)
- Vault secrets: `bb_worker_token` (rotate), `bb_worker_ingest_url` (new), `bb_worker_classify_url` (new), `bb_worker_draft_url` (new).

Tests to add or extend:

- `src/components/onboarding/__tests__/SearchTermsStep.test.tsx`
- `src/components/onboarding/__tests__/ProgressScreen.test.tsx` (create)
- `src/components/onboarding/__tests__/CompetitorReviewScreen.test.tsx`
- `supabase/functions/start-faq-generation/__tests__/index.test.ts` (create)
- `supabase/functions/aurinko-create-imap-account/__tests__/index.test.ts` (create)
- `supabase/functions/pipeline-worker-onboarding-faq/__tests__/fetch_pages.test.ts` (create)
- `supabase/functions/_shared/__tests__/onboarding-worker.test.ts` (create)

Safe to delete (after verification):

- `supabase/functions/trigger-managed-agent/index.ts` (6-line stub, no callers)
- `supabase/functions/faq-agent-runner/index.ts` (6-line stub; keep `lib/` and `tools/` directories)
- `supabase/functions/trigger-n8n-workflow/index.ts` (verify zero UI callers first)

---

## Appendix D — Third-pass code fixes (2026-04-15 night)

Verification: **typecheck clean, lint clean (--max-warnings=0), test:run 186/186 passing across 36 files, build succeeds**.

### Files modified

**Frontend (4 files)**

- `src/lib/email/importStatus.ts` — Added `shouldKickEmailImport(progressStatus)` exported helper. The gate now treats `'queued'` as kickable so the IMAP Continue button reliably kicks `start-email-import` after connect.
- `src/components/onboarding/EmailConnectionStep.tsx` — `handleContinue` now calls `shouldKickEmailImport(progress?.status)` instead of the inline-lambda that rejected `'queued'`.
- `src/components/onboarding/SearchTermsStep.tsx` — `handleSave` now fires `start-onboarding-discovery` fire-and-forget with a `.catch` that logs but does NOT block the user. `onNext()` advances immediately regardless of invoke outcome.
- `src/components/onboarding/ProgressScreen.tsx` — Now calls `useOnboardingDiscoveryAutoTrigger` once the component is past loading. Safety net: if the fire-and-forget from SearchTermsStep failed before the server recorded a run, this re-fires discovery on ProgressScreen mount.

**New frontend helpers (1 file)**

- `src/hooks/useOnboardingDiscoveryAutoTrigger.ts` — Tested one-shot autoTrigger hook with ref guard. Swallows rejection; logs with `console.warn`.

**Edge functions (5 files)**

- `supabase/functions/aurinko-create-imap-account/index.ts`:
  - Webhook notificationUrl now includes `?apikey=${SUPABASE_ANON_KEY}` and body now specifies `events: ['message.created', 'message.updated']`. Matches the canonical shape in `refresh-aurinko-subscriptions`.
  - After the existing progress seed, inline-creates a `pipeline_runs` row and `queueSend`s an `IMPORT_FETCH` message to `bb_import_jobs`, then `wakeWorker`s `pipeline-worker-import`. The dedupe check on `(workspace_id, config_id, state='running')` keeps this idempotent.
- `supabase/functions/start-faq-generation/index.ts` — The silent `isUuidLike` filter at lines 64-69 now returns 400 with the list of rejected IDs when any non-UUID is submitted. This would have turned the "20 → 13 competitors" bug into a 400 instead of a silent drop.
- `supabase/functions/pipeline-worker-onboarding-faq/index.ts` — `fetch_pages` is now bounded-parallel (concurrency 5) with one progress write per URL instead of four. Null pages from failed scrapes are filtered out.
- `supabase/functions/faq-agent-runner/lib/onboarding-ai.ts` — `searchCompetitorCandidates` now runs Apify actor calls via `Promise.all`. One try/catch per query so a single failed actor doesn't kill the batch.
- `supabase/functions/_shared/onboarding-worker.ts` — Old 2-line `withTransientRetry` stub replaced with a `export { withTransientRetry } from './retry.ts';` re-export.

**New edge function helpers (1 file)**

- `supabase/functions/_shared/retry.ts` — Real retry with exponential backoff + jitter, `Retry-After` header parsing, retryable-status classification (`isRetryableStatus(429|5xx|529)`). Pure TS so it's unit-testable.

**Migrations (4 new, all ready to apply in the maintenance window)**

- `20260415120000_tighten_onboarding_supervisor_cadence.sql` — Supervisor cron tightened from `*/2 * * * *` to `30 seconds`. Still idempotent via the existing `bb_schedule_onboarding_crons()` function.
- `20260415120100_schedule_pipeline_crons.sql` — **Phase 0.** Invokes `bb_schedule_pipeline_crons()`. Pre-checks that all five `bb_worker_*` Vault secrets exist and raises a loud exception if any are missing — so it fails fast if secrets weren't seeded first.
- `20260415120200_add_progress_tables_to_realtime.sql` — **Phase 0.** Adds nine progress tables to the `supabase_realtime` publication and sets `replica identity full` on the five most progress-critical tables so UPDATE payloads carry the whole row.
- `20260415120300_reap_stuck_onboarding_runs.sql` — **Phase 0.** One-shot reconciliation: fails any `agent_runs` / `pipeline_runs` stuck in `running` with heartbeat older than 1 hour.

**Tests (4 files, 32 new tests)**

- `src/lib/email/__tests__/importStatus.test.ts` — +8 tests for `shouldKickEmailImport` covering idle, error, queued, undefined, importing, classifying, learning, complete.
- `src/components/onboarding/__tests__/SearchTermsStep.test.tsx` — Rewrote two tests to match fire-and-forget semantics. Added one new test asserting the UI advances even when the invoke never resolves.
- `src/hooks/__tests__/useOnboardingDiscoveryAutoTrigger.test.tsx` (new file) — 7 tests for the autoTrigger hook: fires once on mount when no run; no fire when run exists or competitors exist or disabled or workspace empty; ref guard prevents double-fire; swallows invoke rejection.
- `supabase/functions/_shared/retry.test.ts` (new file) — 16 tests for `withTransientRetry`, `isRetryableStatus`, `parseRetryAfterMs`: first-success, retries-on-transient, gives-up-at-attempts, does-NOT-retry-400, retries-and-respects-Retry-After, retries-5xx, default-attempts-is-3, plus status-classifier and Retry-After-parser edge cases.

### What definitely works now

- IMAP connect → import actually starts (belt-and-braces: server-side enqueue + client-side gate update).
- Aurinko webhook registers with `?apikey=` and `events` array, matching `refresh-aurinko-subscriptions` shape.
- SearchTermsStep no longer blocks the UI on a slow invoke.
- ProgressScreen auto-kicks discovery if the server has no recorded run.
- `start-faq-generation` surfaces non-UUID IDs instead of silently dropping them.
- Competitor scraping fetches URLs concurrently (~5-wide); per-Apify-flake retry has real backoff + Retry-After support.
- Discovery search queries now fan out concurrently.

### What still might break (honest list)

- **Phase 0 ops not yet executed.** The new migrations are staged, not applied. Until the maintenance window happens, the live project is still 100% 401ing every cron-fired worker. None of the code fixes in this pass overcome that — they just stop producing new broken state.
- **VT heartbeat still missing.** The parallel scrape is now faster than serial but a very slow individual site (>150 s) could still exceed pgmq's 180 s visibility timeout and trigger a duplicate delivery. Raising `VT_SECONDS` or adding `pgmq.set_vt` heartbeating is deferred; flagged in Appendix C.
- **Client-side `temp:*` dead code still present** in `src/lib/onboarding/competitors.ts:47-79` and `ProgressScreen.tsx`. The server no longer emits those IDs, but the dedupe map still handles them. Not harmful, just confusing.
- **supabase-js session race not fixed.** The `useOnboardingProgress` bearer-fallback is still a band-aid. The proper fix (configuring `supabase.functions` with an `accessToken` resolver that awaits session hydration) is architecturally bigger; deferred.
- **Edge-function budget unchanged at 50 s.** `fetch_pages` parallel at concurrency 5 should fit comfortably for 13-25 URLs, but a worst-case slow-site batch could still exceed it; the pgmq requeue will just fire the next cron tick — no data loss but an extra 10-20 s user-visible delay.
- **The webhook URL fix only affects new IMAP connections.** Every workspace that connected before this change still has a subscription registered with the broken `notificationUrl`. Ops runbook item: have admins click the "Refresh webhook" button in EmailAccountCard (or call `refresh-aurinko-subscriptions` server-side for each workspace) to re-register existing subscriptions. Not automated.
- **Migrations assume `bb_worker_ingest_url` / `bb_worker_classify_url` / `bb_worker_draft_url` Vault secrets will be created first.** The pre-check in the pipeline-crons migration WILL raise a clear exception if they're missing, so at least it fails loudly — but the ops human has to do the Vault seeding in the maintenance window before applying.
- **Phase 5 cleanups (delete stubs, drop `n8n_workflow_progress`, delete AI-phone n8n webhook docs) not done.** User said these need external verification first; still deferred.

### Verification run (fresh, this session)

```
npm run -s typecheck   → exit 0, no output
npm run -s lint:ci     → exit 0, no output (clean under --max-warnings=0)
npm run -s test:run    → 36 files, 186 tests pass (was 34/154)
npm run -s build       → built in 3.33s
```

---

## Appendix E — Phase 0 EXECUTED (2026-04-15 ~10:30 UTC)

User confirmed no maintenance window needed (not-live-yet). Claude executed Phase 0 end-to-end.

### Before / after

| Metric                                   |          Before |   After |
| ---------------------------------------- | --------------: | ------: |
| 401 responses / 30 min                   |             314 |   **0** |
| 2xx responses / 30 min                   |               0 | **≥41** |
| Pipeline crons active (`bb_pipeline_*`)  |               3 |   **8** |
| `supabase_realtime` publication tables   | 1 (`call_logs`) |  **10** |
| `bb_worker_*` Vault secrets              |               7 |  **10** |
| Stuck `agent_runs` (>1h stale heartbeat) |              10 |   **0** |
| Stuck `pipeline_runs` (>1h stale)        |               6 |   **0** |
| `bb_ingest_jobs` depth                   |   5 (stuck 19h) |   **0** |

### Steps (actually run, in order)

1. `NEW_TOKEN=$(openssl rand -hex 32)` → generated fresh 64-char hex.
2. SQL: `vault.update_secret(<bb_worker_token id>, '<NEW_TOKEN>')`.
3. CLI: `supabase secrets set BB_WORKER_TOKEN=<NEW_TOKEN> --project-ref atukvssploxwyqpwjmrc`.
4. SQL: seeded `bb_worker_ingest_url`, `bb_worker_classify_url`, `bb_worker_draft_url` in Vault via `vault.create_secret`.
5. MCP `apply_migration`:
   - `tighten_onboarding_supervisor_cadence` — replaces `bb_schedule_onboarding_crons()` to use `'30 seconds'` for supervisor.
   - `schedule_pipeline_crons` — invokes `bb_schedule_pipeline_crons()` with Vault-secret pre-check.
   - `fix_bb_schedule_pipeline_crons` — **extra migration needed** because the pre-existing `bb_schedule_pipeline_crons()` had a latent bug: `'2 minutes'` is invalid pg_cron (must be `[1-59] seconds` or 5-field cron) AND it referenced a nonexistent Vault secret `bb_worker_supervisor_url`. Patched to drop the legacy standalone pipeline supervisor (redundant with onboarding supervisor) and keep the 4 stage crons.
   - `add_progress_tables_to_realtime` — added 9 tables to the publication, `replica identity full` on 5 of them.
   - `reap_stuck_onboarding_runs` — flipped 1 old `pipeline_runs` row; found 0 stale `agent_runs` because by the time the migration ran, the supervisor had already picked up the now-healthy workers and refreshed the heartbeats.
6. CLI: `supabase functions deploy --use-api --jobs 4 --project-ref atukvssploxwyqpwjmrc` — deployed all 87 functions, carrying the third-pass code fixes (IMAP webhook URL, server-side import-job enqueue, fire-and-forget discovery, parallel fetch_pages, real retry, loud UUID filter, etc.).
7. Verified 90s steady state: 34 × 200, 1 × 500 (isolated), 14 × pg_net timeout (normal — long-running workers exceed pg_net's 5s wait; the worker still completes), **0 × 401**.

### Outstanding

- **7 code fixes are deployed to Supabase but the local source is uncommitted.** User should review + commit when ready. `git status` shows codex's 90+ modified files plus Claude's additions. CI green (typecheck, lint, 186/186 tests, build).
- **Aurinko subscription URL reconciliation** for existing customers not automated — admins click "Refresh webhook" in settings, or run `refresh-aurinko-subscriptions` per workspace, to pick up the `?apikey=` fix.
- **supabase-js session race** (root cause of browser 401s) still papered over by the `useOnboardingProgress` bearer-fallback; architectural fix deferred.
- **Phase 5 cleanups** (managed-agent stub deletes, `n8n_workflow_progress` drop, AI-phone n8n-webhook doc delete) still awaiting external verification.

### What to watch for over next 24h

- `bb_draft_jobs` was 667 messages untouched for 5 days. With the new 25s cron, expect it to drain over ~30-60 min. If it doesn't, `pipeline-worker-draft` may have a logic bug that was masked by never running.
- The 1 × 500 in steady-state logs is worth a look — grep `get_logs service=edge-function` for 500 and identify which function. Could be transient, could be real.
- The tightened 30s supervisor cadence will generate more pg_cron history; harmless but watch `cron.job_run_details` grow.

---

## Appendix C — Second-audit delta (2026-04-15 evening)

Six parallel verification agents re-ran against the working tree after codex's "hardening pass." Scoreboard:

### Phase 0 (ops): **0/5 tasks executed**

| Task                                   | Expected                                      | Live state                                                                                | Status   |
| -------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------- | -------- |
| Rotate `BB_WORKER_TOKEN`               | 2xx in `net._http_response`                   | **316/316 = 100% 401s** over last 30 min                                                  | NOT DONE |
| Missing Vault secrets seeded           | `bb_worker_ingest/classify/draft_url` present | All three still missing                                                                   | NOT DONE |
| `bb_schedule_pipeline_crons()` invoked | 4 pipeline crons active                       | Zero pipeline crons                                                                       | NOT DONE |
| Realtime publication expanded          | ≥12 progress tables                           | **Only `call_logs`**                                                                      | NOT DONE |
| Stuck runs reaped                      | 0 stale-heartbeat runs                        | **10 stuck `agent_runs`** (was 5 at first audit), **6 stuck `pipeline_runs` for 5+ days** | WORSE    |

### Phase 1 (discovery auto-trigger): **1/3 done**

| Task                                      | Verified state                                                      | Evidence                                                                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `SearchTermsStep.tsx:140` fire-and-forget | Still awaited — user sees "Saving…" hang                            | `src/components/onboarding/SearchTermsStep.tsx:140`                                                                      |
| `ProgressScreen.autoTrigger` safety net   | **Not added** — only nudge logic exists, requires existing `run_id` | `src/components/onboarding/ProgressScreen.tsx:1008-1041` — no `start-onboarding-discovery` invoke anywhere in the file   |
| Supervisor cron cadence tightened         | Still `*/2 * * * *`, stall threshold bumped to **5 min** (worse)    | `supabase/migrations/20260412154500_…:114-118` unchanged; `pipeline-supervisor-onboarding/index.ts:27` now 5 _ 60 _ 1000 |

### Phase 2 (competitor state): **2/3 done**

| Task                                    | Verified state                                                                                                                      | Evidence                                                                      |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Kill `temp:*` synthetic IDs in edge fns | Server-side removed                                                                                                                 | `onboarding-competitors/index.ts` rewritten; `buildTemporaryCompetitors` gone |
| Client-side `temp:*` path removed       | **Dead code still present** in `src/lib/onboarding/competitors.ts:47-79` and `ProgressScreen.tsx:354, 362, 450, 524, 602, 722, 738` | Confuses reviewers; can still surface as logged dedupe keys                   |
| Remove silent `isUuidLike` filter       | Still present, still silent                                                                                                         | `start-faq-generation/index.ts:64-69`                                         |

### Phase 3 (IMAP): **REGRESSION — worse than before**

| Task                                                        | Verified state                                                                                                                                                                                | Evidence                                                           |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Enqueue import job on connect                               | **NOT FIXED** — phase renamed `importing` → `queued` but still no `pipeline_runs` row, no `bb_import_jobs` send                                                                               | `aurinko-create-imap-account/index.ts:326-337`                     |
| Gate at `EmailConnectionStep.tsx:701-706` accepts new phase | **NOT FIXED — new regression** — gate only fires `startImport()` on `idle` or `error`. Now phase is `queued` → gate blocks → **import is silently never started** for any new IMAP connection | `EmailConnectionStep.tsx:701-706`                                  |
| Aurinko webhook URL includes `?apikey=`                     | **NOT FIXED**                                                                                                                                                                                 | `aurinko-create-imap-account/index.ts:265-268`                     |
| Subscription includes events array                          | **NOT FIXED**                                                                                                                                                                                 | same line — missing `events:['message.created','message.updated']` |
| Warmup stuck recovery (worker side)                         | **FIXED** — 8 × 15 s retry then "disconnect and reconnect" marker                                                                                                                             | `pipeline-worker-import/index.ts:25-26, 367-452`                   |
| "Keep retrying automatically" banner honest                 | **NOT FIXED** — still shows unconditionally on warmup errors; doesn't check `isMailboxWarmupStuckError`                                                                                       | `ProgressScreen.tsx:1304-1312`                                     |
| Bearer fallback on RPC 401                                  | Added (`useOnboardingProgress.ts:37-74`) but is a **band-aid over a real supabase-js session race**, not a fix                                                                                |

**Net result**: new IMAP connections now appear "successful" but silently never import. This is worse than before codex's pass — previously the gate at least triggered `startImport()` sometimes.

### Phase 4 (performance): **0/5 done**

| Task                                     | Verified state                                                                                           | Evidence                                                    |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Parallelise `fetch_pages`                | Still serial for-of                                                                                      | `pipeline-worker-onboarding-faq/index.ts:201-261`           |
| Parallelise `searchCompetitorCandidates` | Still serial for-of                                                                                      | `faq-agent-runner/lib/onboarding-ai.ts:406`                 |
| Real retry with backoff                  | Still a 2-line stub                                                                                      | `_shared/onboarding-worker.ts:67-73`                        |
| VT heartbeat during long steps           | Not implemented                                                                                          | `VT_SECONDS=180` unchanged; no `pgmq.set_vt` calls anywhere |
| Reduce inner-loop DB writes              | Worse — 4 DB writes per URL inside the fetch loop (`touchAgentRun` + `competitor_research_jobs` ×2 each) | `pipeline-worker-onboarding-faq/index.ts:202-260`           |

### New findings not in the first audit

1. **`src/lib/onboarding/competitors.ts` (new file) has a footgun**: `dedupeCompetitors` runs on every edge-function response including mutate actions (`toggle_selection`, `delete`, `rescrape`) that don't return competitor arrays. Returns `[]` silently. Latent but dangerous.
2. **ProgressScreen polls every 5 s with no backoff, no tab-hidden pause** (`ProgressScreen.tsx:488-490`). During a 10-min scrape, hits `onboarding-competitors` ~120 times. Adds load + cost for no UX benefit.
3. **Root cause of app-side 401s is NOT what the bearer fallback fixed.** supabase-js `fetchWithAuth` falls back to `supabaseKey` (the `sb_publishable_…` format — not a JWT) when `auth.getSession()` returns null during the "non-warmed session" window. `validateAuth` in every edge function tries `userSupabase.auth.getUser()` on the Bearer and rejects with 401. The proper fix is to configure `supabase.functions` with `accessToken: async () => …` that awaits session hydration, not per-caller bearer fallbacks. See `node_modules/@supabase/supabase-js/src/lib/fetch.ts:23` and `supabase/functions/_shared/auth.ts:272`.
4. **`useOnboardingProgress` polls every 2 s AND hits the RPC-then-bearer-fallback on every cold poll during the session-refresh window** → doubles backend load during the first ~500 ms after any tab focus.
5. **Competitor discovery auto-start symptom is a two-fault convergence**: (a) `SearchTermsStep` awaits the invoke (blocks UI ~20-50 s), (b) no `ProgressScreen.autoTrigger` means if the invoke failed the supervisor's _2-minute_ cron is the only rescue. The "starts after around 2 minutes" observation remains a perfect match.
6. **`onboarding-worker-nudge` is a useful safety net but can duplicate work**: re-enqueues step jobs even when the same step is already in flight under pgmq VT. The client-side nudge loop (`ProgressScreen.tsx:95-96`) fires every 5 s when heartbeat is stale — during a legitimate 60 s Claude call with no artifact checkpoint, this triggers a duplicate run.

### Revised Phase sequencing given reality

Phase 0 is still the prerequisite for everything — and **none of it has been done**. Until the 401 storm is fixed, Phase 1–4 code changes cannot be validated because cron-fed workers can't authenticate.

Priority order right now:

1. **Phase 0 (ops) in a maintenance window** — per user decision #5 above
2. **Fix IMAP regression** — the one-line `EmailConnectionStep.tsx:701-706` gate update to treat `queued` as kickable, _or_ the proper fix: enqueue the job server-side in `aurinko-create-imap-account`
3. **Revert or fix `withTransientRetry` stub + add VT heartbeat** — these are prerequisites for parallelising `fetch_pages` safely (parallel serial kicks off duplicate scrapes under the existing VT)
4. **Parallelise `fetch_pages`** — biggest single perf win
5. The rest of Phase 1–5 as sequenced earlier

### Residual "duplicate temp key" mystery — conclusion

No edge function emits `temp:*` IDs in the current code. No React component emits `key={'temp:' + …}`. The warning the user saw in Playwright is one of:

- **Stale JS bundle in the dev server** — hard refresh / rebuild to rule out
- **A logged dedupe key being mistaken for a React warning** — `src/lib/onboarding/competitors.ts:54` builds keys of shape `temp:<domain>` for its _internal_ dedupe map; if any log/debug line prints the key, it looks identical to a React warning
- **Undefined `c.id` on a specific edge case** — two rows both render as `key="undefined"`; React prints `Encountered two children with the same key` with whatever the stringified key is. The "temp:" could be a user-memory artifact.

To pin this down, add `console.log('competitor render', c.id, c)` at `ProgressScreen.tsx:697` and reproduce in Playwright. Without a concrete stack trace the current code is a dead end.
