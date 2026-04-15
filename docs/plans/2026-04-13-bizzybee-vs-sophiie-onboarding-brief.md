# BizzyBee vs Sophiie Onboarding Brief

Status: Draft implementation brief
Date: 2026-04-13
Owner: Codex

## Purpose

Use the observed Sophiie onboarding and training flow as a benchmark for product feel, then redesign BizzyBee onboarding so it feels more concierge-led, more voice-forward, and less like a setup wizard without requiring a major backend re-architecture.

This brief is intentionally grounded in what was actually verified, not what we guessed.

## What Was Actually Observed

### Sophiie onboarding entry

Verified with Playwright on 2026-04-13:

1. `https://app.sophiie.ai/onboarding` redirects to `/onboarding/launch`
2. The first screen is a clean account-creation page
3. The user enters an email, accepts terms, and clicks `Get Started`
4. The next step is email OTP verification
5. The callback after verification points to `/train`

### Important conclusion

The visible onboarding entry is not a spoken onboarding flow.

Sophiie feels voice-led because:

- the product is consistently framed as an AI office manager / receptionist
- the training pages talk about greetings, voice, tone, call outcomes, and website-based learning
- setup is presented as "training your agent" rather than "configuring modules"

So the gap is mostly:

- sequence
- framing
- confidence
- product choreography

It is not primarily a backend auth/session architecture problem.

## Current BizzyBee state

BizzyBee is also effectively auth-first, then onboarding.

Current main onboarding sequence:

1. `welcome`
2. `business`
3. `knowledge`
4. `search_terms`
5. `email`
6. `channels`
7. `progress`
8. `complete`

Current AI Phone onboarding is separate:

1. `Business Details`
2. `Services & Pricing`
3. `Opening Hours`
4. `Voice Selection`
5. `Knowledge Base`
6. `Review & Provision`

BizzyBee already has the right raw capabilities:

- auth and onboarding gate
- website analysis
- FAQ / knowledge extraction
- AI phone setup
- voice selection
- managed number provisioning
- channel connection

The problem is that these are surfaced as multiple setup systems rather than one coherent "BizzyBee understands your business" journey.

## The real gap

### What Sophiie is doing better

- lower cognitive load on step one
- stronger "AI office manager" framing
- tighter relationship between setup and business outcomes
- more confidence that the system will learn automatically
- less obvious exposure of internal plumbing

### What BizzyBee is doing worse

- too much explicit structure too early
- email and channels appear before the user has fully seen value
- AI Phone feels like a second onboarding instead of part of the main story
- voice is present in the product but not early enough in the main onboarding journey
- the setup feels admin-heavy rather than concierge-led

## Strategic goal

Make BizzyBee feel like:

- "Tell us about your business and we will set up your AI office manager"

instead of:

- "Work through this product wizard to configure separate systems"

## Product direction

### Keep

- auth-first architecture
- Supabase-native onboarding runner
- website-first enrichment
- managed-number provisioning for AI Phone
- channel setup later in the journey

### Change

- make auth feel like the first onboarding step
- make website understanding the first meaningful value moment
- merge AI Phone into the main onboarding narrative
- show voice/personality value before channel admin tasks
- delay operational setup until after BizzyBee has demonstrated understanding

## Recommended new onboarding flow

### Phase 0: account entry

Goal: make signup feel like step one of onboarding, not a separate auth product.

Screen content:

- headline: "Set up your AI office manager"
- subhead: "BizzyBee learns your business, drafts responses, and gets your phone and inbox working faster."
- primary path:
  - email signup
  - Google signup
- low-friction supporting copy:
  - no long setup required
  - website-based setup in minutes

Do not lead with:

- password anxiety
- channel plumbing
- billing detail

### Phase 1: understand the business

Goal: get the "wow, it already understands us" moment as early as possible.

Step 1:

- ask for:
  - business name
  - website URL
- optional:
  - industry / trade if no website

Step 2:

- start website analysis immediately
- present progress as:
  - reading your website
  - identifying services
  - finding common questions
  - building your AI knowledge base

Step 3:

- present a structured review:
  - company name
  - business summary
  - top services
  - hours if inferred
  - service area if inferred
  - FAQs / knowledge captured

The user should mostly edit and approve, not type from scratch.

### Phase 2: shape the voice and receptionist behaviour

Goal: make BizzyBee feel like an AI receptionist, not just an inbox tool.

Step 4:

