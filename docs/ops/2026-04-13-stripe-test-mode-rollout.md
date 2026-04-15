# BizzyBee Stripe Test-Mode Rollout

Date: 2026-04-13
Branch: `codex/supabase-hardening-control`

## Goal

Wire BizzyBee to Stripe in **test mode only** so we can validate:

- checkout/session creation
- subscription and add-on mapping
- webhook sync into Supabase entitlement tables
- customer portal access
- seeded QA personas against real Stripe object ids

without creating live customers or charges.

## Important safety rule

Do **not** create or mutate live Stripe objects during this wave.

Use only:

- `pk_test_...`
- `sk_test_...`
- test-mode webhook endpoints and signing secrets
- Stripe test cards / subscription scenarios
- Stripe test clocks where useful

## Important account note

The currently connected local Stripe tooling is pointed at:

- `sigfix.uk`

That is **not** the BizzyBee billing account we want to mutate.

Before creating Stripe objects for BizzyBee, verify that the active Stripe dashboard/account is the correct BizzyBee test account.

## What BizzyBee already has

The app-side entitlement spine is already in place:

- `workspace_subscriptions`
- `workspace_addons`
- shared frontend/backend entitlement resolution
- billing test workspace seeding

What is still missing is the Stripe sync layer:

- Stripe product/price ids mapped to internal plan/add-on keys
- Stripe webhook handler that updates the Supabase billing tables
- customer portal / checkout session plumbing

## Current BizzyBee billing model

From `src/lib/billing/plans.ts`:

### Base plans

- `connect` — GBP 19/month
- `starter` — GBP 49/month
- `growth` — GBP 149/month
- `pro` — GBP 349/month

### Add-ons

- `whatsapp_routing` — GBP 15/month
- `sms_routing` — GBP 10/month
- `whatsapp_ai` — GBP 49/month
- `sms_ai` — GBP 29/month
- `ai_phone` — GBP 99/month

### Usage notes already modeled in code

- `sms_ai`
  - includes `50` SMS
  - overage `GBP 0.06`
- `ai_phone`
  - includes `100` minutes
  - overage `GBP 0.30`
- `whatsapp_ai`
  - template-message pass-through currently documented as cost plus `GBP 0.01`

## Recommended Stripe test-mode objects

Create these in Stripe **test mode**:

### Base plan products

- `BizzyBee Connect`
- `BizzyBee Starter`
- `BizzyBee Growth`
- `BizzyBee Pro`

### Base plan monthly prices

Use recurring monthly prices for the first rollout:

- `connect_monthly_gbp`
- `starter_monthly_gbp`
- `growth_monthly_gbp`
- `pro_monthly_gbp`

### Add-on products and prices

- `whatsapp_routing_monthly_gbp`
- `sms_routing_monthly_gbp`
- `whatsapp_ai_monthly_gbp`
- `sms_ai_monthly_gbp`
- `ai_phone_monthly_gbp`

### Why monthly only first

The code-side pricing model is currently monthly only.
We can add annual prices later, but monthly-only test mode is the safest first integration because it reduces mapping complexity while we prove the webhook and entitlement sync path.

## Recommended metadata / lookup key contract

Every Stripe price should have a stable lookup key and metadata:

### Base plans

- lookup key: `bizzybee_plan_connect_monthly`
- metadata:
  - `bizzybee_object_type=plan`
  - `plan_key=connect`

Repeat the same pattern for:

- `starter`
- `growth`
- `pro`

### Add-ons

- lookup key: `bizzybee_addon_whatsapp_routing_monthly`
- metadata:
  - `bizzybee_object_type=addon`
  - `addon_key=whatsapp_routing`

Repeat the same pattern for:

- `sms_routing`
- `whatsapp_ai`
- `sms_ai`
- `ai_phone`

## Env/config contract

### Frontend

- `VITE_STRIPE_PUBLISHABLE_KEY`
  - Stripe test publishable key
  - safe for browser use

### Backend / server-only

- `STRIPE_SECRET_KEY`
  - Stripe test secret key
- `STRIPE_WEBHOOK_SECRET`
  - signing secret for the BizzyBee Stripe webhook endpoint
- `STRIPE_PORTAL_CONFIGURATION_ID`
  - customer portal configuration id from Stripe

## What can be created in 1Password

### Not created by 1Password

These are issued by Stripe and should be stored in 1Password after creation:

- `VITE_STRIPE_PUBLISHABLE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PORTAL_CONFIGURATION_ID`

### Created internally by BizzyBee

These can be generated directly in 1Password because they are ours, not Stripe’s:

- `GDPR_TOKEN_SECRET`
- `OAUTH_STATE_SECRET`
- `GOOGLE_BUSINESS_WEBHOOK_TOKEN`

## Recommended implementation order

1. Confirm the correct BizzyBee Stripe **test** account
2. Create test-mode products and prices
3. Add the Stripe env vars to BizzyBee
4. Build webhook sync to update:
   - `workspace_subscriptions`
   - `workspace_addons`
5. Build customer portal session / checkout session plumbing
6. Use test workspaces and billing seed helpers to verify entitlement changes
7. Only after all of that is green, decide on live-mode rollout

## What I can safely do before the live account is touched

- add the env contract in repo
- build the webhook handler
- build the Stripe-to-Supabase mapping layer
- build portal / checkout session handlers
- build tests around test-mode webhook events and entitlement sync
- keep everything ready for a test-mode key drop-in

## What still needs human/vendor involvement

- confirming the correct Stripe account is BizzyBee, not SigFix
- creating or revealing the Stripe keys / webhook secret / portal config id
- final dashboard-level test-mode object creation if we do it through the dashboard instead of API

## Outcome target

After this wave, BizzyBee should be able to:

- take a Stripe test subscription
- receive Stripe test webhooks
- sync the subscription into Supabase entitlement tables
- expose the correct gated features in app
- open the Stripe customer portal in test mode

with **zero live charging risk**.
