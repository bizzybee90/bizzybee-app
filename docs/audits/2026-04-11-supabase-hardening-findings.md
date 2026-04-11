# Supabase Hardening Findings

## Status

This is the deeper blocker and P1 finding set captured after the dark-launch entitlements integration landed on `codex/entitlements-dark-launch-control`.

The conclusion is straightforward:

- BizzyBee's billing model is now much more coherent.
- The bigger remaining risk is privileged Supabase execution and workspace isolation.
- `soft` and `hard` billing rollout should not proceed until these blockers are addressed.

## Blockers

### 1. Global admin role is not workspace-scoped

Affected files:

- `supabase/migrations/20251118110326_7dc90103-90eb-4325-8a79-264ed70326f5.sql`
- `supabase/migrations/20251127135744_f266582d-cce7-43a6-b6b1-687cf6453175.sql`
- `supabase/migrations/20251127140308_0f6c8ddf-5984-4a97-a53a-2c6b8c7eb596.sql`
- `supabase/migrations/20251127181536_7241c9ae-1465-47a0-a320-28ba35d1ed45.sql`

Why it matters:

- `public.user_roles` is global and has no `workspace_id`.
- `public.has_role()` is therefore global too.
- Several workspace-owned tables trust that global admin check for `FOR ALL` access.
- One global admin can potentially operate across unrelated workspaces.

Required fix:

- Replace global `has_role()` checks on workspace-owned tables with workspace-scoped membership/admin helpers.
- Or add `workspace_id` to the role model and update the policies to require matching workspace scope.

Rollout impact:

- `shadow`: blocker
- `soft`: blocker
- `hard`: blocker

### 2. `meta-sync-channels` is effectively unauthenticated

Affected files:

- `supabase/functions/meta-sync-channels/index.ts`
- `src/integrations/supabase/types.ts`

Why it matters:

- The function accepts `workspace_id` from the request body.
- It instantiates a service-role client.
- It reads `meta_provider_configs`, decrypts tokens, and writes `workspace_channels`.
- It does not verify the caller's workspace membership first.

Required fix:

- Require authenticated user context.
- Resolve workspace access server-side through the canonical membership helper.
- Reject caller-supplied workspace ids unless verified.
- Keep token decryption behind tightly controlled server-only flows.

Rollout impact:

- `shadow`: blocker
- `soft`: blocker
- `hard`: blocker

### 3. `ai-enrich-conversation` can cross workspace boundaries

Affected file:

- `supabase/functions/ai-enrich-conversation/index.ts`

Why it matters:

- The function accepts arbitrary `conversation_id` and `workspace_id`.
- It fetches the conversation by `id` only.
- It uses weak service-role detection with `authHeader.includes(service_role_key)`.
- It can execute privileged AI enrichment with workspace-specific context without canonical workspace verification.

Required fix:

- Use exact bearer validation.
- Fetch the conversation by both `id` and verified workspace scope.
- Derive workspace from the record rather than the request body.
- Add `requireEntitlement(...)` before premium AI execution.

Rollout impact:

- `shadow`: blocker
- `soft`: blocker
- `hard`: blocker

### 4. Several service-role AI and knowledge functions trust caller `workspace_id`

Affected files:

- `supabase/functions/document-process/index.ts`
- `supabase/functions/audio-process/index.ts`
- `supabase/functions/image-analyze/index.ts`
- `supabase/functions/draft-verify/index.ts`

Why it matters:

- These functions run privileged reads and writes using the service role.
- The workspace boundary is still driven by request payload.
- They validate that a JWT exists, but do not consistently resolve the allowed workspace server-side.

Required fix:

- Standardize privileged function auth.
- Validate user identity.
- Resolve accessible workspace on the server.
- Reject mismatched body `workspace_id`.
- Add backend entitlement guards where the path is premium.

Rollout impact:

- `shadow`: blocker
- `soft`: blocker
- `hard`: blocker

