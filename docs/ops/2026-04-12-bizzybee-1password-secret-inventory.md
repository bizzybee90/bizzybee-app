# BizzyBee 1Password Secret Inventory

Date: 2026-04-12
Branch: `codex/supabase-hardening-control`

## First: what the 1Password CLI is for

You were not wrong.

The 1Password CLI can do two related things:

1. help you **store/manage** items in 1Password
2. help tools/scripts **read/inject** those secrets at runtime

For BizzyBee, the safest default is:

- humans store and manage the secrets in 1Password
- commands read them with `op read` or `op run`
- the app receives them through Supabase secrets or short-lived shell injection

So yes, 1Password is where the secrets should live.
The CLI is the bridge, not the final destination.

## Recommended vault/item structure

Use one vault for BizzyBee production secrets and one for non-production.

- Vault: `BizzyBee Production`
- Vault: `BizzyBee Staging`

Recommended item groups:

- `Supabase`
- `Sentry`
- `Stripe`
- `Anthropic`
- `OpenAI`
- `Aurinko`
- `Twilio`
- `ElevenLabs`
- `Meta`
- `Google Business Profile`
- `Postmark`
- `GDPR`

## Secret inventory

### VITE_STRIPE_PUBLISHABLE_KEY

- Purpose:
  - browser-side Stripe publishable key for test or live checkout surfaces
- Where used:
  - future frontend billing entry points
- Where it comes from:
  - Stripe Dashboard API keys page
- Need now:
  - **Only when BizzyBee starts wiring real Stripe checkout/portal flows**
- Notes:
  - this is **not** a secret
  - it is safe to expose in frontend env vars
  - use the test-mode key first

### STRIPE_SECRET_KEY

- Purpose:
  - server-side Stripe API authentication for checkout/session/webhook/portal work
- Where used:
  - future Stripe edge functions / backend calls
- Where it comes from:
  - Stripe Dashboard API keys page
- Need now:
  - **Only when BizzyBee starts wiring test-mode Stripe flows**
- Notes:
  - this **is** a real vendor secret
  - use `sk_test_...` first
  - store in 1Password and runtime secrets only

### STRIPE_WEBHOOK_SECRET

- Purpose:
  - signature verification for BizzyBee's Stripe webhook endpoint
- Where used:
  - future Stripe webhook handler
- Where it comes from:
  - Stripe Dashboard Webhooks section for the specific endpoint
- Need now:
  - **Only when the Stripe webhook endpoint is created**
- Notes:
  - this is endpoint-specific
  - test and live webhook secrets are different
  - Stripe creates it, 1Password stores it

### STRIPE_PORTAL_CONFIGURATION_ID

- Purpose:
  - identifies the Stripe customer portal configuration BizzyBee should use
- Where used:
  - future customer portal session endpoint
- Where it comes from:
  - Stripe Billing / Customer Portal configuration
- Need now:
  - **Only when BizzyBee wires the billing portal**
- Notes:
  - this is configuration, not a secret
  - still worth storing in 1Password for consistency
  - prefer a test-mode portal config first

### VITE_SENTRY_DSN

- Purpose:
  - frontend browser DSN for the `bizzybee-web` Sentry project
- Where used:
  - frontend Vite/React app via `src/lib/sentry.ts`
- Where it comes from:
  - Sentry project settings
- Need now:
  - **Yes if you want frontend errors to report into Sentry**
- Notes:
  - this is **not** a secret in the same way an auth token is
  - it is expected to be present in the browser bundle
  - store it in 1Password for consistency, but treat it as configuration rather than as a privileged credential

### SENTRY_AUTH_TOKEN

- Purpose:
  - build-time auth token for Sentry release creation and source-map upload
- Where used:
  - Vite build via `@sentry/vite-plugin`
- Where it comes from:
  - Sentry organization auth token
- Need now:
  - **Yes if you want release creation and source-map upload**
