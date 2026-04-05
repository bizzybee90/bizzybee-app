# Reviews Architecture

## Purpose

Reviews is the first-class BizzyBee module for public reputation management.

It should own:

- review account and location connection
- review sync and health state
- review inbox and triage workflow
- AI-assisted review drafting and reply publishing
- review alerts and reputation analytics

It should not be hidden inside Settings or treated as just another channel toggle.

## Current boundary

### Channels module

Owns:

- Google Business Messages
- Email
- SMS
- WhatsApp
- Facebook Messenger
- Instagram DMs
- Web Chat

### Reviews module

Owns:

- Google Business Profile reviews
- review inbox and filters
- review reply drafting and publishing
- review alerts
- reputation analytics

Google Business Messages stays in Channels. Google Reviews belongs in Reviews.

## Core product promise

BizzyBee Reviews should let a business do four jobs in one place:

1. See new reviews in real time.
2. Focus on the reviews that matter most.
3. Draft and publish strong replies quickly.
4. Understand how reputation is trending over time.

If the module cannot do all four, it is still partial.

## Module surfaces

### Onboarding

Goal: decide whether the business wants review management turned on from day one.

Should answer:

- does this business actively manage Google reviews?
- should BizzyBee alert the team for new low-star reviews?
- which location should reviews be connected for first?

The onboarding step should be optional but prominent, especially for local service businesses.

### Reviews dashboard

Goal: operate review management day to day.

Should answer:

- what is new?
- what is unreplied?
- which low-rating reviews need urgent attention?
- which replies are drafted, published, or failed?
- how is rating and response performance changing?

This should be a real operational surface, not a settings card.

### Review detail

Goal: handle one review fully.

Should show:

- star rating
- author and timestamp
- location
- review text
- AI draft
- reply history
- publish / update reply action
- status and any failure reason

### Settings

Goal: configure the module, not operate it.

Should contain:

- account connection state
- connected locations
- alert preferences
- sync health
- permissions

Settings should not be where review work actually happens.

## Canonical provider model

Phase one should support one review provider:

- `google`

This keeps the product honest and focused. Trustpilot, Checkatrade, Facebook reviews, and other sources can follow later if the data model stays provider-agnostic.

## Connection states

Every review provider shown in UI should resolve to one of these states:

- `disconnected`
- `needs_location`
- `syncing`
- `ready`
- `attention_required`
- `coming_soon`

This keeps onboarding, settings, and the eventual Reviews dashboard aligned.

## Review workflow states

### Review inbox states

Every review record should resolve into one primary workflow state:

- `new`
- `unreplied`
- `drafted`
- `published`
- `attention_required`
- `archived`

### Reply states

Reply lifecycle should be explicit:

- `none`
- `drafted`
- `approved`
- `published`
- `failed`

The product should never blur “drafted” with “published”.

## Inbox filters

The first-class review inbox should support these canonical filters:

- `all`
- `new`
- `unreplied`
- `low_rating`
- `drafted`
- `published`
- `attention`

This is the Reviews equivalent of how the current Training queue feels like a real workflow.

## Alerts

Reviews should reuse the existing `notifications` table and `notification_preferences` table rather than inventing a separate alerting system first.

New notification types should include:

- `review_new`
- `review_low_rating`
- `review_stale_unreplied`
- `review_reply_failed`
- `review_sync_error`

Phase one alert rules:

- notify on any new 1-3 star review
- notify on unreplied reviews older than policy threshold
- notify on sync failure
- optionally notify on every new review for high-touch businesses

## Analytics

The Reviews module should own these first-class metrics:

- current average rating
- total reviews
- new reviews in selected window
- unreplied review count
- average response time
- low-rating share
- response-rate trend

It should also support location-level drilldown when multiple locations are connected.

## Data model

Reviews needs its own data model. Reusing conversations or messages would make the product messy and semantically wrong.

### Proposed tables

#### `review_connections`

Purpose:

- one row per workspace per provider
- stores provider connection state and last sync metadata

Suggested fields:

- `id`
- `workspace_id`
- `provider`
- `status`
- `config`
- `last_synced_at`
- `last_error`
- `created_at`
- `updated_at`

#### `review_locations`

Purpose:

- connected review locations under a provider connection
- location-level routing and reporting

Suggested fields:

- `id`
- `workspace_id`
- `review_connection_id`
- `provider_location_ref`
- `provider_account_ref`
- `place_id`
- `name`
- `address`
- `is_primary`
- `avg_rating_cached`
- `review_count_cached`
- `last_synced_at`
- `created_at`
- `updated_at`

#### `reviews`

Purpose:

- canonical review records
- one row per provider review

Suggested fields:

- `id`
- `workspace_id`
- `review_location_id`
- `provider`
- `provider_review_id`
- `rating`
- `author_name`
- `author_avatar_url`
- `body`
- `status`
- `reply_status`
- `reviewed_at`
- `published_reply_at`
- `review_created_at`
- `synced_at`
- `metadata`
- `created_at`
- `updated_at`

#### `review_replies`

Purpose:

- store BizzyBee drafts and published replies
- preserve source-of-truth distinction between draft and published content

Suggested fields:

- `id`
- `review_id`
- `draft_body`
- `published_body`
- `status`
- `source`
- `external_reply_id`
- `last_error`
- `created_by`
- `updated_by`
- `published_at`
- `created_at`
- `updated_at`

#### `review_sync_runs`

Purpose:

- operational observability
- sync history and troubleshooting

Suggested fields:

- `id`
- `workspace_id`
- `review_connection_id`
- `status`
- `started_at`
- `completed_at`
- `reviews_seen`
- `reviews_upserted`
- `error_message`

## Permissions

Suggested access model:

- `admin`: connect providers, manage locations, manage alerts, publish replies
- `manager`: publish replies, review analytics, manage day-to-day review workflow
- `reviewer`: draft and review replies, but not change provider or workspace configuration

This should align with the existing app roles rather than introducing a new role system.

## UI architecture

The Reviews module should eventually have:

- `/reviews`
  - inbox + metrics + alerts
- `/reviews/:reviewId`
  - detail drawer or dedicated page
- `Settings > Workspace / Channels`
  - connection and alert configuration only

Sidebar placement should be near `Channels` and `Analytics`, not buried under Settings.

## Onboarding flow

Onboarding should add an optional `Reviews` step after `Channels` once the module is live.

That step should capture:

- whether the business wants Google review management
- whether low-star alerts should be enabled
- whether setup should happen now or later

This keeps review management visible from day one without blocking onboarding completion.

## Phased implementation

### Phase 1: foundation

- add shared review vocabulary in frontend
- add review tables
- add provider connection and location sync contract

### Phase 2: connection

- connect Google review provider
- select location
- persist connection state
- show sync health

### Phase 3: review inbox

- build `/reviews`
- add filters, metrics, empty states, and detail view
- support AI draft generation

### Phase 4: reply workflow

- publish reply
- update existing reply
- show failed vs published states clearly

### Phase 5: alerts and analytics

- push review alerts into `notifications`
- honor `notification_preferences`
- add ratings and response analytics

### Phase 6: onboarding exposure

- add optional Reviews step to onboarding
- make review connection discoverable without duplicating setup surfaces

## Done means

Reviews is first-class when a business can:

1. Connect its Google Business review source.
2. See reviews arrive in a dedicated inbox.
3. Filter to low-rating and unreplied reviews quickly.
4. Draft, publish, and update replies confidently.
5. Receive review alerts in the same product notification system.
6. See reputation and response metrics over time.

Until then, Google reviews should be treated as an emerging module, not implied to be “already covered” by Channels.
