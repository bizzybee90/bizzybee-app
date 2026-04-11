# Managed Agent Foundation — 2026-04-11

## Objective

Replace the right `n8n` workflows with app-owned Claude-managed agent runs without destabilizing the product.

The target outcome is:

- deterministic plumbing stays deterministic
- agentic reasoning moves into BizzyBee-owned orchestration
- runs are observable, reviewable, and reversible
- the current onboarding and progress UI can keep working during migration

This is not a plan to remove `n8n` everywhere.

It is a plan to replace the workflows that benefit from adaptive reasoning and multi-step synthesis.

---

## Why Now

BizzyBee has moved past the stage where more workflow sprawl is the right answer.

After today's hardening and verification work:

- Supabase tenancy and auth are in a much stronger place
- billing/entitlement architecture has a safer shape
- live gaps are more about frontend/runtime drift and orchestration than raw security

This is the right moment to start moving selected workflows from `n8n` into an app-owned managed-agent model.

---

## Current Orchestration Shape

The current workflow trigger surface is:

- [trigger-n8n-workflow/index.ts](/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-control/supabase/functions/trigger-n8n-workflow/index.ts)

Current explicit `workflow_type` values there:

- `competitor_discovery`
- `email_classification`
- `own_website_scrape`
- `faq_generation`

Current progress compatibility tables already in use:

- `n8n_workflow_progress`
- `scraping_jobs`

Current domain output tables involved in those workflows:

- `competitor_sites`
- `faq_database`
- `competitor_research_jobs`

The migration needs to respect those existing contracts instead of pretending the UI can change all at once.

---

## Keep vs Replace

### Good managed-agent candidates

- `faq_generation`
- `own_website_scrape`
- `competitor_discovery`
- possibly AI Phone post-call processing later

### Keep deterministic for now

- `email_classification`
- GDPR auto-delete
- provider webhooks
- token refresh and sync jobs
- low-level callback plumbing

### Why

Good candidates:

- involve open-ended extraction or synthesis
- require judgment
- benefit from adaptive retries
- produce reviewable artifacts

Bad candidates:

- are mainly data movement
- need tight latency / predictable behavior
- do not benefit enough from agent autonomy to justify the added complexity

---

## First Migration Target

The first pilot should be:

- `faq_generation`

Why it is the best first target:

- strongest reasoning fit
- bounded scope
- easier to compare with current output quality
- can reuse existing domain tables (`faq_database`, `competitor_sites`)
- lower risk than replacing email classification or channel ingestion paths

---

## Proposed Foundation Tables

Add four new tables.

### `agent_runs`

One row per managed workflow run.

Suggested fields:

- `id`
- `workspace_id`
- `workflow_key`
- `status`
- `rollout_mode`
- `trigger_source`
- `legacy_progress_workflow_type`
- `source_job_id`
- `initiated_by`
- `current_step_key`
- `input_snapshot`
- `output_summary`
- `error_summary`
- `started_at`
- `completed_at`
- `last_heartbeat_at`
- `created_at`
- `updated_at`

### `agent_run_steps`

One row per step attempt in a run.

Suggested use:

- loading inputs
- fetching source pages
- extracting candidates
- consolidating output
- persisting domain rows
- syncing compatibility state

### `agent_run_artifacts`

Stores intermediate and final artifacts.

Examples:

- fetched page content
- extracted FAQ candidates
- competitor candidates
- normalized summaries
- final persisted row references

### `agent_run_events`

Append-only event stream for observability.

Examples:

- queued
- step started
- retry scheduled
- partial failure
- persistence complete
- mirrored to compatibility table

---

## Proposed Runtime State Model

### Run status

- `queued`
- `running`
- `waiting`
- `succeeded`
- `failed`
- `canceled`

### Step status

- `queued`
- `running`
- `succeeded`
- `failed`
- `skipped`
- `canceled`

### Rollout modes

Reuse the same activation ladder we already prefer elsewhere:

- `legacy`
- `shadow`
- `soft`
- `hard`

### Interpretation

- `legacy`
  - existing `n8n` path only