- voice selection inside the main onboarding
- include actual audio preview
- short labels like:
  - warm and reassuring
  - polished and premium
  - practical and direct

Step 5:

- greeting and tone preferences
- options such as:
  - friendly
  - premium
  - efficient
  - local / approachable

Step 6:

- scenario preview
- show how BizzyBee would respond to:
  - new enquiry
  - quote request
  - booking / availability question
  - missed call / after-hours enquiry

This is the biggest "Sophiie feel" opportunity.

### Phase 3: activate the strongest channels

Goal: connect the most valuable channels only after the user sees value.

Step 7:

- present Email and AI Phone as the flagship channels
- explain:
  - email connects your real inbox
  - phone provisions a BizzyBee-managed number by default

Step 8:

- connect email
- position this as "turn on BizzyBee in your inbox"

Step 9:

- provision / confirm AI Phone
- show the number
- make this feel like a major milestone

### Phase 4: expand channels

Goal: move supporting channels later.

Step 10:

- optional channel expansion
  - SMS
  - WhatsApp
  - Instagram
  - Facebook Messenger
  - Google Reviews/Profile

This should be:

- optional
- skippable
- clearly secondary to email + phone

### Phase 5: launch confirmation

Goal: make completion feel like going live, not just exiting a wizard.

Final screen should show:

- your AI phone number
- your connected email
- key services learned
- FAQs loaded
- next actions:
  - test a call
  - send a test email
  - review replies
  - connect more channels later

## Quick wins

These are the fastest changes with the highest impact.

1. Merge the website URL into the earliest onboarding step
2. Collapse business + knowledge into one "BizzyBee is learning your business" phase
3. Move email and channels later
4. Pull voice selection into the main onboarding
5. Add scenario preview before channel setup
6. Reword copy throughout from "setup/configure" to "learn/train/respond"

## Medium-depth changes

1. Unify AI Phone onboarding into the main onboarding shell
2. Auto-fill more business context from website analysis
3. Persist and show an editable "business understanding summary"
4. Add actual voice sample playback to the current voice selector
5. Add one simulated "how BizzyBee would answer" preview module

## Things we do not need to do yet

1. We do not need a pre-signup anonymous onboarding session system
2. We do not need a fully spoken onboarding flow
3. We do not need to remove auth before value exists
4. We do not need to rebuild the onboarding backend control plane

## Recommended implementation waves

### Wave 1: shell and sequence

- redesign auth page to feel onboarding-led
- reorder steps
- move website learning earlier
- move email/channels later
- adjust copy and headings throughout

Expected impact:

- large perception upgrade
- low-to-medium engineering complexity

### Wave 2: voice-forward experience

- merge AI Phone voice selection into main onboarding
- add audio previews
- add greeting/tone preferences
- add scenario preview cards

Expected impact:

- high differentiation
- medium engineering complexity

### Wave 3: one onboarding story

- unify separate onboarding flows under one shell
- reduce duplicated business/knowledge collection
- treat phone, inbox, and knowledge as parts of one BizzyBee setup

Expected impact:

- product coherence
- medium complexity

## Reuse map

Current code that should be reused, not replaced:

- `src/pages/Auth.tsx`
  - keep auth-first model, rewrite framing and layout
- `src/components/onboarding/OnboardingWizard.tsx`
  - keep control shell, change sequencing and presentation
- `src/components/onboarding/WebsiteScrape.tsx`
  - use as the earliest value-creation step
- `src/components/onboarding/KnowledgeBaseStep.tsx`
  - merge into business understanding review
- `src/components/ai-phone/OnboardingWizard.tsx`
  - split useful steps into the main onboarding
- `src/components/ai-phone/VoiceSelector.tsx`
  - reuse as the base for the voice step, but add real previews

## Success criteria

We should consider this rewrite successful when:

1. a new user reaches a meaningful "BizzyBee understands my business" screen within minutes
2. the onboarding feels like one story, not multiple product wizards
3. voice/personality is visible before channel admin work
4. email and phone feel like the natural core of onboarding
5. optional channels feel like expansion, not prerequisites

## Honest effort estimate

To get much closer to Sophiie's feel without overbuilding:

- Wave 1: 2 to 4 days
- Wave 2: 3 to 5 days
- Wave 3: 3 to 5 days

That should be enough to get BizzyBee materially closer to the feel users respond to, without pretending the answer is some giant hidden architecture rewrite.
