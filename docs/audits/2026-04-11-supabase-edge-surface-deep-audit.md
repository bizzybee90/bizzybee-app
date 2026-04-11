## Supabase Edge Surface Deep Audit

Date: 2026-04-11
Branch: `codex/supabase-hardening-control`
Worktree: `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-control`

### Fixed Locally In This Wave

- Canonical workspace auth and feature guards were added to:
  - `supabase/functions/audio-process/index.ts`
  - `supabase/functions/image-analyze/index.ts`
  - `supabase/functions/pre-triage-rules/index.ts`
  - `supabase/functions/mark-email-read/index.ts`
  - `supabase/functions/refresh-aurinko-subscriptions/index.ts`
  - `supabase/functions/unified-ingest/index.ts`
  - `supabase/functions/email-classify-bulk/index.ts`
  - `supabase/functions/validate-competitors/index.ts`
  - `supabase/functions/fetch-email-body/index.ts`
  - `supabase/functions/meta-refresh-tokens/index.ts`
- Additive policy migrations now exist locally for:
  - legacy admin policy scoping in `20260411214500_workspace_scoped_admin_policy_hardening.sql`
  - remaining admin and billing policy scoping in `20260411224500_scope_remaining_admin_and_billing_policies.sql`

### Highest-Risk Items Still Open

1. `n8n` callbacks are still fail-open if the signature header is missing.
   - `supabase/functions/n8n-email-callback/index.ts`
   - `supabase/functions/n8n-competitor-callback/index.ts`
   - These functions currently proceed when the secret exists but the header is absent, while holding service-role power.

2. Several provider webhooks still fail open when their secret env vars are missing.
   - `supabase/functions/twilio-sms-webhook/index.ts`
   - `supabase/functions/twilio-whatsapp-webhook/index.ts`
   - `supabase/functions/google-business-webhook/index.ts`
   - `supabase/functions/aurinko-webhook/index.ts`
   - `supabase/functions/elevenlabs-webhook/index.ts`
   - These should reject traffic when the deployment secret is not configured, not silently accept it.

3. GDPR portal flows are not yet tenant-safe enough for duplicate customer emails across workspaces.
   - `supabase/functions/gdpr-portal-request/index.ts`
   - `supabase/functions/gdpr-portal-verify/index.ts`
   - The flow signs workspace context but later re-resolves customers globally by email instead of binding to a signed workspace/customer identity.

4. Privacy/export flows still use legacy workspace resolution.
   - `supabase/functions/export-customer-data/index.ts`
   - `supabase/functions/request-deletion/index.ts`
   - These should move to `_shared/auth.ts` so they match the canonical membership model.

5. Global or weakly scoped SQL policies still need one more careful pass.
   - `public.user_roles` still has a historical global admin-manage policy in `20251118110326_7dc90103-90eb-4325-8a79-264ed70326f5.sql`.
   - The new local policy migrations cover the clearer workspace-keyed tables first; `user_roles` needs an intentional design decision before changing live behavior.

6. Migration parity remains the biggest operational risk for live changes.
   - Remote-only migration block remains documented in `docs/audits/2026-04-11-supabase-migration-parity-recovery.md`.
   - Remote apply should stay frozen until the missing historical files are restored into this repo and `supabase migration list` is clean except for intentional local-only entries.

### Recommended Order From Here

1. Commit the current hardening tranche on `codex/supabase-hardening-control`.
2. Restore migration parity in the repo before any more live SQL applies.
3. Harden webhook callbacks to fail closed on missing or invalid secrets.
4. Rework GDPR/export flows to bind signed workspace and customer identity end to end.
5. Decide `user_roles` policy strategy explicitly before applying any global-role changes remotely.

### Remote Apply Guidance

- Safe to keep local-only for now:
  - `20260411214500_workspace_scoped_admin_policy_hardening.sql`
  - `20260411224500_scope_remaining_admin_and_billing_policies.sql`
- Not recommended tonight:
  - applying either migration remotely before parity repair
  - changing webhook secret behavior remotely without verifying the production env configuration first