### 5. Edge auth helper is not aligned with SQL access helpers

Affected files:

- `supabase/functions/_shared/auth.ts`
- `supabase/migrations/20260411201500_eod_structural_schema_repairs.sql`

Why it matters:

- `_shared/auth.ts` still relies on `public.users.workspace_id`.
- SQL helpers now consider `workspace_members`, `users.workspace_id`, `workspaces.owner_id`, and `workspaces.created_by`.
- Edge functions and RLS can disagree about who belongs to a workspace.

Required fix:

- Make the SQL helper the single source of truth.
- Update shared edge auth to mirror or call `bb_user_in_workspace(...)`.
- Remove legacy `users.workspace_id` assumptions from privileged paths.

Rollout impact:

- `shadow`: not a blocker
- `soft`: blocker
- `hard`: blocker

### 6. Migration parity is materially broken

Affected paths:

- `supabase/migrations/`
- `src/integrations/supabase/types.ts`
- `supabase/functions/meta-sync-channels/index.ts`
- `supabase/functions/retell-call-stats/index.ts`
- `supabase/functions/elevenlabs-provision/index.ts`

Why it matters:

- `supabase migration list --linked` shows `43` remote-only migrations between March and April 2026.
- Local code and generated types depend on live objects not created anywhere locally.
- Examples include:
  - `ai_phone_usage`
  - `call_logs`
  - `elevenlabs_agents`
  - `meta_provider_configs`
  - Meta token RPCs
- Local `workspace_channels` constraints are behind the live app behavior.

Required fix:

- Reconstruct and commit the missing live migrations.
- Do not treat the repo as authoritative again until local migrations reproduce live schema, grants, functions, and RLS.

Rollout impact:

- `shadow`: not a blocker
- `soft`: blocker
- `hard`: blocker

### 7. Entitlement guard coverage is incomplete on premium execution paths

Affected paths:

- `supabase/functions/_shared/entitlements.ts`
- `supabase/functions/send-reply/index.ts`
- `supabase/functions/retell-call-stats/index.ts`
- `supabase/functions/elevenlabs-provision/index.ts`
- `supabase/functions/ai-enrich-conversation/index.ts`
- `supabase/functions/document-process/index.ts`
- `supabase/functions/audio-process/index.ts`
- `supabase/functions/image-analyze/index.ts`
- `supabase/functions/draft-verify/index.ts`

Why it matters:

- Some paid paths now use the shared billing snapshot.
- Several premium AI and knowledge flows still do not.
- That means shadow telemetry is incomplete, soft locks are bypassable, and hard enforcement would be inconsistent.

Required fix:

- Inventory every premium execution path.
- Require the shared backend entitlement guard on all of them before rollout.

Rollout impact:

- `shadow`: blocker
- `soft`: blocker
- `hard`: blocker

### 8. `inspect-live-state` is a deployed debug-token data leak

Affected file:

- `supabase/functions/inspect-live-state/index.ts`

Why it matters:

- The function uses a hardcoded `x-debug-token`.
- It performs service-role reads over `users`, `workspaces`, and `business_context`.
- If deployed, it bypasses RLS and exposes cross-workspace data.

Required fix:

- Remove or disable it in deployed environments.
- If inspection tooling is still needed, require verified admin auth, explicit environment gating, and audited access logs.

Rollout impact:

- `shadow`: blocker
- `soft`: blocker
- `hard`: blocker

## Recommended Hardening Order

1. Disable or secure `inspect-live-state`.
2. Lock down `meta-sync-channels`.
3. Align `_shared/auth.ts` with canonical SQL workspace membership.
4. Fix cross-workspace privileged AI and knowledge functions.
5. Finish backend entitlement guard coverage.
6. Restore local and remote migration parity.
7. Re-audit RLS and grants after parity is restored.

## Release Rule

Before enabling live hard enforcement:

- no cross-workspace authenticated data exposure
- no premium execution path bypasses
- no blocker-level migration drift
