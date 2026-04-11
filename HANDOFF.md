# BizzyBee Handoff

Last updated: 2026-04-11
Status: Checkpoint for resuming work after the project folder move

## Overall Project Goal

BizzyBee is an AI-powered customer operations app for UK small and mid-sized businesses.

The immediate goals are:

1. Stabilise the core product so onboarding, inbox, email import/classification, website FAQ generation, competitor review, and channel setup are production-trustworthy.
2. Build a clean subscription and add-on entitlement system before wiring Stripe.
3. Gate the product from a single entitlement source of truth instead of ad hoc UI rules.

## Current Project Layout

- App repo root:
  - `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-app`
- Pricing source document:
  - `/Users/michaelcarbon/Projects/BizzyBee/BIZZYBEE_PRICING.md`

Notes:

- The repo itself is `bizzybee-app`.
- The parent `BizzyBee` folder is not the git repo.
- During this session, a local symlink was created so old tooling paths keep working:
  - `/Users/michaelcarbon/BizzyBee -> /Users/michaelcarbon/Projects/BizzyBee`
    This is only a local path compatibility shim, not product code.

## Completed Work

### Core product stabilisation from earlier passes

- Email onboarding/import/classification path was hardened significantly:
  - import queue/state handling improved
  - classifier model id issues were fixed
  - classification was observed moving in production instead of sitting forever queued
- Own-website FAQ generation was moved off the old n8n path into code:
  - `scrape-and-generate-faqs` edge function added
  - `trigger-n8n-workflow` updated to route `own_website_scrape` into code instead of n8n
- Competitor review gained a Claude-backed secondary review pass:
  - `competitor-agent-review` added
  - `validate-competitors` updated to chain into it
- Per-task AI model routing and Anthropic usage/cost tracking were added previously.

### Billing / entitlement foundation completed in this checkpoint

- Added machine-readable plan and add-on definitions:
  - `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-app/src/lib/billing/plans.ts`
- Added frontend entitlement resolver:
  - `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-app/src/lib/billing/entitlements.ts`
- Added frontend entitlement hook:
  - `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-app/src/hooks/useEntitlements.ts`
- Added backend helper:
  - `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-app/supabase/functions/_shared/entitlements.ts`
- Added remote schema for subscriptions and add-ons:
  - `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-app/supabase/migrations/20260411170000_create_workspace_billing_tables.sql`
- Updated generated Supabase types to include:
  - `workspace_subscriptions`
  - `workspace_addons`
- Wired entitlements into workspace context so screens can read them centrally.

### First controlled gating pass completed locally

These gates were intentionally small and low-risk:

- Email import history options are now plan-aware:
  - `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-app/src/components/onboarding/EmailConnectionStep.tsx`
- Channel toggles and channel AI automation now respect add-on/plan availability:
  - `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-app/src/components/settings/ChannelManagementPanel.tsx`
- AI Phone navigation/page visibility now respects the AI Phone add-on:
  - `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-app/src/components/sidebar/Sidebar.tsx`
  - `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-app/src/pages/AiPhone.tsx`
- Analytics and Knowledge Base now have plan-aware access states:
  - `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-app/src/pages/AnalyticsDashboard.tsx`
  - `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-app/src/pages/KnowledgeBase.tsx`

### Verification completed in this checkpoint

Passed locally:

- `npm run typecheck`
- `npm run build`
- `npm run test:run -- src/lib/billing/__tests__/plans.test.ts src/lib/billing/__tests__/entitlements.test.ts`

Passed remotely:

- `supabase db push --linked`
- `supabase migration list --linked`

Remote migration state now includes:

- `20260411170000_create_workspace_billing_tables.sql`

## In-Progress Work

The entitlement layer is built and the first UI gates exist, but billing is not fully rolled out.

Current state:

- Stripe is not wired yet.
- Metered billing is not wired yet.
- Backend entitlement enforcement is only partially prepared, not fully implemented.
- The new billing tables exist remotely, but most workspaces do not yet have seeded subscription/add-on rows.

## Critical Decisions Already Made

These should be preserved:

1. Do not wire Stripe directly into random screens.
2. Stripe should update `workspace_subscriptions` and `workspace_addons`.
3. The app should read entitlements from Supabase, not from raw Stripe objects.
4. Stabilise the core product before doing a full billing rollout.
5. Frontend gating is only half the job; important backend actions will also need entitlement enforcement.

## Important Files, Routes, and Components

### Billing / pricing

- Pricing doc outside repo:
  - `/Users/michaelcarbon/Projects/BizzyBee/BIZZYBEE_PRICING.md`
- Billing architecture note:
  - `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-app/docs/plans/2026-04-11-billing-entitlements-architecture.md`
