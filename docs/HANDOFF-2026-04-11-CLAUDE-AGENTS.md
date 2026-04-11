# BizzyBee Claude Handoff — 2026-04-11

## Purpose

This file is for a fresh Claude session.

The goal is to catch Claude up on:

- what BizzyBee is
- why the architecture has been moving in this direction
- what was completed today
- the current technical and product state
- why we now want to replace selected `n8n` workflows with Claude-managed agents
- what the next implementation wave should be

This is intentionally written as a practical working brief, not a polished project overview.

---

## 1. What BizzyBee Is

BizzyBee is an AI customer operations platform for service businesses.

Core product idea:

- unify customer conversations across channels
- help small businesses reply faster
- let AI triage, draft, and eventually handle common customer interactions
- build a reusable knowledge/voice/brand layer from historical customer communications
- expand beyond email into social DMs, SMS, WhatsApp, and AI phone

North star:

- one calm operational inbox
- channel-aware AI
- business-specific memory and behavior
- eventual subscription + add-on monetization

This is not just a generic chatbot product. It is meant to become an operations layer for small businesses.

---

## 2. Product / Commercial Shape

The pricing model already exists in:

- [/Users/michaelcarbon/Projects/BizzyBee/BIZZYBEE_PRICING.md](/Users/michaelcarbon/Projects/BizzyBee/BIZZYBEE_PRICING.md)

Important pricing/product decisions from that doc:

- `Connect` is a low-cost unified inbox tier with no AI
- `Starter`, `Growth`, and `Pro` are the AI tiers
- Instagram DM and Facebook Messenger are included on all plans
- WhatsApp AI, SMS AI, and AI Phone are add-ons
- AI Phone is a premium add-on with base fee plus usage

Why this matters technically:

- the app cannot keep using ad hoc gating
- billing logic needs one internal source of truth
- Stripe should not define product behavior directly
- the app needs a proper entitlement layer before commercial rollout

---

## 3. Where The Repo / Branch Is Now

Active working repo for this handoff:

- `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-control`

Current branch:

- `codex/supabase-hardening-control`

Current important recent commits:

- `8f64e0a` `hardening: tighten provider webhooks and gdpr portal binding`
- `9491012` `chore: restore supabase migration parity history`
- `c8f2786` `hardening: align privacy endpoints with canonical auth`
- `c3e443f` `security: require n8n signatures when secret is configured`
- `e5e8b4c` `hardening: tighten edge auth and scope workspace policies`
- `0a6c61e` `hardening: secure media workspace resolution and feature guards`

Remote Supabase project linked during this session:

- `atukvssploxwyqpwjmrc`

Live app used for smoke checks:

- `https://bizzybee-app.pages.dev`

---

## 4. Read These First

Claude should read these files first, in this order:

1. [HANDOFF-2026-04-11-CLAUDE-AGENTS.md](/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-control/docs/HANDOFF-2026-04-11-CLAUDE-AGENTS.md)
2. [HANDOFF-2026-04-09.md](/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-control/docs/HANDOFF-2026-04-09.md)
3. [2026-04-11-billing-entitlements-architecture.md](/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-control/docs/plans/2026-04-11-billing-entitlements-architecture.md)
4. [2026-04-11-dark-launch-entitlements-wave.md](/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-control/docs/plans/2026-04-11-dark-launch-entitlements-wave.md)
5. [2026-04-11-supabase-live-verification.md](/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-control/docs/audits/2026-04-11-supabase-live-verification.md)
6. [2026-04-11-gdpr-portal-identity-binding-hardening.md](/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-control/docs/audits/2026-04-11-gdpr-portal-identity-binding-hardening.md)
7. [/Users/michaelcarbon/Projects/BizzyBee/BIZZYBEE_PRICING.md](/Users/michaelcarbon/Projects/BizzyBee/BIZZYBEE_PRICING.md)
8. [n8n-ai-phone-workflows.md](/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-control/docs/plans/n8n-ai-phone-workflows.md)
9. [trigger-n8n-workflow/index.ts](/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-control/supabase/functions/trigger-n8n-workflow/index.ts)

