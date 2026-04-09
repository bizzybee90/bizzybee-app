# Meta Direct Integration Design — Facebook Messenger + Instagram DMs

**Date:** 2026-04-09
**Status:** Approved
**Scope:** Phase 1 — Messenger + Instagram. WhatsApp deferred to Phase 2 (requires Tech Provider enrollment).

## Problem

BizzyBee's channels step lets users toggle SMS, WhatsApp, Facebook, Instagram, Google Business — but only email has a self-serve connection flow. The other channels require users to find their own Page IDs and paste them manually. Meta owns Messenger, Instagram DMs, and WhatsApp. Going direct to Meta's APIs with a "Connect with Facebook" OAuth button gives us 3 channels through 1 vendor relationship, with no middleware markup.

## Current state (85% built)

The codebase already has production-quality implementations for Facebook Messenger and Instagram DMs:

- `facebook-messenger-webhook` (263 lines) — HMAC-SHA256 verified, routes to workspace, creates customers/conversations/messages, fetches profiles via Graph API v19.0, triggers AI enrichment
- `instagram-webhook` (273 lines) — same quality, uses Graph API v21.0 for profiles
- `send-reply` — already routes Facebook and Instagram outbound via Meta Graph API v19.0 `/me/messages`
- Environment variables wired: `META_VERIFY_TOKEN`, `META_APP_SECRET`, `META_PAGE_ACCESS_TOKEN`

### What's missing

1. **Per-workspace Meta credentials** — currently one global `META_PAGE_ACCESS_TOKEN`
2. **Facebook Login for Business OAuth flow** — no self-serve connection
3. **Database CHECK constraints** — `workspace_channels`, `conversations.channel`, `messages.channel` exclude facebook/instagram/google_business
4. **`unified-ingest`** — `instagram` not in VALID_CHANNELS set
5. **`_shared/types.ts`** — `instagram` not in Channel union
6. **Data deletion callback** — required by Meta for App Review
7. **Token refresh mechanism** — Page Access Tokens expire after 60 days

## Architecture

### OAuth flow (mirrors Aurinko pattern)

```
Customer clicks "Connect with Facebook"
  → meta-auth-start (generates Facebook Login for Business URL)
  → Meta consent screen (user picks Page + grants permissions)
  → meta-auth-callback
      → POST /oauth/access_token (exchange code for short-lived token)
      → GET /me/accounts (list Pages user manages)
      → GET /oauth/access_token?grant_type=fb_exchange_token (long-lived token, 60 days)
      → GET /{page_id}?fields=instagram_business_account (check for linked IG)
      → POST /{page_id}/subscribed_apps (subscribe to messaging webhook)
      → store_encrypted_token (encrypt + store in meta_provider_configs)
      → upsert workspace_channels rows (facebook + instagram)
      → redirect to /onboarding?meta_connected=true
```

### Inbound message flow (existing, minor update)

```
Customer sends message to Facebook Page or Instagram account
  → Meta webhook POST to facebook-messenger-webhook / instagram-webhook
  → Verify X-Hub-Signature-256
  → Look up workspace via workspace_channels (by page_id or instagram_account_id)
  → Fetch per-workspace token from meta_provider_configs (NEW — replaces global env var)
  → Create/find customer, conversation, message
  → Trigger ai-enrich-conversation
```

### Outbound message flow (existing, minor update)

```
Agent replies in BizzyBee
  → send-reply edge function
  → channel = 'facebook' or 'instagram'
  → Look up meta_provider_configs for workspace (NEW — replaces global env var)
  → POST graph.facebook.com/v19.0/me/messages with per-workspace token
```

## Database changes

### Migration 1: Fix CHECK constraints

```sql
ALTER TABLE workspace_channels DROP CONSTRAINT IF EXISTS workspace_channels_channel_check;
ALTER TABLE workspace_channels ADD CONSTRAINT workspace_channels_channel_check
  CHECK (channel IN ('email','sms','whatsapp','facebook','instagram','google_business','webchat','phone'));

ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_channel_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_channel_check
  CHECK (channel IN ('email','sms','whatsapp','facebook','instagram','google_business','webchat','phone'));

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_channel_check;
ALTER TABLE messages ADD CONSTRAINT messages_channel_check
  CHECK (channel IN ('email','sms','whatsapp','facebook','instagram','google_business','webchat','phone'));
```

### Migration 2: meta_provider_configs table

```sql
CREATE TABLE meta_provider_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  page_id text NOT NULL,
  page_name text,
  instagram_account_id text,
  instagram_username text,
  encrypted_page_access_token text NOT NULL,
  token_expires_at timestamptz,
  meta_user_id text,
  status text NOT NULL DEFAULT 'active',
  connected_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, page_id)
);

ALTER TABLE meta_provider_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to meta_provider_configs"
  ON meta_provider_configs FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Workspace members can read their meta provider configs"
  ON meta_provider_configs FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_members.workspace_id = meta_provider_configs.workspace_id
      AND workspace_members.user_id = auth.uid()
  ));

GRANT SELECT ON meta_provider_configs TO authenticated;
```

## New edge functions

### meta-auth-start (~80 lines)

