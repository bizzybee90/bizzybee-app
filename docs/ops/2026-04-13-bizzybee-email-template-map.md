# BizzyBee Email Template Map

## Goal

Keep every customer email owned by the right system so launch behavior is predictable:

- `Supabase Auth` for authentication emails
- `Resend` for BizzyBee-branded lifecycle and operational emails
- `Stripe` for receipts, invoices, and payment-method billing surfaces that should come from Stripe directly

## Current ownership

### Supabase Auth

These should stay in Supabase Auth unless we later outgrow the defaults or need fully custom auth flows:

- Magic link / sign-in email
- Password recovery
- Email verification
- Team invite / invite acceptance if we enable workspace invites through Supabase Auth

Notes:

- These are account-access emails, not product-lifecycle emails.
- They should still use BizzyBee branding and the `bizzyb.ee` domain where supported by Supabase.

### Resend

These should be BizzyBee-owned templates because they describe the product state, onboarding, or account status:

- `signup_welcome`
- `workspace_ready`
- `onboarding_ready`
- `billing_subscription_started`
- `billing_subscription_updated`
- `billing_cancellation_scheduled`
- `billing_subscription_cancelled`
- `billing_payment_failed`
- `account_deleted_confirmation`

Implementation source of truth:

- `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-control/supabase/functions/_shared/resend.ts`

### Stripe

These should stay native to Stripe for v1 because Stripe is already strong at them and customers expect those documents to be canonical:

- Payment receipts
- Paid invoices
- Card / payment-method update requests
- Tax / invoice PDFs

Notes:

- BizzyBee should still send its own high-level lifecycle emails around billing changes.
- Stripe remains the system of record for receipt/invoice document delivery.

## Recommended launch set

### Must-have at launch

- Magic link / verification
- Welcome email
- Onboarding complete
- Subscription started
- Subscription updated
- Cancellation scheduled
- Subscription cancelled
- Stripe receipts / invoices

### Strongly recommended

- Payment failed
- Account deleted confirmation
- Workspace ready / long-running setup completion

### Later if needed

- Trial ending reminder
- Add-on specific activation email
- Failed channel provisioning summary
- Manual support follow-up templates

## Tone guidance

BizzyBee should not inherit SigFix’s exact wording, but the same structural rules are useful:

- one job per email
- explain what happened
- explain what happens next
- keep the CTA singular
- reduce anxiety around billing changes
- avoid startup-generic hype

For BizzyBee specifically, emails should feel:

- calm
- premium
- capable
- operationally clear
- slightly warm, not chatty

## Open follow-ups

- Subscribe Stripe webhook to failed-invoice events before turning on `billing_payment_failed`
- Confirm Supabase Auth sender/domain branding uses `bizzyb.ee`
- Add deletion-confirmation trigger once the destructive account-delete flow is finalized