If Claude only has time for a partial catch-up, at minimum it should read items `1`, `5`, `7`, `8`, and `9`.

---

## 5. What Happened Today

Today’s work happened in three major waves.

### A. Release-candidate stabilization

The app was not in a state where billing or deeper orchestration work would have been safe.

The first goal was to stabilize the core product enough that:

- onboarding could complete
- seeded workspaces could resolve properly
- plan-gated routes behaved consistently
- runtime errors from schema drift were reduced

This included:

- stabilizing onboarding and workspace resolution
- fixing seeded billing personas
- adding missing `workspace_members` support
- making the app degrade more gracefully around schema drift

This work produced a cleaner release baseline before the deeper architecture work.

### B. Dark-launch billing / entitlements foundation

We did not want to wire Stripe into random screens.

Instead, the billing work followed this logic:

- build the entitlement model first
- evaluate entitlements everywhere
- keep enforcement staged
- do not let billing destabilize testing

The model uses rollout modes like:

- `legacy`
- `shadow`
- `soft`
- `hard`

This means the app can compute and log gating decisions before full enforcement.

This is important because it avoids “is this broken because of billing or because the feature itself is broken?”

### C. Deep Supabase hardening

The biggest work in the latest branch was security, tenancy, and consistency hardening.

We found that the bigger risk was not billing itself. It was:

- weak workspace scoping
- edge functions trusting request `workspace_id`
- migration parity drift
- privileged endpoints that were too open
- webhook verification paths that were inconsistent

What was done:

- restored local/remote migration parity
- applied remote migrations `20260411214500` and `20260411224500`
- hardened shared auth and entitlement resolution
- deployed the affected edge function wave
- hardened Twilio and `n8n` verification behavior
- tightened provider webhook and GDPR portal binding code
- verified the live Supabase project and documented remaining secret gaps

This work means the backend is now substantially safer to build higher-level agent orchestration on top of.

---

## 6. Current Supabase / Security Reality

Read:

- [2026-04-11-supabase-live-verification.md](/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-control/docs/audits/2026-04-11-supabase-live-verification.md)

Short version:

- local and remote migration histories now match through `20260411224500`
- the previously exposed internal/admin-style edge surfaces now reject anonymous traffic
- `n8n` signature enforcement is live
- Twilio signature enforcement is live

Still missing remotely:

- `AURINKO_WEBHOOK_SECRET`
- `GOOGLE_BUSINESS_WEBHOOK_TOKEN`
- `ELEVENLABS_WEBHOOK_SECRET`
- `GDPR_TOKEN_SECRET`
- `POSTMARK_API_KEY`

Practical meaning:

- some webhook handlers are now secure when secrets exist
- some remain soft because the required secret does not yet exist in the linked project
- the GDPR portal code is improved, but the portal is not live-ready because the required secrets are missing

This is a very important distinction:

- code hardening is ahead of runtime secret provisioning

Claude should not assume that “implemented” means “fully active in production.”

---

## 7. Current Live Product Reality

The linked Supabase backend is in a stronger place than the live frontend deployment.

Important live observations from smoke testing:

- seeded starter sign-in works
- workspace resolution works
- `inbox_insights` and `triage_corrections` behaved correctly in the recent smoke
- `/ai-phone` eventually loaded correctly

Still visible in the live frontend:

- auth page logs `AuthSessionMissingError` before sign-in
- Home still triggers a `400` on `email_import_queue`
- `/ai-phone` showed transient `retell-call-stats` failures before settling

Interpretation:

- the current loudest product issue is frontend/runtime drift
- the current loudest backend issue is not auth or RLS anymore

This matters because Claude should not over-focus on Supabase hardening first if the next goal is agent workflow build-out. The next meaningful product layer is orchestration and frontend alignment.

---

## 8. Billing / Entitlements Position

The intended billing architecture is:

- Stripe as payment processor
- Supabase as the internal source of truth
- frontend and backend reading the same entitlement layer
- staged rollout via `legacy/shadow/soft/hard`

