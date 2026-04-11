# Policy Lane Note: Workspace-Scoped Admin Hardening

## What this lane hardened

Migration `20260411214500_workspace_scoped_admin_policy_hardening.sql` replaces clearly unsafe legacy global role predicates on these workspace-owned tables:

- `workspace_channels`
- `sla_configs`
- `business_facts`
- `price_list`
- `faq_database` (or legacy `faqs` fallback)

The hardened predicates now require both:

- workspace membership via `public.bb_user_in_workspace(workspace_id)`
- legacy role check (`admin` or `manager` where historically required)

## Why this is safe and additive

- does not rewrite or edit old migrations
- uses `DROP POLICY IF EXISTS` on legacy policy names only
- creates new scoped policy names
- conditionally applies per table so it can run safely across partially-drifted environments

## Remaining ambiguous follow-up

- `public.user_roles` is still globally scoped and has no `workspace_id`
- role assignment semantics (global `admin` / `manager`) remain cross-workspace by model, now constrained by membership checks on the hardened tables
- a fuller least-privilege pass may still want a workspace-scoped role model (or explicit workspace-role helper) to remove global role ambiguity altogether
