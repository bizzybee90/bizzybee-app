# Dark-Launch Entitlements Wave

## Objective

Build BizzyBee's subscription architecture to release quality without letting billing gates destabilize product testing.

This wave is intentionally a dark launch:

- build the plan/add-on model fully
- wire entitlement evaluation across frontend and backend
- add logging, auditability, and seeded personas
- keep hard enforcement off until the regression matrix is green

## Rollout Modes

Use one shared activation ladder across frontend and backend:

- `legacy`
  - current behavior
  - permissive fallbacks still allowed
- `shadow`
  - compute entitlements everywhere
  - log what would have been blocked
  - do not block
- `soft`
  - show lock and upsell states in UI
  - backend still supports tester overrides and controlled bypass
- `hard`
  - frontend and backend both enforce

## Global Rules

- `codex/entitlements-dark-launch-control` is the integration branch.
- All lane branches start from commit `f663e1d`.
- Agents own only the files in their lane.
- No agent should revert or "clean up" unrelated changes.
- No lane should enable hard enforcement by default.
- Any new blocking behavior must be behind a rollout mode or workspace override.

## Lane 1: Contracts

### Goal

Create the shared source of truth for entitlement behavior and rollout state.

### Owned files

- `src/lib/billing/**`
- `src/hooks/useEntitlements.ts`
- `src/contexts/WorkspaceContext.tsx`
- `src/contexts/workspace-context.ts`
- `src/test/**` only where entitlement fixtures are needed

### Deliverables

- Add an explicit `BillingEnforcementMode` type.
- Add resolved fields that distinguish:
  - `isAllowed`
  - `wouldBlock`
  - `rolloutMode`
  - `source`
- Remove hidden ambiguity from the current permissive fallback shape.
- Add workspace override support in the resolved model.
- Add fixture builders for:
  - `connect`
  - `starter`
  - `growth`
  - `pro`
  - add-on combinations
- Keep default behavior safe for testing:
  - `shadow` or `legacy`, not `hard`

### Non-goals

- No route refactors
- No Stripe webhook logic
- No edge-function enforcement

## Lane 2: Backend Guards

### Goal

Create shared backend guard helpers and attach them to paid execution paths in shadow mode first.

### Owned files

- `supabase/functions/_shared/entitlements.ts`
- `supabase/functions/_shared/auth.ts` only if required
- Paid execution functions that actually perform premium actions

### First-pass target functions

- AI phone related functions
- WhatsApp AI send/automation paths
- SMS AI send/automation paths
- Any premium analytics or knowledge-base write path that is actually callable directly

### Deliverables

- Add helpers like:
  - `getWorkspaceBillingSnapshot(...)`
  - `evaluateEntitlementGuard(...)`
  - `requireEntitlement(...)`
- Support rollout modes:
  - `shadow`: log and allow
  - `soft`: log and allow for tester override workspaces
  - `hard`: reject with structured error
- Emit structured logs with:
  - workspace id
  - feature/add-on key
  - rollout mode
  - would-block result
  - override source

### Non-goals

- No Stripe customer syncing yet
- No metered billing

## Lane 3: Frontend Gating

### Goal

Make all plan-aware UI consistent while keeping hard gates staged.

### Owned files

- `src/components/ProtectedRoute.tsx`
- `src/App.tsx`
- `src/components/sidebar/Sidebar.tsx`
- `src/pages/AiPhone.tsx`
- `src/pages/AnalyticsDashboard.tsx`
- `src/pages/KnowledgeBase.tsx`
- `src/components/settings/ChannelManagementPanel.tsx`
- `src/components/settings/KnowledgeBasePanel.tsx`
- onboarding components that surface plan-aware messaging

### Deliverables

- Introduce one shared lock-state pattern for modules.
- Support three UI states:
  - available
  - shadow-preview
  - locked
- In `shadow`, surface internal/testing cues without blocking navigation.
- In `soft`, show truthful upgrade UI while preserving tester bypass.
- Normalize upsell copy and lock layout across modules.

### Non-goals

- No new business pricing
- No direct Stripe calls

## Lane 4: Stripe Mapping

### Goal

Prepare Stripe integration inputs without making Stripe the source of truth.

### Owned files

- `src/lib/billing/**` only if coordinated with Contracts lane
- Stripe-related edge functions or docs if already present
- new mapping docs/config if needed

### Deliverables

- Define canonical mapping from Stripe price IDs to:
  - `plan_key`
  - `addon_key`
- Document webhook-to-Supabase sync contract.
- Ensure the app reads Supabase entitlements, not raw Stripe objects.
- Produce a clear list of missing Stripe objects or env values.

### Non-goals

- No live webhook enforcement switch
- No charging enablement

## Lane 5: QA

### Goal

Prove the dark-launch behavior is reliable before any hard enforcement.

### Owned files

- `src/test/**`
- billing and route smoke tests
- any small test-only helper files

### Deliverables

- Persona matrix coverage for:
  - `connect`
  - `starter`
  - `growth`
  - `pro`
  - `starter + ai_phone`
  - `starter + sms_ai`
  - `connect + sms_routing`
- Add tests for:
  - route visibility
  - module lock rendering
  - shadow-mode non-blocking behavior
  - backend guard contract where possible
- Document the manual regression sweep.

### Required route matrix

- `/`
- `/onboarding`
- `/settings`
- `/knowledge-base`
- `/analytics`
- `/ai-phone`
- channel management surfaces

## Integration Order

1. Contracts
2. Backend Guards
3. Frontend Gating
4. QA
5. Stripe Mapping

Merge one lane at a time into control and rerun:

- `npm run lint:ci`
- `npm run typecheck`
- `npm run test:run`
- `npm run build`
- `npm run audit:prod`

## Final Hardening Gate

After dark-launch integration is green, run a thorough Supabase audit focused on:

- RLS consistency
- grants and role access
- security definer functions
- workspace isolation helpers
- policy duplication and drift
- high-risk tables and edge functions
- migration hygiene and remote/local parity

That audit is a dedicated hardening pass, not a side quest during this integration wave.
