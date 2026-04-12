# BizzyBee Channel Release Hardening Checklist

**Date:** 2026-04-12  
**Branch baseline:** `codex/supabase-hardening-control`  
**Parent docs:**

- `docs/plans/2026-04-12-channel-production-brief.md`
- `docs/plans/2026-04-12-channel-production-lane-briefs.md`
- `docs/audits/2026-04-11-supabase-live-verification.md`

## Purpose

This checklist is the control-lane proof that the channel wave is ready to be called a real production candidate.

It is intentionally boring.

The goal is to make sure BizzyBee does not merely look advanced in code, but behaves like a product that support, ops, and customers can trust.

## Release bar

This wave is only release-ready when all of the following are true:

- frontend copy matches the actual operating model
- the strongest channels are really the strongest in live behavior
- every supported channel has an honest setup path
- webhook verification is fail-closed where the product claims it is live
- support can explain what is self-serve, what is BizzyBee-managed, and what is still an advanced path
- the live Pages bundle matches the hardened branch

## Channel-by-channel regression matrix

### Email

Must pass:

- connect mailbox flow
- initial import mode selection
- live sync or webhook ingestion
- inbound message becomes conversation
- outbound reply sends successfully
- reconnect / refresh path is understandable
- error state is understandable

Must verify:

- Aurinko account state is healthy
- missing webhook secret is either provisioned or explicitly called out as not fail-closed yet
- onboarding still treats email as the strongest path

### AI Phone

Must pass:

- provisioning flow starts from product UI
- ElevenLabs agent creation succeeds
- Twilio number purchase or assignment succeeds
- config persists back to workspace state
- post-call webhook writes expected data
- AI Phone page reflects ready vs not-ready honestly

Must verify:

- `ELEVENLABS_WEBHOOK_SECRET` is provisioned before claiming fail-closed security
- at least one real or staged post-call event is observed end to end
- usage and follow-up state are visible

### SMS

Must pass:

- BizzyBee-managed-number setup path is understandable
- inbound SMS routes to correct workspace
- outbound SMS reply works
- setup UI explains advanced migration separately from default setup

Must verify:

- Twilio webhook signature enforcement is still live
- saved routing number matches provider payload
- support copy does not imply number porting is required at signup

### WhatsApp

Must pass:

- Twilio-backed WhatsApp setup path is understandable
- inbound WhatsApp routes to correct workspace
- outbound WhatsApp reply works
- product copy explains that existing app numbers usually need migration rather than default onboarding

Must verify:

- Twilio signature enforcement is still live
- routing/sender identity is saved correctly
- no surface implies WhatsApp-on-Meta is already shipped if it is not

### Facebook Messenger

Must pass:

- connect Meta account flow
- correct Page selection
- inbound message becomes conversation
- outbound reply works
- token refresh path remains healthy

Must verify:

- multi-page selection is safe and explicit
- product language distinguishes Messenger/Instagram from future WhatsApp-on-Meta

### Instagram

Must pass:

- Meta connect flow supports Instagram asset selection
- inbound Instagram DM becomes conversation
- outbound reply works

Must verify:

- account/page linking is not silently attaching the wrong asset
- status language is understandable to non-technical users

### Google Reviews + Business Profile

Must pass:

- Reviews module is clearly the home for Google
- location/account selection flow is understandable
- alert policy can be saved
- reply workflow is understandable and honest about preview vs live
- review ownership/assignment is visible

Must verify:

- Google is no longer presented as a strategic messaging pillar
- `GOOGLE_BUSINESS_WEBHOOK_TOKEN` is provisioned before any live webhook claims are made
- the module boundary is explicit:
  - Channels owns message transport only
  - Reviews owns reviews/profile work

## Secret and fail-closed audit

Before signoff, verify the live project secrets for any channel we are calling live:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `META_APP_SECRET`
- `META_VERIFY_TOKEN`
- `AURINKO_WEBHOOK_SECRET`
- `GOOGLE_BUSINESS_WEBHOOK_TOKEN`
- `ELEVENLABS_WEBHOOK_SECRET`

If a secret is missing:

- either provision it
- or remove any language that implies the channel is fully live and fail-closed

## Pages deploy parity

Before signoff:

- deploy the latest frontend bundle from `codex/supabase-hardening-control`
- confirm the live Pages build matches the hardened branch
- smoke the exact routes touched in the current wave

Minimum route smoke:

- `/auth`
- `/onboarding`
- `/settings?category=connections`
- `/channels`
- `/ai-phone`
- `/reviews`

## Rollback readiness

Before signoff, document:

- the previous stable frontend deploy reference
- the previous stable Supabase function deploy reference or commit
- any secrets changed during the wave
- any migrations applied during the wave
- which features can be disabled safely if the release needs to be partially rolled back

## Support readiness

Support should have answers for:

- how email setup works
- why AI Phone provisions a BizzyBee-managed number
- why SMS and WhatsApp default to BizzyBee-managed numbers
- what “advanced migration path” means
- how Meta setup chooses the correct page/account
- why Google reviews/profile live separately from Channels

## Go / no-go questions

The release is **no-go** if any of these are still true:

- a flagship channel is only “ready” in copy, not in live behavior
- setup copy still implies the wrong operating model
- webhook auth is soft for a channel we are marketing as live
- the live frontend is behind the hardened branch
- support would need tribal knowledge to explain the setup story

The release is **go** when:

- the channel strategy is coherent in the product
- the regressions above have been run
- the remaining risks are small, explicit, and acceptable