- Plan matrix:
  - `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-app/src/lib/billing/plans.ts`
- Entitlement resolver:
  - `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-app/src/lib/billing/entitlements.ts`
- Frontend hook:
  - `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-app/src/hooks/useEntitlements.ts`
- Backend helper:
  - `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-app/supabase/functions/_shared/entitlements.ts`

### Billing-related gating surfaces

- Workspace context:
  - `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-app/src/contexts/workspace-context.ts`
  - `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-app/src/contexts/WorkspaceContext.tsx`
- Email onboarding:
  - `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-app/src/components/onboarding/EmailConnectionStep.tsx`
- Channels:
  - `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-app/src/components/settings/ChannelManagementPanel.tsx`
- Sidebar:
  - `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-app/src/components/sidebar/Sidebar.tsx`
- AI Phone:
  - `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-app/src/pages/AiPhone.tsx`
- Analytics:
  - `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-app/src/pages/AnalyticsDashboard.tsx`
- Knowledge Base:
  - `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-app/src/pages/KnowledgeBase.tsx`

### Previously changed backend flows worth preserving

- FAQ generation:
  - `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-app/supabase/functions/scrape-and-generate-faqs/index.ts`
  - `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-app/supabase/functions/trigger-n8n-workflow/index.ts`
- Competitor agent review:
  - `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-app/supabase/functions/competitor-agent-review/index.ts`
  - `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-app/supabase/functions/validate-competitors/index.ts`
- Email pipeline:
  - `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-app/supabase/functions/start-email-import/index.ts`
  - `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-app/supabase/functions/pipeline-worker-import/index.ts`
  - `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-app/supabase/functions/pipeline-worker-ingest/index.ts`
  - `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-app/supabase/functions/pipeline-worker-classify/index.ts`
  - `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-app/supabase/functions/pipeline-worker-draft/index.ts`

## Blockers / Risks

1. The repo is still very dirty with many unrelated modified and untracked files. Do not revert unrelated work.
2. The entitlement resolver currently has a permissive legacy fallback:
   - if no subscription row exists, it resolves as a permissive Pro-like workspace
   - this was intentional so current workspaces would not be locked out before billing data exists
3. Because of that fallback, the billing rollout is not truly live until test subscription/add-on rows are seeded.
4. Frontend gating exists locally in this checkpoint, but should be deployed only after the next chat verifies the desired behavior.
5. Backend entitlement enforcement is not yet added to the important edge functions.
6. Stripe webhook sync is not yet implemented.

## Exact Next Recommended Steps

Recommended order from here:

1. Verify repo structure and current git state in the new chat.
2. Read this handoff and the pricing document at:
   - `/Users/michaelcarbon/Projects/BizzyBee/BIZZYBEE_PRICING.md`
3. Seed two test workspaces in Supabase:
   - one `connect`
   - one `starter`
     and add matching add-ons where useful
4. Run end-to-end checks on the new entitlement gates:
   - email import mode options
   - channel toggles
   - AI Phone access
   - Analytics / Knowledge Base access
5. Only after the app behavior looks right:
   - wire Stripe webhooks into `workspace_subscriptions` / `workspace_addons`
6. After Stripe sync:
   - add backend entitlement enforcement to important edge functions
   - then add metered billing wiring

## Assumptions That Must Be Preserved

1. The repo moved; the new real path is:
   - `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-app`
2. The pricing doc is outside the repo at:
   - `/Users/michaelcarbon/Projects/BizzyBee/BIZZYBEE_PRICING.md`
3. The billing table migration is already applied remotely.
4. This checkpoint is intentionally a foundation plus partial gating pass, not a full billing rollout.
5. Do not continue deeper into Stripe/metering until core product stability and the first entitlement checks are verified.

## Bootstrap Prompt For New Chat

Use this in the new chat:

```text
Continue the BizzyBee handoff from the previous Codex session.

The repo now lives at /Users/michaelcarbon/Projects/BizzyBee/bizzybee-app

First:
1. Verify the project structure and git status.
2. Read /Users/michaelcarbon/Projects/BizzyBee/bizzybee-app/HANDOFF.md
3. Read /Users/michaelcarbon/Projects/BizzyBee/BIZZYBEE_PRICING.md

Important context to preserve:
- The billing/entitlement foundation has been built.
- Remote migration 20260411170000_create_workspace_billing_tables.sql is already applied.
- The app now has plan/add-on definitions, entitlement resolution, and a first controlled gating pass.
- Stripe is not wired yet.
- Metered billing is not wired yet.
- The repo is still dirty, so preserve unrelated changes.

Then continue from the handoff's "Exact Next Recommended Steps" section.
```
