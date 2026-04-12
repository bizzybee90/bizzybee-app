# BizzyBee Channel Production Lane Briefs

**Date:** 2026-04-12  
**Branch baseline:** `codex/supabase-hardening-control`  
**Parent brief:** `docs/plans/2026-04-12-channel-production-brief.md`

## Shared context

BizzyBee is now at the stage where the main architecture is strong, but several channel installs still feel uneven.

This wave is not about adding new product ideas. It is about making the existing channel strategy feel complete and trustworthy for real service businesses.

The strategic decisions for this wave are fixed:

- email remains the flagship written channel
- AI Phone becomes the second flagship channel
- SMS and WhatsApp are Twilio-backed companion channels
- Meta messaging is the growth pillar
- Google is a Reviews + Business Profile pillar, not a messaging pillar
- Stripe stays deferred until the channels and reviews module are signed off

## Shared operating rules

Every lane must follow these rules:

- do not revert other work
- stay inside your owned files unless a tiny supporting change is unavoidable
- if you must touch a shared file, keep the change minimal and call it out clearly
- keep behavior honest; do not mark a product path “ready” if it is only scaffolded
- prefer product clarity over aspirational language
- keep Twilio, Meta, and Google product boundaries explicit
- preserve Supabase hardening work and entitlement boundaries

Every lane handoff must report:

- files changed
- commands run
- what is verified
- what still looks risky

## Control lane

**Owner:** main control thread  
**Purpose:** integration, sequencing, merge hygiene, final signoff

Control owns:

- `docs/plans/**`
- merge order
- integration conflicts
- final release notes
- final regression matrix

Control responsibilities:

- keep the big picture aligned with the strategy brief
- reject copy or UI changes that muddy the product boundaries
- run validation after each lane lands
- keep the release state honest

Control should not:

- absorb an entire worker lane locally unless the lane is blocked
- let one lane rewrite another lane’s operating model

## Lane A: Phone + Twilio provisioning

**Goal:** make AI Phone, SMS, and WhatsApp feel like one coherent transport family with a BizzyBee-managed-number default

### Primary ownership

- `src/pages/AiPhone.tsx`
- `src/components/ai-phone/**`
- `src/hooks/useAiPhoneConfig.ts`
- `src/hooks/useChannelSetup.ts`
- `src/lib/channels.ts`
- `src/components/settings/ChannelManagementPanel.tsx`
- `src/components/onboarding/ChannelsSetupStep.tsx`
- `supabase/functions/elevenlabs-provision/**`
- `supabase/functions/elevenlabs-update-agent/**`
- `supabase/functions/elevenlabs-webhook/**`
- `supabase/functions/twilio-sms-webhook/**`
- `supabase/functions/twilio-whatsapp-webhook/**`
- SMS/WhatsApp branches in `supabase/functions/send-reply/**`

### Required outcomes

- AI Phone provisioning is clearer and closer to a real product install
- SMS and WhatsApp setup make the BizzyBee-managed-number default obvious
- Twilio setup language no longer feels like hidden ops work
- phone, SMS, and WhatsApp no longer read like three separate setup philosophies
- webhook/auth behavior is clearly fail-closed or clearly marked if still waiting on secrets

### Non-goals

- do not implement Stripe
- do not own Meta OAuth or Meta webhook behavior
- do not own Google reviews/profile schema or review inbox behavior

### Verification

- typecheck for all touched frontend files
- direct function sanity checks where feasible
- one written smoke path for:
  - AI Phone provisioning
  - SMS inbound/outbound
  - WhatsApp inbound/outbound

## Lane B: Meta messaging polish

**Goal:** make Facebook Messenger and Instagram feel production-strong, while preserving a future path for WhatsApp on Meta

### Primary ownership

- `supabase/functions/meta-auth-start/**`
- `supabase/functions/meta-auth-callback/**`
- `supabase/functions/meta-sync-channels/**`
- `supabase/functions/meta-refresh-tokens/**`
- `supabase/functions/meta-data-deletion-callback/**`
- `supabase/functions/facebook-messenger-webhook/**`
- `supabase/functions/instagram-webhook/**`
- Meta branch in `supabase/functions/send-reply/**`
- Meta-related setup UI in:
  - `src/hooks/useChannelSetup.ts`
  - `src/components/settings/ChannelManagementPanel.tsx`
  - `src/components/onboarding/ChannelsSetupStep.tsx`

### Required outcomes

- Meta setup no longer feels grouped together with Google
- multi-page or multi-asset selection is safer and more explicit
- Messenger and Instagram states are easier to understand
- future WhatsApp-on-Meta architecture is documented or abstracted without pretending it is shipped now

### Non-goals

- do not own Twilio provisioning
- do not turn on WhatsApp-via-Meta in this wave unless it is truly complete
- do not own Google Reviews/Profile implementation

### Verification

- typecheck
- focused Meta flow tests if touched
- one documented happy path for:
  - connect Meta account
  - select page/account
  - inbound message route
  - outbound reply

## Lane C: Google Reviews + Business Profile

**Goal:** turn Reviews into a serious module for service businesses rather than a promising shell

### Primary ownership

- `src/pages/Reviews.tsx`
- `src/lib/reviews.ts`
- review-related hooks and components
- `src/pages/ChannelsDashboard.tsx`
- `src/pages/Settings.tsx`
- `supabase/functions/google-places-autocomplete/**`
- any new review/profile schema or sync helpers in this wave

### Required outcomes

- Reviews clearly owns Google reviews, replies, alerts, and profile-oriented setup
- Channels no longer positions Google as a core messaging product
- review/location setup feels intentional
- the go-live checklist becomes more operationally real
- any future profile-edit path is split honestly into:
  - available in this wave
  - later enhancement

### Non-goals

- do not deepen legacy Google messaging
- do not touch Twilio or Meta unless the UI boundary absolutely requires it
- do not fake a live review sync if the data model is still preview-only

### Verification

- typecheck
- review module tests where touched
- one documented happy path for:
  - connect/select location
  - review alert policy
  - preview/live reply workflow

## Lane D: QA + release hardening

**Goal:** prove the channel stack behaves like a production product, not just an impressive architecture

### Primary ownership

- `src/**/__tests__/**`
- `src/test/**`
- release and runbook docs
- smoke coverage docs

### Required outcomes

- a real regression checklist across:
  - email
  - AI Phone
  - SMS
  - WhatsApp
  - Messenger
  - Instagram
  - Google Reviews/Profile
- honest documentation of remaining secret/provisioning gaps
- release checklist for frontend parity, rollback, and provider verification

### Non-goals

- do not redesign product surfaces
- do not widen scope into Stripe or other commercial work

### Verification

- run the agreed test suite
- add or update smoke tests where practical
- produce a short residual-risk list

## Recommended merge order

1. Lane A and Lane B can run in parallel if they respect file ownership.
2. Lane C can run in parallel once shared copy or `src/lib/channels.ts` changes are stable.
3. Lane D should trail slightly behind so it can verify the settled product surfaces rather than chase moving targets.
4. Control merges one lane at a time and runs validation after each merge.

## Shared definition of done

This wave is only “done” when:

- the product tells a coherent story about each channel
- setup expectations are honest
- the strongest channels are actually the strongest in the app
- Google no longer feels like a half-channel, half-reviews compromise
- support and ops can explain what is live, what is managed by BizzyBee, and what is still an advanced path
