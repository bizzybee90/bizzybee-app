# BizzyBee End-of-Day Release Program

Date: 2026-04-11
Control branch: `codex/release-eod-control`
Control worktree: `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-eod-control`
Checkpoint source: `codex/billing-entitlements-checkpoint`

## Goal

Reach an honest end-of-day `95%` release state for the critical web app by:

- stabilizing structural and data-layer issues
- finishing the critical user flows
- polishing the critical surfaces visually
- getting the verification lane green

This does not mean every experimental or low-priority route is perfect. It means the ship-critical routes are trustworthy, polished, and tested.

## Ship-Critical Routes

- `/auth`
- `/auth/email/callback`
- `/email-auth-success`
- `/onboarding`
- `/`
- `/inbox`
- `/needs-action`
- `/done`
- `/drafts`
- `/sent`
- `/unread`
- `/snoozed`
- `/conversation/:id`
- `/review`
- `/channels`
- `/settings`
- `/knowledge-base`
- `/analytics`
- `/ai-phone`
- `/reviews`

## De-Prioritized Today

If time gets tight, these routes should be hidden, deferred, or left alone unless they block a ship-critical flow:

- `/activity`
- `/learning`
- `/diagnostics`
- `/webhooks`
- admin and devops-only surfaces

## Lane Overview

Each lane owns a disjoint write set. Workers must not edit outside their lane without controller approval.

### Lane 1: Structural and Data

Branch: `codex/release-eod-structural`
Worktree: `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-eod-structural`

Owns:

- `supabase/migrations/**`
- `supabase/functions/**` when the change is required for schema, grants, RLS, or data flow correctness
- `src/integrations/supabase/**`
- query callsites only when needed to resolve schema drift

Primary targets:

- resolve `email_import_progress.completed_at` mismatch
- fix `inbox_insights` permission failures
- fix `triage_corrections` permission failures
- remove other obvious ship-critical `400` and `403` data-layer faults

Definition of done:

- no known schema or permission drift on ship-critical routes
- any migration is minimal, reversible in logic, and documented in commit notes

### Lane 2: Auth, Onboarding, and Entitlements

Branch: `codex/release-eod-auth`
Worktree: `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-eod-auth`

Owns:

- `src/components/AuthGuard.tsx`
- `src/components/ProtectedRoute.tsx`
- `src/contexts/**`
- `src/pages/Auth.tsx`
- `src/pages/EmailAuthSuccess.tsx`
- `src/pages/Onboarding.tsx`
- entitlement helpers when required for truthful gating

Primary targets:

- no redirect loops
- no false onboarding traps
- no stale workspace state after onboarding completion
- truthful plan gating across critical routes

Definition of done:

- guest, seeded `connect`, seeded `starter`, and real workspace all navigate correctly
- gated routes either work or lock intentionally

### Lane 3: Core Product

Branch: `codex/release-eod-core`
Worktree: `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-eod-core`

Owns:

- core inbox and home surfaces under `src/pages`
- core conversation and review components under `src/components`
- loading, empty, and error states for those flows

Primary targets:

- home and inbox feel stable in daily use
- conversation detail does not break
- review flow is trustworthy

Definition of done:

- a user can land, inspect work, and move through the core workflow without breakage

### Lane 4: Modules

Branch: `codex/release-eod-modules`
Worktree: `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-eod-modules`

Owns:

- `/channels`
- `/settings`
- `/knowledge-base`
- `/analytics`
- `/ai-phone`
- `/reviews`

Primary targets:

- each module is either fully working or cleanly locked
- no route-level crashes
- settings and channels feel product-grade

Definition of done:

- every route in this lane either behaves correctly or presents a truthful upsell or setup state

### Lane 5: QA and Verification

Branch: `codex/release-eod-qa`
Worktree: `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-eod-qa`

Owns:

- `eslint.config.js`
- `vitest.config.ts`
- frontend test files
- smoke test scaffolding
- verification docs if needed

Primary targets:

- fix `npm run lint:ci`
- fix `npm run test:run`
- add one checked-in smoke lane for critical web flows

Definition of done:

- `npm run lint:ci`
- `npm run typecheck`
- `npm run test:run`
- `npm run build`
- `npm run audit:prod`

all pass in the control branch after merges

### Lane 6: UI and Polish

Branch: `codex/release-eod-ui`
Worktree: `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-eod-ui`

This lane starts only after the first structural merge.

Owns:

- shell polish
- responsive cleanup
- spacing and typography cleanup
- loading, empty, and error states that are not coupled to deep logic
- copy refinement on critical surfaces

Primary targets:

- make the critical surfaces feel deliberate and release-quality
- remove obvious rough edges that undermine trust

Definition of done:

- desktop and mobile widths both look intentional on ship-critical routes

## Validation Commands

Run from the active worktree root:

```bash
npm run lint:ci
npm run typecheck
npm run test:run
npm run build
npm run audit:prod
```

Additional manual smoke expectation:

- guest auth flow
- seeded `connect`
- seeded `starter`
- real workspace

Check each of those against:

- onboarding
- home and inbox
- channels
- settings
- knowledge base
- analytics
- ai phone

## Merge Rules

- only the control worktree integrates branches
- workers do not merge each other
- workers do not revert unrelated work
- each worker hands back:
  - files changed
  - commands run
  - what they verified
  - what still looks risky

After every merge into `codex/release-eod-control`:

1. run the full validation commands
2. smoke the affected routes
3. only then merge the next lane

## Timeline

### Wave 1

- structural and data
- auth and onboarding
- core product
- modules
- qa and verification

### Wave 2

- integrate wave 1
- ui and polish
- backflow bug fixes from qa

### Final Wave

- full regression pass
- desktop and mobile visual pass
- signoff on what is shipped, hidden, or deferred

## Non-Negotiable Principle

If a route is not ready, it must be hidden or turned into a truthful locked or setup state. It cannot remain as a broken half-feature and still count toward end-of-day `95%`.