- `shadow`
  - create agent run in parallel or dry-run evaluation mode
  - does not become source of truth
- `soft`
  - selected workspaces use agent path
  - legacy compatibility writes still happen
- `hard`
  - agent path is primary

---

## Compatibility Strategy

This migration should not require rewriting all onboarding UI first.

The agent system should preserve compatibility in two places:

### 1. `n8n_workflow_progress`

During migration, the managed workflow should keep writing a compatible progress shape into:

- `n8n_workflow_progress`

That lets current progress surfaces continue working while the orchestration backend changes.

### 2. Existing domain tables

The managed workflow should still write final outputs into the same tables the app already reads:

- `faq_database`
- `competitor_sites`
- `scraping_jobs` where relevant

This is the key to a safe dark launch.

---

## `faq_generation` Pilot Shape

### Current input

- workspace id
- selected competitor rows from `competitor_sites`
- optional callback/progress path

### Current output

- FAQ rows inserted into `faq_database`
- progress reflected via `n8n_workflow_progress`

### Proposed managed-agent step sequence

1. `load_selected_competitors`
   - read selected competitors for workspace
   - snapshot input set into `agent_runs.input_snapshot`

2. `fetch_source_pages`
   - deterministic fetching/crawling
   - store fetched content as artifacts

3. `extract_faq_candidates`
   - Claude-managed extraction over fetched content
   - artifact type: `faq_candidate`

4. `consolidate_and_score`
   - dedupe similar FAQs
   - score confidence/relevance
   - mark likely low-quality outputs

5. `persist_faqs`
   - write into `faq_database`
   - link artifacts to persisted rows

6. `sync_compatibility_progress`
   - write a compatible success/failure state into `n8n_workflow_progress`

7. `finalize_run`
   - set run summary
   - mark succeeded or failed

### Important rule

Fetching and crawling do not need to be “agentic”.

The agentic part is:

- extracting
- consolidating
- normalizing
- deciding what is worth storing

---

## `own_website_scrape` Shape

This can reuse much of the same system as `faq_generation`.

Main difference:

- source set starts from one business website rather than selected competitors
- compatibility writes also need to keep `scraping_jobs` updated

Likely shared step library:

- fetch pages
- extract FAQ candidates
- normalize and persist

---

## `competitor_discovery` Shape

This should migrate after the first two.

Reason:

- it has more moving parts
- it mixes search, filtering, validation, and persistence
- it is a better second/third wave than a first pilot

Recommended eventual split:

- deterministic search/fetch phase
- managed-agent ranking / dedupe / relevance phase
- deterministic persistence phase

---

## Safe Implementation Order

### Phase 1

Add the foundation only:

- migration for run tables
- TS contracts
- planning docs

### Phase 2

Add a narrow pilot runner for `faq_generation`:

- create agent run
- write steps and artifacts
- do not cut over globally

### Phase 3

Mirror status back into `n8n_workflow_progress`

### Phase 4

Gate workspace selection:

- internal/test workspaces first
- old `n8n` path remains fallback

### Phase 5

Only after the pilot is trustworthy:

- expand to `own_website_scrape`
- then `competitor_discovery`

---

## Non-Goals

- do not remove `n8n` globally in the first pass
- do not replace `email_classification`
- do not couple this to Stripe or billing rollout
- do not introduce live hard blocking logic as part of this work

---

## Immediate Deliverables For Tomorrow

The most useful next implementation wave is:

1. add the migration from [20260411235500_add_managed_agent_run_tables.sql](/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-control/supabase/migrations/20260411235500_add_managed_agent_run_tables.sql)
2. use [contracts.ts](/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-control/src/lib/agents/contracts.ts) as the initial TS contract spine
3. build the `faq_generation` managed-run pilot behind a workspace-scoped rollout flag
4. mirror progress into `n8n_workflow_progress` so the current UI continues to work

---

## Bottom Line

The correct path is not “replace `n8n` with Claude everywhere”.

The correct path is:

- app-owned orchestration
- selective agentic reasoning
- compatibility with current UI and domain tables
- first pilot on `faq_generation`

That is the safest and highest-leverage next move.
