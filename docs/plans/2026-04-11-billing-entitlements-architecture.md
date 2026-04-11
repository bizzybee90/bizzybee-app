# BizzyBee Billing & Entitlements Architecture

**Date:** 2026-04-11
**Status:** Proposed foundation
**Source pricing doc:** [BIZZYBEE_PRICING.md](/Users/michaelcarbon/BizzyBee/BIZZYBEE_PRICING.md)

## Goal

Introduce subscription tiers and add-ons without scattering billing logic across the app.

The outcome we want is:

1. Stripe is the payment processor.
2. Supabase is the internal source of truth for workspace entitlements.
3. Frontend and edge functions both ask the same entitlement layer what is allowed.
4. Usage-based billing reads from tracked usage tables instead of ad hoc counters in the UI.

## Recommendation

Do this in four waves.

### Wave 1: Build the entitlement spine

Add a central model for plans and add-ons before touching Stripe webhooks or gating screens.

Deliverables:

- `src/lib/billing/plans.ts`
- `workspace_subscriptions` table
- `workspace_addons` table
- shared backend resolver: `getWorkspaceEntitlements(workspaceId)`
- shared frontend hook: `useEntitlements()`

### Wave 2: Gate the product

Start enforcing access through the shared entitlement layer.

Initial enforcement points:

- onboarding email history choices
- AI draft/classify actions
- WhatsApp AI actions
- SMS AI actions
- AI Phone screens and provisioning
- analytics panels

Important: every gated frontend action also needs backend enforcement.

### Wave 3: Stripe sync

Stripe should update the entitlement tables, not define feature access directly.

Required pieces:

- Stripe products and prices mapped to internal plan/add-on keys
- webhook handler to sync subscription state into Supabase
- one workspace-to-Stripe customer link
- paused / unpaid / canceled handling

### Wave 4: Metered billing

Use tracked usage tables to drive billable overages:

- AI Phone minutes from `ai_phone_usage`
- SMS overage from usage counters we add for outbound SMS
- WhatsApp template pass-through counts

## Why this order is safest

If we wire Stripe first, the app ends up reading raw billing state from too many places.
If we gate UI first without backend enforcement, blocked customers can still hit edge functions directly.
If we finish the entitlement layer first, every later step becomes simpler and safer.

## Proposed Supabase tables

### `workspace_subscriptions`

One row per workspace for the current base plan.

Suggested columns:

- `id uuid primary key`
- `workspace_id uuid not null references workspaces(id) on delete cascade`
- `plan_key text not null`
- `status text not null`
- `stripe_customer_id text`
- `stripe_subscription_id text`
- `stripe_price_id text`
- `current_period_start timestamptz`
- `current_period_end timestamptz`
- `cancel_at_period_end boolean default false`
- `trial_ends_at timestamptz`
- `created_at timestamptz default now()`
- `updated_at timestamptz default now()`

Status should be normalized for app logic, for example:

- `trialing`
- `active`
- `past_due`
- `paused`
- `canceled`

### `workspace_addons`

One row per active add-on for a workspace.

Suggested columns:

- `id uuid primary key`
- `workspace_id uuid not null references workspaces(id) on delete cascade`
- `addon_key text not null`
- `status text not null`
- `stripe_subscription_item_id text`
- `stripe_price_id text`
- `quantity integer default 1`
- `created_at timestamptz default now()`
- `updated_at timestamptz default now()`

Constraint:

- unique `(workspace_id, addon_key)`

### Optional later: `workspace_usage_limits`

Do not build this first unless needed.

For now, included amounts can live in `plans.ts`. Use existing usage tables and only add a separate limits table if you need per-workspace overrides.

## Proposed entitlement shape

Every app surface should be able to consume one resolved object like:

```ts
type WorkspaceEntitlements = {
  plan: 'connect' | 'starter' | 'growth' | 'pro';
  subscriptionStatus: 'trialing' | 'active' | 'past_due' | 'paused' | 'canceled';
  addons: {
    whatsapp_routing: boolean;
    sms_routing: boolean;
    whatsapp_ai: boolean;
    sms_ai: boolean;
    ai_phone: boolean;
  };
  features: {
    unified_inbox: boolean;
    ai_inbox: boolean;
    instagram_dm: boolean;
    facebook_messenger: boolean;
    auto_categorisation: boolean;
    brand_rules: boolean;
    knowledge_base: boolean;
    analytics: boolean;
    advanced_analytics: boolean;
    priority_support: boolean;
  };
  limits: {
    emailHistoryImportLimit: number;
    smsIncluded: number;
    phoneMinutesIncluded: number;
  };
};
```

## Immediate implementation order

1. Add plan/add-on config in code
2. Add `workspace_subscriptions` and `workspace_addons`
3. Build shared entitlement resolver
4. Gate onboarding history options and AI actions
5. Gate add-on channels and AI Phone
6. Then wire Stripe to update those tables

## Testing recommendation

Yes, end-to-end testing can be largely automated from Codex using Playwright and local terminal tooling.

Best setup:

- keep auth on
- use a seeded test account or internal session mint path for test automation
- use a dedicated staging or test workspace for subscription state changes

Do not remove auth globally just to make tests easier.

The stable long-term setup is:

- one seeded test user
- one test workspace
- one script or debug function that resets billing + onboarding state between runs

That lets Codex re-run flows end to end without needing you to click through each time.
