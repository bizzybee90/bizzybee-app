# BizzyBee Channel Production Brief

**Date:** 2026-04-12  
**Branch baseline:** `codex/supabase-hardening-control`  
**Purpose:** drive BizzyBee from strong architecture to channel-complete production quality before live Stripe wiring

## Executive summary

BizzyBee should now optimize for **channel excellence**, not new billing or agent experimentation.

The next wave should make the product feel complete for the businesses we actually want to serve:

- email as the flagship written channel
- AI phone as the second flagship channel
- SMS and WhatsApp as reliable Twilio-backed companion channels
- Meta messaging as the growth pillar
- Google as a **Reviews + Business Profile** pillar, not a messaging pillar

Stripe remains deferred in this wave. Pricing and entitlement architecture already exist and should only be expanded enough to support testing and safe gating.

## Strategy decisions

### 1. Primary channels

- `email` remains the most trusted and most complete channel
- `phone` becomes the second flagship channel

These two channels must reach the highest standard for:

- setup
- inbound reliability
- outbound reliability
- review/escalation
- analytics and auditability
- supportability

### 2. SMS and WhatsApp operating model

Do **not** assume small businesses want to port or migrate their current number during onboarding.

Default v1 model:

- BizzyBee provisions a new Twilio-backed SMS number
- BizzyBee provisions a new WhatsApp-capable sender/number path
- BizzyBee explains this clearly in onboarding and channel setup

Advanced path for later:

- bring-your-own-number
- number hosting/porting where supported
- WhatsApp sender migration

This means product and ops should optimize for a **BizzyBee-managed number default**, not migration-first onboarding.

### 3. Meta strategy

Meta remains a core growth pillar.

Current product direction should be:

- Facebook Messenger
- Instagram DMs
- future WhatsApp-on-Meta abstraction

Current reality:

- Facebook Messenger and Instagram are already the real Meta channels in the repo
- WhatsApp-via-Meta is not implemented yet
- the existing Meta connect flow is strong, but still needs safer multi-page selection and cleaner product separation from Google

We should keep the app surface channel-agnostic enough that WhatsApp can move from a Twilio-backed setup to a Meta-backed setup later without rewriting the whole product model.

### 4. Google strategy

Google Business Messages should not be treated as a strategic messaging channel in this build.

Google work should instead focus on:

- Business Profile connection
- location selection
- review sync
- review inbox
- reply drafting and publishing
- alert policy
- ownership/assignment
- profile operations where policy allows

The target customer is service businesses, owner-operators, and small teams. For them, reviews and profile operations matter far more than chat.

### 5. Billing strategy

- keep entitlements and gating in place
- continue using Supabase as the source of truth
- do **not** wire live Stripe products, webhooks, or charging in this wave
- only start Stripe once channels and reviews are operationally signed off

## Product goals for this wave

By the end of this wave, BizzyBee should feel like:

- a complete email product
- a complete AI phone product
- a trustworthy messaging product for SMS, WhatsApp, Messenger, and Instagram
- a serious reviews/product-presence product for Google

## Workstreams

### Workstream 1: AI Phone to flagship quality

**Goal:** Make AI Phone truly production-ready.

Deliverables:

- provisioning flow works cleanly end to end
- ElevenLabs agent creation and Twilio number purchase path are verified against real secrets/config
- webhook path is fail-closed once secrets are present
- onboarding and configuration UX are polished
- call logs, call outcomes, follow-up signals, and usage tracking are trustworthy
- live smoke scenario exists for real provisioning and at least one real or staged post-call event

Definition of done:

- workspace can provision AI Phone from the product
- workspace can activate/deactivate it
- post-call webhook is authenticated and writes expected data
- entitlement gating is correct
- errors are understandable and recoverable

### Workstream 2: Twilio SMS and WhatsApp operationalization

**Goal:** Turn Twilio-backed channels into a productized setup flow, not an ops-only setup.

Deliverables:

