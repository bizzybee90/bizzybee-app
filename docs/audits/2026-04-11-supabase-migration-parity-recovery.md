# Supabase Migration Parity Recovery Note

## Current State

- Worktree: `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-parity`
- Branch: `codex/supabase-hardening-parity`
- Evidence source: `supabase migration list --linked` run on `2026-04-11`

The live Supabase project is not represented faithfully by local `supabase/migrations`.

- Local migrations present: `151`
- Remote-only migrations present: `43`
- Remote-only date range: `20260311000001` through `20260411103000`
- Local and remote realign only at:
  - `20260411170000`
  - `20260411181000`
  - `20260411194000`
  - `20260411201500`

This means the repo is currently not an authoritative source for the live schema, grants, policies, or helper functions between `2026-03-11` and `2026-04-11 10:30:00 UTC`.

## Exact Remote-Only Versions

```text
20260311000001
20260311000002
20260311000003
20260311000004
20260312000001
20260315091408
20260319112505
20260323155247
20260402162638
20260404125400
20260404171235
20260404174705
20260404193737
20260404193811
20260406085513
20260406090342
20260406141538
20260406162350
20260406181954
20260406204118
20260406204147
20260408194917
20260408220805
20260408221551
20260408224149
20260409100321
20260409100347
20260409100851
20260409162517
20260409184211
20260409184509
20260409185155
20260410083500
20260410123000
20260410164000
20260410190000
20260410193000
20260410195000
20260410204000
20260410205000
20260410210000
20260410214500
20260411103000
```

## Highest-Impact Missing Live Objects Used By Code

These objects are referenced by code and generated types, but no local migration defines them.

### 1. `public.meta_provider_configs`

Used by:

- `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-parity/supabase/functions/meta-auth-callback/index.ts`
- `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-parity/supabase/functions/meta-sync-channels/index.ts`
- `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-parity/supabase/functions/meta-refresh-tokens/index.ts`
- `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-parity/supabase/functions/facebook-messenger-webhook/index.ts`
- `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-parity/supabase/functions/instagram-webhook/index.ts`
- `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-parity/supabase/functions/send-reply/index.ts`
- `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-parity/src/integrations/supabase/types.ts`

Why it matters:

- Stores per-workspace Meta credentials.
- Required by channel connection, token refresh, and message send flows.
- Current hardening audit already identified privileged token access around this surface.

### 2. `public.get_meta_decrypted_token(...)` and `public.store_meta_encrypted_token(...)`

Used by:

- `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-parity/supabase/functions/meta-auth-callback/index.ts`
- `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-parity/supabase/functions/meta-sync-channels/index.ts`
- `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-parity/supabase/functions/meta-refresh-tokens/index.ts`
- `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-parity/supabase/functions/facebook-messenger-webhook/index.ts`
- `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-parity/supabase/functions/instagram-webhook/index.ts`
- `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-parity/supabase/functions/send-reply/index.ts`
- `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-parity/src/integrations/supabase/types.ts`

Why it matters:

- These are security-critical token storage and decryption RPCs.
- Local parity cannot be trusted while the repo does not define them.

### 3. `public.elevenlabs_agents`

Used by:

- `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-parity/supabase/functions/elevenlabs-provision/index.ts`
- `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-parity/supabase/functions/elevenlabs-update-agent/index.ts`
- `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-parity/supabase/functions/elevenlabs-webhook/index.ts`
- `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-parity/src/hooks/useAiPhoneConfig.ts`
- `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-parity/src/integrations/supabase/types.ts`

Why it matters:

- This is the persistence layer for AI phone provisioning and agent configuration.
- It is part of premium execution and entitlements rollout.

### 4. `public.call_logs`

Used by:

- `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-parity/supabase/functions/retell-call-stats/index.ts`
- `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-parity/supabase/functions/elevenlabs-webhook/index.ts`
- `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-parity/supabase/functions/delete-caller-data/index.ts`
- `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-parity/src/hooks/useCallLogs.ts`
- `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-parity/src/lib/api/call-logs.ts`
- `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-parity/src/integrations/supabase/types.ts`

Why it matters:

- Required for AI phone stats, deletion flows, and UI history.
- Its absence from local migrations prevents any authoritative RLS or grants review on that path.

### 5. `public.ai_phone_usage` and `public.upsert_ai_phone_usage(...)`

Used by:

- `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-parity/supabase/functions/retell-call-stats/index.ts`
- `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-parity/supabase/functions/elevenlabs-webhook/index.ts`
- `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-parity/src/integrations/supabase/types.ts`

Why it matters:

- This is the likely usage ledger for AI phone billing and overage logic.
- Billing hardening cannot be signed off while the local repo does not define its schema or mutation RPC.