- Notes:
  - this **is** a real secret and should never go into frontend env vars
  - it belongs in CI / deploy environment only
  - pair it with:
    - `SENTRY_ORG=bizzybee`
    - `SENTRY_PROJECT=bizzybee-web`
    - `SENTRY_URL=https://de.sentry.io/`

### SENTRY_EDGE_DSN

- Purpose:
  - backend/edge DSN for the `bizzybee-edge` Sentry project
- Where used:
  - shared Supabase Edge Function helper in `supabase/functions/_shared/sentry.ts`
- Where it comes from:
  - Sentry project settings for `bizzybee-edge`
- Need now:
  - **Yes if you want Supabase Edge Functions and workers to report backend errors**
- Notes:
  - store it as an edge/runtime env var, not a browser env var
  - keep it separate from `VITE_SENTRY_DSN` so frontend and backend incidents stay split

### OAUTH_STATE_SECRET

- Purpose:
  - HMAC signing secret for Meta and Aurinko OAuth state payloads
- Where used:
  - `meta-auth-start`
  - `meta-auth-callback`
  - `aurinko-auth-start`
  - `aurinko-auth-callback`
- Where it comes from:
  - BizzyBee-generated secret, not a vendor-issued key
- How to create it:
  - generate a long random secret, for example 32+ bytes from a password generator
- Need now:
  - **Yes**
- Notes:
  - This is already present in the linked Supabase project and should now be treated as required

### GOOGLE_BUSINESS_WEBHOOK_TOKEN

- Purpose:
  - Shared bearer token BizzyBee checks on the inbound Google Business webhook
- Where used:
  - `supabase/functions/google-business-webhook/index.ts`
- Where it comes from:
  - BizzyBee-generated secret, not something Google gives you
- How to create it:
  - generate a long random token in 1Password
- Need now:
  - **Only if you want the Google Business webhook path to be truly fail-closed**