- clear default provisioning path for SMS
- clear default provisioning path for WhatsApp
- updated channel setup UX that distinguishes:
  - BizzyBee-managed number
  - advanced migration / BYON path
- reliable inbound routing via `workspace_channels`
- reliable outbound sending
- fail-closed webhook verification
- internal docs/runbooks for Twilio operations
- explicit explanation of what is self-serve now versus what remains an advanced migration path

Definition of done:

- a new workspace can enable SMS without manual guesswork
- a new workspace can enable WhatsApp without assuming they must sacrifice their existing app setup on day one
- support and product copy explain the operational model honestly
- phone, SMS, and WhatsApp no longer feel like three unrelated setup models

### Workstream 3: Meta messaging excellence

**Goal:** Make Facebook Messenger and Instagram DMs production-strong and preserve a future path for WhatsApp on Meta.

Deliverables:

- polished account-linking UX for Meta channels
- safer selection behavior when the connected Meta account has multiple Pages/assets
- clearer setup and health states
- robust inbound/outbound messaging confidence
- explicit abstraction/documentation for future WhatsApp-on-Meta channel ownership
- reduced product confusion between Twilio WhatsApp and future Meta WhatsApp

Definition of done:

- Messenger and Instagram are self-serve enough for a real customer setup
- the product communicates clearly what is “ready,” “needs setup,” and “future”
- channel architecture does not trap us in a Twilio-only WhatsApp mental model
- Meta no longer shares muddy setup language with Google

### Workstream 4: Google Reviews and Business Profile

**Goal:** Make Google a meaningful service-business module.

Deliverables:

- stop positioning Google primarily as messaging
- connect Business Profile/account flow
- location selection flow
- review sync / ingestion model
- review inbox and draft/publish reply flow
- alert policy and ownership workflow
- profile operations backlog split into:
  - safe for this wave
  - later enhancement
- durable schema for live reviews, replies, and sync state rather than preview-only state

Definition of done:

- reviews module no longer feels like a preview shell
- a service business can connect Google, see locations, manage reviews, and act on them
- the go-live checklist is real, not decorative
- the product boundary is explicit: Channels owns messaging, Reviews owns profile/reviews

### Workstream 5: Channel-grade QA and release hardening

**Goal:** Make non-email channels feel as trustworthy as email.

Deliverables:

- real workspace regression checklist for:
  - email
  - phone
  - SMS
  - WhatsApp
  - Messenger
  - Instagram
  - Google reviews/profile
- end-to-end or smoke coverage where realistic
- provider secret audit and fail-closed audit
- release checklist for Pages deploy parity and rollback
- operational runbooks for queue failures, webhook failures, and provisioning failures

Definition of done:

- every supported channel has a known happy path and a known failure path
- we can explain how to debug each one
- support does not need tribal knowledge to understand what happened

## Multi-agent build recommendation

Yes. There is enough background knowledge and code structure now to run this as a multi-agent build.

### Control lane

**Owner:** main control thread  
**Responsibility:** prioritization, merges, integration testing, release decisions

Control lane owns:

- `docs/plans/**`
- merge order
- branch hygiene
- final regression matrix
- release summary and go/no-go decisions

### Lane A: Phone + Twilio provisioning

**Focus:** AI Phone, Twilio provisioning strategy, SMS/WhatsApp setup defaults

Primary ownership:

- `src/pages/AiPhone.tsx`
- `src/components/ai-phone/OnboardingWizard.tsx`
- `src/components/ai-phone/PhoneSettingsForm.tsx`
- `src/hooks/useAiPhoneConfig.ts`
- `src/hooks/useChannelSetup.ts`
- `src/lib/channels.ts`
- `supabase/functions/elevenlabs-provision/**`
- `supabase/functions/elevenlabs-update-agent/**`
- `supabase/functions/elevenlabs-webhook/**`
- `supabase/functions/twilio-sms-webhook/**`
- `supabase/functions/twilio-whatsapp-webhook/**`
- `supabase/functions/send-reply/**` for SMS/WhatsApp only

