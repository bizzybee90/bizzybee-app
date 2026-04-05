# Channels Architecture

## Purpose

Channels is the first-class BizzyBee module for written customer touchpoints. It should own:

- onboarding channel choice
- workspace-level enablement
- provider readiness and account-linking state
- automation mode per channel
- operational monitoring for active written channels

Voice is a separate module. Google reviews are a separate module.

## Canonical channel vocabulary

BizzyBee should treat these as the canonical channel keys:

- `email`
- `sms`
- `whatsapp`
- `facebook`
- `instagram`
- `google_business`
- `webchat`
- `phone`

Legacy aliases should be normalized at the edge:

- `web_chat` -> `webchat`
- `voice` -> `phone`
- `ai_phone` -> `phone`

## Module boundaries

### Channels module

Owns:

- Email
- SMS
- WhatsApp
- Facebook Messenger
- Instagram DMs
- Google Business Messages
- Web Chat

Surfaces:

- Onboarding step for channel choice
- Settings > Channels & Integrations for setup
- Channels dashboard for live operational overview
- Conversation filtering and channel-specific inbox views

### AI Phone module

Owns:

- voice provisioning
- phone-number operations
- voice knowledge and call behavior

This should not be treated as just another written channel toggle.

### Reviews module

Owns:

- Google review ingestion
- review inbox and reply workflow
- review alerts and analytics

Google Business Messages stays in Channels. Google Reviews belongs in Reviews.

## Data model

Current source of truth:

- `workspace_channels`
  - workspace-level enablement
  - automation mode
  - provider-specific config payload
- `email_provider_configs`
  - actual linked email accounts

Near-term contract:

- `workspace_channels` remains the canonical per-workspace channel state
- `workspace_channels.config` stores provider-specific identifiers until dedicated connection tables are introduced
- UI derives a connection state from `workspace_channels` plus provider-specific linked-account tables

## Connection states

Every channel shown in UI should resolve into one of these states:

- `disabled`
- `ready`
- `needs_connection`
- `provider_setup_required`
- `coming_soon`
- `separate_module`

This keeps onboarding, settings, and dashboard copy aligned.

## Surface responsibilities

### Onboarding

Goal: choose the channels a business wants BizzyBee ready for.

Should answer:

- which channels does this business use?
- which ones are already self-serve?
- which ones still need provider linking or operational setup?

### Settings > Channels & Integrations

Goal: configure a workspace.

Should answer:

- is this channel enabled?
- what automation mode is it on?
- is it actually connected?
- what is blocking it from being ready?

### Channels dashboard

Goal: operate active written channels.

Should answer:

- which enabled channels are receiving traffic?
- what is unread?
- what needs response?
- what is the average response time?

It should focus on active written channels, not every possible transport ever mentioned in code.