This should remain the approach.

Claude should not build raw Stripe-first gating.

The right mental model is:

- Stripe updates subscription state
- Supabase stores normalized plan/add-on state
- app and edge functions ask the entitlement layer

Important related docs:

- [2026-04-11-billing-entitlements-architecture.md](/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-control/docs/plans/2026-04-11-billing-entitlements-architecture.md)
- [2026-04-11-dark-launch-entitlements-wave.md](/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-control/docs/plans/2026-04-11-dark-launch-entitlements-wave.md)

---

## 9. Current n8n Footprint

The app currently has an explicit edge entry point for `n8n` orchestration:

- [trigger-n8n-workflow/index.ts](/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-control/supabase/functions/trigger-n8n-workflow/index.ts)

Current workflow types there:

- `competitor_discovery`
- `email_classification`
- `own_website_scrape`
- `faq_generation`

There are also `n8n`-related AI-phone workflows documented in:

- [n8n-ai-phone-workflows.md](/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-control/docs/plans/n8n-ai-phone-workflows.md)

Those two documented workflows are:

- AI Phone post-call processing
- GDPR auto-delete

The repo also contains UI strings and helper flows that mention functions being “migrated to n8n”.

---

## 10. Why We Want Claude-Managed Agents

Before switching folders and restarting sessions, we were discussing replacing selected `n8n` workflows with Claude-managed agents.

That idea is still correct.

Reasoning:

- some of these workflows are judgment-heavy, multi-step, and brittle in `n8n`
- agent workflows can be faster to iterate on
- they can be cheaper when they avoid unnecessary external hops
- they can be more reliable when the logic lives in app-owned code + typed state instead of scattered workflow nodes

But not every workflow should become an agent.

---

## 11. What Should Become Agents vs What Should Not

### Good candidates for Claude-managed agents

These are the best near-term replacements:

- `faq_generation`
- `own_website_scrape`
- `competitor_discovery`
- maybe AI Phone post-call processing if richer reasoning is desired

Why these fit:

- they are open-ended
- they involve judgment
- they can benefit from adaptive retries
- they often fan out across fetched material
- they produce structured artifacts that are useful to store and review

### Bad candidates for Claude-managed agents

These should stay deterministic:

- `email_classification` for now
- GDPR auto-delete scheduler
- provider webhooks
- token refresh jobs
- pure data movement / sync / callback plumbing

Why these should stay deterministic:

- they are not fundamentally reasoning problems
- they need predictable retries and latency
- they are better handled by typed code, cron, or edge functions

Important principle:

- do not “agentify” plumbing
- do use agents for research, synthesis, extraction, prioritization, and decision-heavy multi-step work

---

## 12. Recommended Agent Migration Order

### First pilot

`faq_generation`

Why first:

- strongest fit for agent reasoning
- bounded enough to ship without destabilizing the app
- easier to compare against current `n8n` output quality
- does not sit on the most safety-critical path

### Second

`own_website_scrape`

Why second:

- same general pattern as FAQ generation
- can likely reuse much of the same orchestration
- directly useful for knowledge-base improvement

### Third

`competitor_discovery`

Why third:

- highest upside
- also highest orchestration complexity
- depends on stronger run tracking and artifact modeling

### Leave for later

- `email_classification`
- deterministic cleanup workflows
- low-level webhooks

---

## 13. Recommended Architecture For Claude-Managed Agents

Do not replace `n8n` with “Claude calls everywhere”.

Build an app-owned orchestration layer.

Recommended pieces:

- `agent_runs`
- `agent_run_steps`
- `agent_artifacts`
- `agent_run_events`

Suggested purpose:

- `agent_runs`
  - one row per workflow run
  - workflow type
  - workspace id
  - status
  - model/provider
  - budget / attempt metadata

- `agent_run_steps`
  - each step in a multi-step process
  - fetch, parse, summarize, consolidate, score, persist

- `agent_artifacts`
  - normalized outputs
  - scraped pages
  - summaries
  - generated FAQ records
  - competitor candidates
  - reviewable intermediate outputs