- Validates auth (workspace member)
- Builds Facebook Login for Business URL:
  - `client_id` = `META_APP_ID` env var
  - `redirect_uri` = `{supabase_url}/functions/v1/meta-auth-callback`
  - `scope` = `pages_messaging,pages_manage_metadata,instagram_basic,instagram_manage_messages`
  - `state` = encrypted JSON `{ workspaceId, origin }`
  - `response_type` = `code`
- Returns `{ authUrl }` to frontend

### meta-auth-callback (~200 lines)

- Receives `?code=...&state=...` from Meta redirect
- Decrypts state to get workspaceId and origin
- Exchanges code for short-lived user token
- Gets list of Pages user manages
- For the first Page (or let user choose if multiple — v2 enhancement):
  - Exchanges for long-lived Page Access Token (60-day)
  - Checks for linked Instagram Business account
  - Subscribes Page to messaging webhook
  - Stores encrypted token in meta_provider_configs
  - Upserts workspace_channels rows
- Redirects to `{origin}/onboarding?meta_connected=true`
- Handles errors with user-facing redirect params

### meta-data-deletion-callback (~60 lines)

- Receives signed POST from Meta when a user requests data deletion
- Verifies `X-Hub-Signature-256`
- Deletes or flags relevant records in meta_provider_configs
- Returns confirmation URL and code per Meta's spec

### meta-refresh-tokens (scheduled, ~50 lines)

- Runs daily via cron/scheduler
- Queries meta_provider_configs where `token_expires_at < now() + interval '7 days'`
- For each, calls `GET /oauth/access_token?grant_type=fb_exchange_token` to refresh
- Updates encrypted_page_access_token and token_expires_at

## Updates to existing code

### facebook-messenger-webhook (~20 lines changed)

After routing to workspace via workspace_channels, fetch per-workspace token:

```typescript
const { data: metaConfig } = await supabase
  .from('meta_provider_configs')
  .select('encrypted_page_access_token')
  .eq('workspace_id', workspaceId)
  .eq('status', 'active')
  .single();

const pageAccessToken = metaConfig
  ? await decrypt(metaConfig.encrypted_page_access_token)
  : Deno.env.get('META_PAGE_ACCESS_TOKEN'); // fallback during rollout
```

### instagram-webhook — same pattern

### send-reply (~15 lines changed in facebook/instagram case)

Same per-workspace token lookup for outbound.

### unified-ingest — add `'instagram'` to VALID_CHANNELS

### \_shared/types.ts — add `'instagram'` to Channel union

## Frontend changes

### ChannelsSetupStep / ChannelManagementPanel

- When Facebook or Instagram card is expanded and channel is not connected:
  - Show "Connect with Facebook" button (amber, BizzyBee-branded)
  - onClick calls `meta-auth-start` → redirects (same pattern as email OAuth)
- When `?meta_connected=true` is in URL params:
  - Show success toast
  - Refresh channel connection states
  - Both Facebook and Instagram cards flip to "Ready"
- Update `channels.ts` setupMode for facebook/instagram to `'self_serve'` (was `'account_linking'`)

## Meta App prerequisites (Michael's tasks)

1. **Meta Business Portfolio** at business.facebook.com
2. **Business Verification** with Companies House cert
3. **Domain verification** via DNS TXT record
4. **Meta App Dashboard** configuration:
   - Add products: Facebook Login for Business, Messenger, Instagram
   - Set redirect URI
   - Upload 1024x1024 app icon
   - Set privacy policy URL
   - Set data deletion callback URL
   - Complete Data Handling questionnaire
5. **App Review** submission with screencast videos

## Permissions needed

| Permission                  | Channel                | Requires App Review |
| --------------------------- | ---------------------- | ------------------- |
| `pages_messaging`           | Facebook Messenger     | Yes                 |
| `pages_manage_metadata`     | Webhook subscription   | Yes                 |
| `instagram_basic`           | Instagram account info | Yes                 |
| `instagram_manage_messages` | Instagram DMs          | Yes                 |

## Environment variables (new)

| Variable            | Purpose                                                     |
| ------------------- | ----------------------------------------------------------- |
| `META_APP_ID`       | Facebook App ID                                             |
| `META_APP_SECRET`   | Already exists — used for webhook signature verification    |
| `META_VERIFY_TOKEN` | Already exists — used for webhook subscription verification |

## Token lifecycle

- Short-lived user token: ~1 hour (exchanged immediately)
- Long-lived Page Access Token: ~60 days
- Refresh: daily cron checks tokens expiring within 7 days
- On refresh failure: mark config as `status: 'token_expired'`, show warning in channels step

## Phase 2: WhatsApp (deferred)

Requires Meta Tech Provider Program enrollment (application to submit ASAP). Once approved:

- WhatsApp Embedded Signup flow (separate from FB Login, uses FB JS SDK `FB.login()`)
- New `meta-whatsapp-webhook` edge function (Cloud API format, not Twilio format)
- Template message management
- 24-hour service window tracking

## Timeline

| Day   | Deliverable                                                                                                           |
| ----- | --------------------------------------------------------------------------------------------------------------------- |
| Day 1 | DB migrations, meta-auth-start, meta-auth-callback, type/channel fixes                                                |
| Day 2 | Update webhook handlers + send-reply for per-workspace tokens, "Connect with Facebook" button, data deletion callback |
| Day 3 | E2E testing, token refresh scheduler, submit App Review                                                               |
