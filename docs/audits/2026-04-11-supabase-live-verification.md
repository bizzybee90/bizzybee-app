## Supabase Live Verification - 2026-04-11

### Context

This note captures the state of the linked Supabase project after:

- migration parity was restored locally
- remote migrations `20260411214500` and `20260411224500` were applied
- the hardened edge-function wave was deployed from `codex/supabase-hardening-control`

Linked project:

- `atukvssploxwyqpwjmrc`

Control branch:

- `codex/supabase-hardening-control`

### Remote Migration State

Verified with:

- `supabase migration list --linked`

Result:

- local and remote migration histories are aligned through `20260411224500`
- no outstanding local-only drift remained after the parity restore + remote apply

### Deployed Function Waves

Deployed the auth and entitlement helper dependents so the remote runtime picked up the new shared logic:

- `ai-enrich-conversation`
- `audio-process`
- `aurinko-auth-start`
- `aurinko-create-imap-account`
- `aurinko-reset-account`
- `billing-test-seed`
- `check-consent`
- `claim-workspace-admin`
- `classify-emails-dispatcher`
- `convert-emails-to-conversations`
- `create-consent`
- `delete-caller-data`
- `document-process`
- `draft-verify`
- `elevenlabs-provision`
- `elevenlabs-update-agent`
- `elevenlabs-webhook`
- `email-classify-bulk`
- `email-send`
- `export-customer-data`
- `fetch-email-body`
- `image-analyze`
- `inspect-live-state`
- `mark-email-read`
- `meta-auth-start`
- `meta-refresh-tokens`
- `meta-sync-channels`
- `n8n-competitor-callback`
- `n8n-email-callback`
- `pre-triage-rules`
- `refresh-aurinko-subscriptions`
- `request-deletion`
- `retell-call-stats`
- `send-reply`
- `submit-training-review`
- `trigger-n8n-workflow`
- `unified-ingest`
- `validate-competitors`
- `withdraw-consent`

Deployed the provider webhook alignment wave:

- `twilio-sms-webhook`
- `twilio-whatsapp-webhook`
- `google-business-webhook`
- `aurinko-webhook`

### Remote Secret Inventory Check

Verified with:

- `supabase secrets list --project-ref atukvssploxwyqpwjmrc`

Relevant secrets present:

- `ADMIN_EDGE_TOKEN`
- `BILLING_SEED_TOKEN`
- `N8N_WEBHOOK_SECRET`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_ACCOUNT_SID`
- `META_APP_SECRET`
- `META_VERIFY_TOKEN`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Relevant webhook secrets not present at verification time:

- `AURINKO_WEBHOOK_SECRET`
- `GDPR_TOKEN_SECRET`
- `GOOGLE_BUSINESS_WEBHOOK_TOKEN`
- `ELEVENLABS_WEBHOOK_SECRET`
- `POSTMARK_API_KEY`

Implication:

- Twilio and n8n can be enforced confidently right now.
- Aurinko, Google Business, and ElevenLabs still require either secret provisioning or an explicit rollout choice before switching to a strict fail-closed posture.

### Live Edge Probes

Anonymous / unsigned probes against the live project produced:

- `inspect-live-state` -> `401 Unauthorized`
- `meta-sync-channels` -> `401 Unauthorized`
- `n8n-email-callback` without signature -> `401 Missing signature`
- `n8n-competitor-callback` without signature -> `401 Missing signature`
- `twilio-sms-webhook` without valid Twilio signature -> `403 Invalid signature`
- `twilio-whatsapp-webhook` without valid Twilio signature -> `403 Invalid signature`
- `google-business-webhook` with empty JSON payload -> `200 {"status":"ok"}`
- `aurinko-webhook` with empty JSON payload -> `400 {"ok":false,"error":"Webhook payload does not include a message id or inline message object"}`
- `elevenlabs-webhook` with empty JSON payload -> `200 {"ok":true,"skipped":"unknown"}`
- `gdpr-portal-request` with invalid request payload -> `500 {"error":"GDPR service not configured"}`
- `gdpr-portal-verify` with invalid verify payload -> `500 {"error":"GDPR service not configured"}`

Interpretation:

- The previously exposed internal/admin-style surfaces are no longer anonymously callable.
- n8n signature enforcement is live.
- Twilio signature enforcement is live.
- Google Business, Aurinko, and ElevenLabs are still soft because their verification secrets are not provisioned in the linked project.
- The GDPR portal is not currently live-safe because its signing/email secrets are not provisioned in the linked project.

### Auth-Backed Browser Smoke

Used the seeded starter persona on the live app:

- email: `billing-starter-test@bizzybee.app`
- password: seeded via `billing-test-seed`

Observed:

- sign-in succeeds
- workspace resolves correctly to the seeded starter workspace
- `inbox_insights` and `triage_corrections` requests returned `200` in the smoke
- `/ai-phone` eventually loaded successfully and `retell-call-stats` ultimately returned `200`

Live issues still visible in the deployed frontend:

- the auth page still logs `AuthSessionMissingError` before sign-in
- Home still triggers a `400` against `email_import_queue`
- `/ai-phone` showed transient failed `retell-call-stats` requests before succeeding

### Home `email_import_queue` Drift Explained

The Home `400` is now confirmed to be a frontend deployment drift issue, not an unresolved bug in
`codex/supabase-hardening-control`.

Evidence:

- Reproducing the live flow on `https://bizzybee-app.pages.dev` still issues:
  - `GET /rest/v1/email_import_queue?select=id,from_name,from_email,subject,body,received_at,category,direction...`
- That exact query matches the older implementation in:
  - [ActivityFeed.tsx](/Users/michaelcarbon/Projects/BizzyBee/bizzybee-app/src/components/dashboard/ActivityFeed.tsx)
- The current hardening branch already replaced that query with a `conversations`-backed inbox lane in:
  - [ActivityFeed.tsx](/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-control/src/components/dashboard/ActivityFeed.tsx)

Practical implication:

- the backend hardening work is not the thing still breaking Home
- the deployed Pages bundle is behind the stabilized branch
- deploying the current hardened frontend should remove this specific `email_import_queue` error

### Most Important Remaining Gaps

1. Frontend/runtime drift is now the loudest remaining issue.
   The visible production error in this smoke was `email_import_queue` query drift, not RLS or edge auth.

2. Provider webhook enforcement is only fully complete for channels with secrets already provisioned.
   Twilio and n8n are good; Aurinko, Google Business, and ElevenLabs still need secret setup before a hard fail-closed policy.

3. GDPR portal still needs both secret provisioning and final workflow signoff.
   The token-binding code is stronger now, but the linked project is missing the secrets required to run the portal at all.

### Recommended Next Steps

1. Deploy the latest frontend build from the stabilized branch so the live Pages app matches the already-hardened backend state.
2. Provision `AURINKO_WEBHOOK_SECRET`, `GOOGLE_BUSINESS_WEBHOOK_TOKEN`, and `ELEVENLABS_WEBHOOK_SECRET` if those channels are intended to stay active.
3. After secrets are present, tighten those three webhooks to fail closed by policy, not just by convention.
4. Provision `GDPR_TOKEN_SECRET` and `POSTMARK_API_KEY`, then re-verify the GDPR portal endpoints end to end.
