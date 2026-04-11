# Supabase Hardening Audit Scope

## Purpose

Run a thorough Supabase audit after the dark-launch entitlements integration is merged.

This audit is intended to answer:

- Can every authenticated user only see their own workspace data?
- Are grants and RLS policies internally consistent?
- Do security definer functions bypass workspace isolation accidentally?
- Are edge functions reading and writing through the intended privilege boundary?
- Is migration history coherent enough to keep shipping safely?

## Audit Areas

### 1. Workspace Isolation

- Verify the canonical workspace access helpers:
  - `public.bb_user_in_workspace(uuid)`
  - `public.user_has_workspace_access(uuid)`
- Compare usage across:
  - RLS policies
  - RPCs
  - security definer functions
  - edge-function assumptions
- Look for older access patterns still using:
  - `users.workspace_id`
  - `user_roles`
  - `workspace_members`
  - `workspaces.owner_id`
  - `workspaces.created_by`

### 2. RLS and Grants

- Inventory all tables in `public`.
- For each table, capture:
  - RLS enabled or not
  - select/insert/update/delete policies
  - grants to `authenticated`
  - grants to `service_role`
- Flag:
  - duplicate policies
  - contradictory policies
  - broad grants without matching RLS intent
  - tables used by the app that still lack authenticated read policies

### 3. Security Definer Functions

- Inventory all `security definer` functions.
- Verify each has:
  - safe `search_path`
  - clear workspace scoping
  - no hidden privilege escalation
- Flag functions that:
  - return cross-workspace data
  - trust caller-provided workspace ids without checking membership
  - mutate protected tables without service-role intent

### 4. Billing Tables

- Audit:
  - `workspace_subscriptions`
  - `workspace_addons`
  - any future `workspace_billing_overrides`
  - any usage tables tied to SMS, phone, or templates
- Verify:
  - row ownership
  - grants
  - policy coverage
  - Stripe ID storage consistency
  - addon uniqueness and status handling

### 5. Premium Execution Paths

- Audit edge functions that could bypass UI gates.
- Confirm each premium function either:
  - is safely behind service-role-only orchestration
  - or explicitly checks workspace entitlements
- Prioritize:
  - AI phone
  - WhatsApp AI
  - SMS AI
  - analytics materialization
  - knowledge-base write/generation flows

### 6. Migration Hygiene

- Compare local migration files against remote history.
- Identify:
  - remote-only migrations
  - local-only migrations
  - mismatched filenames for identical versions
  - one-off hotfixes that were applied outside normal workflow
- Produce a recommendation for restoring clean parity without rewriting working history recklessly.

### 7. Operational Safety

- Check whether sensitive functions log enough context for debugging:
  - workspace id
  - user id
  - request id
  - feature/add-on key where relevant
- Identify missing observability around failed RLS, premium enforcement, and webhook sync.

## Evidence To Collect

- `supabase migration list --linked`
- schema inventory
- policy inventory
- grants inventory
- security definer function inventory
- edge-function entitlement touchpoint inventory
- top-risk findings with exact table/function names

## Expected Output

- Risk-ranked findings list
- tables/functions that are safe
- tables/functions that need hardening
- migration parity recommendation
- rollout blocker vs non-blocker distinction

## Release Rule

Before live hard enforcement is enabled, the audit must conclude:

- no cross-workspace data exposure on authenticated flows
- no known premium execution path bypasses
- no blocker-level migration drift