- Notes:
  - This is not a Google console token
  - the current code verifies an `Authorization: Bearer <token>` header against this stored value
  - Google Business Profile notification docs are here for the wider product context:
    - [Google Business Profile notifications](https://developers.google.com/my-business/reference/notifications/rest)
    - [Google Business Profile APIs](https://developers.google.com/my-business)

### GDPR_TOKEN_SECRET

- Purpose:
  - HMAC secret used to sign and verify GDPR portal tokens
- Where used:
  - `gdpr-portal-request`
  - `gdpr-portal-verify`
- Where it comes from:
  - BizzyBee-generated secret, not vendor-issued
- How to create it:
  - generate a long random secret in 1Password
- Need now:
  - **Yes, if you want the GDPR portal to work**
- Notes:
  - This is an internal signing secret for secure request verification links

### RESEND_API_KEY

- Purpose:
  - lets BizzyBee send lifecycle and GDPR emails through Resend
- Where used:
  - `bootstrap-workspace`
  - `send-lifecycle-email`
  - `gdpr-portal-request`
  - `gdpr-portal-verify`
- Where it comes from:
  - Resend API key
- Where to get it:
  - inside your Resend dashboard under `API Keys`
  - docs:
    - [Resend send email API](https://resend.com/docs/api-reference/emails/send-email)
- Need now:
  - **Yes, if you want lifecycle or GDPR emails to send**
- Notes:
  - without it, the code logs the verification URL instead of emailing it

### RESEND_TRANSACTIONAL_FROM

- Purpose:
  - default `From` identity for BizzyBee transactional and GDPR emails
- Where used:
  - `bootstrap-workspace`
  - `send-lifecycle-email`
  - `gdpr-portal-request`
  - `gdpr-portal-verify`
- Where it comes from:
  - a verified Resend sender identity, usually your domain or a verified email
- Need now:
  - **Recommended**, so emails come from the correct BizzyBee identity
- Notes:
  - defaults to `BizzyBee <noreply@bizzyb.ee>` if unset

### TWILIO_SMS_NUMBER

- Purpose:
  - default outbound `From` number for the SMS channel
- Where used:
  - `supabase/functions/send-reply/index.ts`
- Where it comes from:
  - a Twilio phone number you buy or port into Twilio
- Docs:
  - [Twilio Phone Numbers overview](https://www.twilio.com/docs/phone-numbers)
  - [Twilio Phone Numbers API](https://www.twilio.com/docs/phone-numbers/api)
- Need now:
  - **Only if you are turning on real SMS sending**
- Important BizzyBee note:
  - BizzyBee does **not** need a separate SMS number this second if you are not going live with SMS yet
  - if MAC Cleaning is the onboarding customer, the SMS number should map to that workspace’s SMS channel setup
  - if your AI Phone/Twilio number is also SMS-capable, you may be able to reuse that number instead of buying a separate one, but do not assume that until capabilities are confirmed in Twilio

### TWILIO_WHATSAPP_NUMBER

- Purpose:
  - default WhatsApp sender number for outbound WhatsApp messages
- Where used:
  - `supabase/functions/send-reply/index.ts`
- Where it comes from:
  - WhatsApp sender registered through Twilio
- Docs:
  - [Twilio WhatsApp overview](https://www.twilio.com/docs/sms/whatsapp/api)
  - [Twilio WhatsApp Self Sign-up](https://www.twilio.com/docs/whatsapp/self-sign-up)
- Need now:
  - **Only if you are turning on real WhatsApp sending**
- Notes:
  - this is separate from inbound webhook verification

### TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN

- Purpose:
  - Twilio account authentication for SMS, WhatsApp, and phone provisioning flows
- Where used:
  - `send-reply`
  - `twilio-sms-webhook`
  - `twilio-whatsapp-webhook`
  - `elevenlabs-provision`
- Where to get them:
  - Twilio Console
- Need now:
  - **Yes**, because these are part of the active Twilio-based channel foundation

### AURINKO_WEBHOOK_SECRET

- Purpose:
  - signature verification for Aurinko webhook events
- Where used:
  - `aurinko-webhook`
- Where it comes from:
  - Aurinko-side shared secret you define/configure
- Need now:
  - **Yes if email is a live channel and you want fail-closed posture**

### ELEVENLABS_WEBHOOK_SECRET

- Purpose:
  - signature verification for ElevenLabs webhooks
- Where used:
  - `elevenlabs-webhook`
- Where it comes from:
  - ElevenLabs webhook secret from their integration settings
- Need now:
  - **Yes if AI Phone is live**

## What to do right now

### Must provision now

- `OAUTH_STATE_SECRET`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `AURINKO_WEBHOOK_SECRET`

### Strongly recommended next

- `GOOGLE_BUSINESS_WEBHOOK_TOKEN`
- `GDPR_TOKEN_SECRET`
- `RESEND_API_KEY`
- `ELEVENLABS_WEBHOOK_SECRET`

### Can wait until the channel is truly live

- `TWILIO_SMS_NUMBER`
- `TWILIO_WHATSAPP_NUMBER`

## My recommendation on the SMS number question

Right now, do **not** create extra Twilio sprawl just for the sake of it.

Best rule:

- if BizzyBee is not yet going live with outbound SMS, `TWILIO_SMS_NUMBER` can wait
- if MAC Cleaning is the first real SMS customer, provision the number in the context of that workspace rollout
- if your existing Twilio voice number is also SMS-capable and you want one managed number for phone + SMS, that is likely the cleanest v1

So the honest answer is:

- no, BizzyBee does not necessarily need a separate SMS number right this minute
- yes, BizzyBee does need one once you want real SMS sending

## 1Password CLI references

- [1Password CLI overview](https://developer.1password.com/docs/cli)
- [Use `op run`](https://developer.1password.com/docs/cli/reference/commands/run)
- [CLI command reference](https://developer.1password.com/docs/cli/reference)
- [Use service accounts with 1Password CLI](https://developer.1password.com/docs/service-accounts/use-with-1password-cli/)
- [Manual sign-in guidance](https://developer.1password.com/docs/cli/sign-in-manually/)