### 6. `public.workspace_channels` live behavior is ahead of the local migration model

Local definition:

- `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-parity/supabase/migrations/20251127140308_0f6c8ddf-5984-4a97-a53a-2c6b8c7eb596.sql`

Current code expects additional channels:

- `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-parity/supabase/functions/meta-auth-callback/index.ts`
- `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-parity/supabase/functions/meta-sync-channels/index.ts`
- `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-parity/supabase/functions/google-business-webhook/index.ts`
- `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-parity/src/lib/channels.ts`
- `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-parity/src/pages/ChannelsDashboard.tsx`
- `/Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-parity/src/pages/Reviews.tsx`

Why it matters:

- Local SQL still constrains `channel` to `sms`, `whatsapp`, `email`, `webchat`.
- Current app behavior uses `facebook`, `instagram`, and `google_business`.
- Even where the table exists locally, the local schema is not an accurate description of live behavior.

## Safest Recovery Sequence

This sequence is intended to restore local authority without rewriting remote history or guessing at missing SQL.

### 1. Freeze shared schema work until parity is recovered

- No new Supabase migrations should land on shared branches until the parity lane is merged.
- Continue app work only if it does not introduce new schema drift.

### 2. Capture remote evidence before changing anything

Persist the current live state into versioned audit artifacts:

```bash
cd /Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-parity
supabase migration list --linked > docs/audits/2026-04-11-linked-migration-list.txt
supabase db dump --linked --schema public --file docs/audits/2026-04-11-remote-public-schema.sql
supabase db dump --linked --schema storage --file docs/audits/2026-04-11-remote-storage-schema.sql
```

If `db dump --linked` is too noisy, keep the raw SQL dumps outside git but preserve them for the recovery lane.

### 3. Add timestamp-matched historical placeholder migrations for all 43 remote-only versions

Reasoning:

- The remote ledger already contains these versions.
- Rewriting or deleting remote migration history is the wrong move.
- Placeholder files restore ordered history locally and stop future CLI confusion about "remote-only" versions.

Each placeholder file should:

- use the exact remote version number
- contain only a header comment
- state that the migration was already applied remotely and the original SQL was unavailable
- include a pointer to this recovery note

Do not put guessed DDL into these placeholder files.

### 4. Add one forward reconciliation migration after `20260411201500`

Create a new migration that makes a fresh local reset converge to the current live schema.

That reconciliation migration should include, at minimum:

- creation or alignment of:
  - `public.meta_provider_configs`
  - `public.elevenlabs_agents`
  - `public.call_logs`
  - `public.ai_phone_usage`
- creation of:
  - `public.get_meta_decrypted_token(...)`
  - `public.store_meta_encrypted_token(...)`
  - `public.upsert_ai_phone_usage(...)`
- `public.workspace_channels` alignment for:
  - `facebook`
  - `instagram`
  - `google_business`
- any required RLS, grants, indexes, triggers, and foreign keys needed for those objects

This migration should be derived from the live schema, not from memory.

### 5. Validate replay from scratch

On a disposable local database:

```bash
cd /Users/michaelcarbon/Projects/BizzyBee/bizzybee-hardening-parity
supabase db reset
supabase gen types typescript --local > src/integrations/supabase/types.ts
```

Then compare the fresh local schema against the linked remote schema. The acceptance criterion is not "the migration list is clean"; it is "a fresh replay produces the same operational objects the app depends on."

### 6. Run targeted parity acceptance checks

Before calling parity restored, verify all of the following:

- `supabase migration list --linked` shows no remote-only entries
- local migrations now define the missing tables and RPCs above
- generated types still include those objects after a clean local reset
- channel migrations support `facebook`, `instagram`, and `google_business`
- a focused hardening re-audit can now inspect actual local definitions for:
  - policies
  - grants
  - security definer functions
  - billing/usage tables

### 7. Only then continue hardening and rollout work

The hardening audit should be rerun only after parity is restored. Until then, any conclusion about RLS, grants, or premium execution is provisional because the repo does not fully describe the live system.

## What Not To Do

- Do not rewrite remote migration history.
- Do not delete the already-applied `20260411170000`, `20260411181000`, `20260411194000`, or `20260411201500` migrations.
- Do not hide the gap with a single catch-all placeholder migration; preserve the exact 43 remote version numbers.
- Do not approve hard rollout based on generated types alone.

## Bottom Line

The parity problem is recoverable, but only if the repo starts representing the live March-April 2026 schema wave explicitly.

The safest path is:

1. preserve the exact remote-only ledger locally with timestamp-matched placeholders
2. add one forward reconciliation migration derived from the live schema
3. prove that a fresh local reset reproduces the live objects that current code already uses
