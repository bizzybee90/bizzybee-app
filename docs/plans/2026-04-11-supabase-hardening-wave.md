# Supabase Hardening Wave

## Objective

Harden BizzyBee's Supabase privilege boundary so the entitlement rollout can safely progress beyond `shadow`.

This wave prioritizes:

- workspace isolation
- privileged edge-function auth
- premium execution-path enforcement
- clearly unsafe global admin policy bypasses

Migration parity remains in scope, but as a controlled recovery plan rather than an ad hoc rewrite during the first hardening pass.

## Baseline

- Control branch: `codex/supabase-hardening-control`
- Baseline commit: `d876da9`
- Upstream checkpoint includes:
  - dark-launch entitlement contracts
  - frontend/backend rollout model
  - route/test coverage
  - audit scope and blocker inventory

## Lane Ownership

### Lane 1: Shared Auth

Worktree:

- `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-auth`

Branch:

- `codex/supabase-hardening-auth`

Owned files:

- `supabase/functions/_shared/auth.ts`

Goal:

- Align edge auth with canonical workspace membership.
- Stop relying on `users.workspace_id` as the only source of truth.
- Keep the `validateAuth(req, requestedWorkspaceId?)` surface stable if possible.

### Lane 2: Exposed Functions

Worktree:

- `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-functions`

Branch:

- `codex/supabase-hardening-functions`

Owned files:

- `supabase/functions/meta-sync-channels/index.ts`
- `supabase/functions/inspect-live-state/index.ts`

Goal:

- Remove the highest-risk unauthenticated or weakly-authenticated service-role entry points.

### Lane 3: Premium Privileged Functions

Worktree:

- `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-premium`

Branch:

- `codex/supabase-hardening-premium`

Owned files:

- `supabase/functions/ai-enrich-conversation/index.ts`
- `supabase/functions/document-process/index.ts`
- `supabase/functions/audio-process/index.ts`
- `supabase/functions/image-analyze/index.ts`
- `supabase/functions/draft-verify/index.ts`
- `supabase/functions/_shared/entitlements.ts` if strictly necessary

Goal:

- Remove caller-trusted workspace boundaries.
- Add consistent backend entitlement checks where the path is premium.

### Lane 4: SQL Policy Hardening

Worktree:

- `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-policies`

Branch:

- `codex/supabase-hardening-policies`

Owned files:

- new additive migration(s) under `supabase/migrations/`
- optional supporting audit note under `docs/audits/`

Goal:

- Replace clearly unsafe global admin bypasses on workspace-owned tables with workspace-scoped predicates.
- Do not rewrite old migrations.

### Lane 5: Migration Parity Recovery

Worktree:

- `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-parity`

Branch:

- `codex/supabase-hardening-parity`

Owned files:

- audit or parity docs only unless a narrowly-scoped safe fix becomes obvious

Goal:

- Produce an exact recovery plan for remote/local migration drift.

## Merge Order

1. Shared Auth
2. Exposed Functions
3. Premium Privileged Functions
4. SQL Policy Hardening
5. Migration Parity Recovery docs

After every merge:

- `npm run -s lint:ci`
- `npm run -s typecheck`
- `npm run -s test:run`
- `npm run -s audit:prod`
- `VITE_SUPABASE_URL=https://atukvssploxwyqpwjmrc.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_dummy npm run -s build`

## Release Rule For This Wave

We do not move to `soft` or `hard` billing enforcement until:

- privileged functions no longer trust caller workspace ids
- exposed service-role endpoints are gated or disabled
- shared edge auth matches canonical workspace membership
- clearly unsafe global admin bypasses are removed or narrowed
- migration parity recovery is explicit enough to stop flying blind