- `agent_run_events`
  - append-only audit trail
  - status changes
  - retries
  - warnings
  - human review notes

Important:

- preserve compatibility with current frontend progress expectations if possible
- if useful, keep writing a compatible shape into `n8n_workflow_progress` during migration
- this allows dark-launch replacement without rewriting all progress UI first

---

## 14. Strong Recommendation For The First Claude Implementation Wave

Claude should not start by deleting `n8n` references everywhere.

The right first implementation wave is:

1. design the agent-run data model
2. implement the storage layer and typed contracts
3. implement one pilot runner for `faq_generation`
4. keep the old `n8n` path available as fallback
5. make the UI read progress from the new run model or a compatibility shim

This should be done as a dark launch, not a hard cutover.

Recommended migration mode:

- `legacy`: existing `n8n`
- `shadow`: agent runs too, but does not control output
- `soft`: internal toggle chooses agent path for test workspaces
- `hard`: agent path becomes primary

This mirrors the billing rollout philosophy and is safer.

---

## 15. Immediate Next Tasks For Claude

If Claude is picking up from here, the best next action is:

### Task 1

Design the agent orchestration foundation for replacing selected `n8n` workflows.

Deliver:

- schema proposal
- table definitions
- typed runtime model
- state machine for run lifecycle
- compatibility strategy with existing progress UI
- migration strategy from `n8n`

### Task 2

Map the current `faq_generation` flow end to end.

Deliver:

- exact inputs
- current outputs
- where data is stored
- what parts are deterministic vs agentic
- proposed agent-run step sequence

### Task 3

Implement the first pilot path for `faq_generation` behind a feature flag or internal switch.

Do not start with Stripe.
Do not start with `email_classification`.
Do not start by removing `n8n` globally.

---

## 16. Things Claude Should Be Careful Not To Misread

### 1. “The backend is hardened” does not mean “all production secrets are configured”

Some live runtime paths still need secrets provisioned before full fail-closed behavior is appropriate.

### 2. “The app is near-finished” does not mean “all live frontend drift is gone”

There is still visible runtime mismatch in the deployed frontend.

### 3. “We want agents” does not mean “replace every workflow with an LLM”

The agent target is selective and intentional.

### 4. “Billing exists” does not mean “Stripe-first architecture is desired”

The intended system is Supabase-centered entitlements, not raw Stripe object gating.

---

## 17. Suggested Working Definition For Claude

Claude should treat BizzyBee as:

- a multi-channel AI customer ops platform
- moving from prototype/workflow sprawl toward app-owned orchestration
- currently strong enough in backend foundations to start selected agent migration
- still needing frontend stabilization and secret provisioning to finish the live release properly

The right next frontier is not more random hardening.

It is:

- building the first real agent orchestration layer
- starting with `faq_generation`
- keeping the rollout reversible and observable

---

## 18. Overnight / Low-Risk Follow-On Work

If someone continues without the product owner online, the lowest-risk useful tasks are:

- design the `agent_runs` schema and runtime contract
- inventory all current `n8n` touchpoints and map them to “keep vs replace”
- write the `faq_generation` migration spec in implementation detail
- audit the Home `email_import_queue` frontend drift and identify the exact query fixes needed
- produce a remote secret provisioning checklist for remaining live features

Higher-risk things that should not be done casually overnight:

- removing `n8n` globally
- changing billing enforcement to `hard`
- flipping webhook behavior to fail-closed where secrets do not yet exist
- introducing Stripe live charging behavior

---

## 19. Bottom Line

BizzyBee is no longer at the stage where “just wire another workflow” is the right answer.

The project now has:

- a better billing foundation
- a much stronger Supabase security posture
- clearer product/commercial boundaries
- a visible orchestration gap where selected `n8n` workflows should become app-owned Claude-managed agents

The first serious agent migration should be:

- `faq_generation`

And it should be built as:

- typed
- observable
- reversible
- compatible with current UI progress expectations

That is the recommended next wave.