Key output:

- productized channel provisioning model for phone, SMS, and WhatsApp
- fail-closed and smoke-tested AI Phone + Twilio transport stack

### Lane B: Meta messaging polish

**Focus:** Facebook Messenger, Instagram, future WhatsApp-on-Meta readiness

Primary ownership:

- `supabase/functions/meta-auth-start/**`
- `supabase/functions/meta-auth-callback/**`
- `supabase/functions/meta-sync-channels/**`
- `supabase/functions/meta-refresh-tokens/**`
- `supabase/functions/meta-data-deletion-callback/**`
- `supabase/functions/facebook-messenger-webhook/**`
- `supabase/functions/instagram-webhook/**`
- Meta branch in `supabase/functions/send-reply/**`
- Meta-related channel setup UI
- any shared Meta token/config helpers

Key output:

- production-grade Meta messaging experience and a clear future abstraction for WhatsApp on Meta
- safer page/account selection and clearer provider ownership

### Lane C: Google Reviews/Profile

**Focus:** reviews module, Google account/location model, review operations

Primary ownership:

- `src/pages/Reviews.tsx`
- `src/lib/reviews.ts`
- `src/pages/ChannelsDashboard.tsx`
- `src/pages/Settings.tsx`
- review-related hooks/components
- `supabase/functions/google-places-autocomplete/**`
- any review sync/reply helpers
- location/profile connection flows

Key output:

- Google Reviews/Profile module that is valuable to service businesses
- explicit separation from legacy Google messaging transport

### Lane D: QA + release hardening

**Focus:** tests, smoke coverage, runbooks, release proof

Primary ownership:

- `src/test/**`
- affected feature tests across onboarding/channels/reviews/phone
- release docs
- runbooks/checklists

Key output:

- evidence that the channels and reviews module are genuinely production-strong

## Sequencing

### Phase 1

- lock channel/product strategy
- define provisioning defaults and customer-facing copy
- align product language to the real provider model

### Phase 2

- finish AI Phone
- productize Twilio-backed SMS and WhatsApp setup
- harden Meta setup and messaging flows

### Phase 3

- build out Google Reviews/Profile module
- connect location/reply/alerts workflows

### Phase 4

- run full channel-grade QA
- fix edge-case failures
- achieve frontend deploy parity

### Phase 5

- only after channel signoff, start Stripe product mapping and live sync work

## Non-goals for this wave

- no live Stripe charging rollout
- no full Stripe webhook/payment integration
- no new experimental orchestration architecture
- no resurrection of deprecated Google messaging strategy
- no assumption that BYON/porting is the default onboarding path

## Open questions to resolve during implementation

These should be resolved inside the wave, not before starting it:

- exact SMS provisioning UX for BizzyBee-managed numbers
- exact WhatsApp sender onboarding path in the Twilio-backed phase
- which Google Business Profile fields are safe and worthwhile to edit directly in-app
- how much of Meta/WhatsApp future abstraction should be code now vs architecture docs now

## Known production risks at the start of the wave

- Twilio transport is strong in code, but the install story is still too ops-dependent for SMS and WhatsApp
- AI Phone webhook auth is only fail-closed once `ELEVENLABS_WEBHOOK_SECRET` is provisioned
- Meta is real for Messenger and Instagram, but WhatsApp-via-Meta is still future architecture, not shipped functionality
- Meta setup can still attach the wrong page/account in multi-asset scenarios if we keep the current first-match behavior
- Google Reviews currently has a strong shell but not yet the durable live sync/reply data model needed for a fully live module
- Google Business messaging must not be allowed to muddy the Reviews product direction

## Production target

If this wave lands well, BizzyBee should move from “strong architecture with partial installs” to “channel-complete production candidate.”

Expected readiness after this wave:

- `90%+` overall production readiness
- channels no longer feel uneven
- reviews/profile becomes a real differentiator for service businesses
- Stripe becomes the last major commercial wiring step rather than a blocker to product confidence
