# Meta Direct Integration (Facebook Messenger + Instagram DMs) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Connect with Facebook" OAuth button that connects a workspace's Facebook Page + Instagram account, enabling inbound/outbound messaging on both channels through the existing webhook handlers.

**Architecture:** Facebook Login for Business redirect flow (mirrors the existing Aurinko OAuth pattern). One consent screen grants Messenger + Instagram permissions. Per-workspace Page Access Tokens stored encrypted in a new `meta_provider_configs` table. Existing webhook handlers and send-reply updated to use per-workspace tokens instead of a single global env var.

**Tech Stack:** Supabase Edge Functions (Deno/TypeScript), Meta Graph API v19.0, React + TypeScript frontend, pgp_sym_encrypt for token storage.

---

## Day 1: Database + Auth Flow

### Task 1: Fix database CHECK constraints

The `workspace_channels` table has a CHECK constraint that only allows `('sms','whatsapp','email','webchat')`. Facebook and Instagram INSERTs will fail without this fix. The `conversations` and `messages` tables may also have constraints — fix them all.

**Files:**

- Create: Supabase migration via MCP

**Step 1: Query current constraints**

Run via Supabase MCP `execute_sql`:

```sql
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid IN (
  'public.workspace_channels'::regclass,
  'public.conversations'::regclass,
  'public.messages'::regclass
)
AND contype = 'c'
ORDER BY conrelid::text, conname;
```

**Step 2: Apply migration to widen constraints**

Run via Supabase MCP `apply_migration` (name: `widen_channel_check_constraints`):

```sql
-- Allow facebook, instagram, google_business, phone in all channel columns.
-- Existing data is unaffected — we're only ADDING allowed values.

DO $$
DECLARE
  r RECORD;
BEGIN
  -- Drop any CHECK constraints on workspace_channels.channel
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.workspace_channels'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%channel%'
  LOOP
    EXECUTE 'ALTER TABLE public.workspace_channels DROP CONSTRAINT ' || quote_ident(r.conname);
  END LOOP;

  -- Drop any CHECK constraints on conversations.channel
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.conversations'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%channel%'
  LOOP
    EXECUTE 'ALTER TABLE public.conversations DROP CONSTRAINT ' || quote_ident(r.conname);
  END LOOP;

  -- Drop any CHECK constraints on messages.channel
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.messages'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%channel%'
  LOOP
    EXECUTE 'ALTER TABLE public.messages DROP CONSTRAINT ' || quote_ident(r.conname);
  END LOOP;
END $$;

-- Re-add with the full set of supported channels
ALTER TABLE public.workspace_channels ADD CONSTRAINT workspace_channels_channel_check
  CHECK (channel IN ('email','sms','whatsapp','facebook','instagram','google_business','webchat','phone'));

ALTER TABLE public.conversations ADD CONSTRAINT conversations_channel_check
  CHECK (channel IN ('email','sms','whatsapp','facebook','instagram','google_business','webchat','phone'));

ALTER TABLE public.messages ADD CONSTRAINT messages_channel_check
  CHECK (channel IN ('email','sms','whatsapp','facebook','instagram','google_business','webchat','phone'));
```

**Step 3: Verify constraints**

Run the same query from Step 1. Expected: three constraints, each allowing the full channel set.

---

### Task 2: Create meta_provider_configs table + RPC

**Files:**

- Create: Supabase migration via MCP

**Step 1: Apply migration**

Run via Supabase MCP `apply_migration` (name: `create_meta_provider_configs`):

```sql
-- Per-workspace Meta credentials for Facebook Messenger + Instagram DMs.
-- One row per Facebook Page. If the Page has a linked Instagram Business
-- account, both channels share the same row and the same Page Access Token.

CREATE TABLE public.meta_provider_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
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

ALTER TABLE public.meta_provider_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to meta_provider_configs"
  ON public.meta_provider_configs FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Workspace members can read their meta provider configs"
  ON public.meta_provider_configs FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = meta_provider_configs.workspace_id
      AND wm.user_id = auth.uid()
  ));

GRANT SELECT ON public.meta_provider_configs TO authenticated;

-- RPC to encrypt and store a Meta Page Access Token.
-- Same pattern as store_encrypted_token but for meta_provider_configs.
CREATE OR REPLACE FUNCTION public.store_meta_encrypted_token(
  p_config_id uuid,
  p_page_access_token text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_secret text;
BEGIN
  v_secret := current_setting('app.settings.token_encryption_secret', true);
  IF v_secret IS NOT NULL AND v_secret != '' THEN
    UPDATE public.meta_provider_configs
    SET encrypted_page_access_token = pgp_sym_encrypt(p_page_access_token, v_secret)
    WHERE id = p_config_id;
  ELSE
    UPDATE public.meta_provider_configs
    SET encrypted_page_access_token = p_page_access_token
    WHERE id = p_config_id;
  END IF;
END;
$$;

-- RPC to decrypt a Meta Page Access Token (called by edge functions).
CREATE OR REPLACE FUNCTION public.get_meta_decrypted_token(
  p_config_id uuid
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_secret text;
  v_encrypted text;
BEGIN
  v_secret := current_setting('app.settings.token_encryption_secret', true);

  SELECT encrypted_page_access_token INTO v_encrypted
  FROM public.meta_provider_configs
  WHERE id = p_config_id;

  IF v_encrypted IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_secret IS NOT NULL AND v_secret != '' THEN
    RETURN pgp_sym_decrypt(v_encrypted::bytea, v_secret);
  ELSE
    RETURN v_encrypted;
  END IF;
END;
$$;
```

**Step 2: Verify**

Run via `execute_sql`:

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'meta_provider_configs' ORDER BY ordinal_position;
```

---

### Task 3: Fix types.ts and unified-ingest

**Files:**

- Modify: `supabase/functions/_shared/types.ts` line 1
- Modify: `supabase/functions/unified-ingest/index.ts` line 4

**Step 1: Update Channel type**

In `supabase/functions/_shared/types.ts` line 1, change:

```typescript
export type Channel = 'email' | 'whatsapp' | 'sms' | 'facebook' | 'voice';
```

to:

```typescript
export type Channel =
  | 'email'
  | 'whatsapp'
  | 'sms'
  | 'facebook'
  | 'instagram'
  | 'google_business'
  | 'voice';
```

**Step 2: Update VALID_CHANNELS**

In `supabase/functions/unified-ingest/index.ts` line 4, change:

```typescript
const VALID_CHANNELS = new Set<Channel>(['email', 'whatsapp', 'sms', 'facebook', 'voice']);
```

to:

```typescript
const VALID_CHANNELS = new Set<Channel>([
  'email',
  'whatsapp',
  'sms',
  'facebook',
  'instagram',
  'google_business',
  'voice',
]);
```

**Step 3: Commit**

```
git add supabase/functions/_shared/types.ts supabase/functions/unified-ingest/index.ts
git commit -m "feat: add instagram and google_business to Channel type and valid channels"
```

---

### Task 4: Build meta-auth-start edge function

Clone the pattern from `aurinko-auth-start/index.ts`. This function generates a Facebook Login for Business OAuth URL and returns it to the frontend.

**Files:**

- Create: `supabase/functions/meta-auth-start/index.ts`
- Reference: `supabase/functions/aurinko-auth-start/index.ts` (lines 8-22 for signState, lines 61-87 for URL generation)

**Step 1: Create the edge function**

Create `supabase/functions/meta-auth-start/index.ts` with:

```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Reuse the same HMAC signing pattern from aurinko-auth-start
async function signState(payload: string): Promise<string> {
  const secret = Deno.env.get('OAUTH_STATE_SECRET') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const hmacHex = [...new Uint8Array(signature)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${payload}.${hmacHex}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Validate auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { workspaceId, origin } = await req.json();
    if (!workspaceId || !origin) {
      return new Response(JSON.stringify({ error: 'workspaceId and origin required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const META_APP_ID = Deno.env.get('META_APP_ID');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');

    if (!META_APP_ID || !SUPABASE_URL) {
      return new Response(JSON.stringify({ error: 'Meta integration not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Build signed state (same pattern as Aurinko)
    const statePayload = btoa(JSON.stringify({ workspaceId, origin, userId: user.id }));
    const signedState = await signState(statePayload);

    const redirectUri = `${SUPABASE_URL}/functions/v1/meta-auth-callback`;

    const scopes = [
      'pages_messaging',
      'pages_manage_metadata',
      'pages_show_list',
      'instagram_basic',
      'instagram_manage_messages',
    ].join(',');

    const authUrl = new URL('https://www.facebook.com/v19.0/dialog/oauth');
    authUrl.searchParams.set('client_id', META_APP_ID);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('scope', scopes);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('state', signedState);

    return new Response(JSON.stringify({ authUrl: authUrl.toString() }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[meta-auth-start]', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
```

**Step 2: Deploy**

```bash
supabase functions deploy meta-auth-start --no-verify-jwt
```

Or via Supabase MCP `deploy_edge_function`.

**Step 3: Commit**

```
git add supabase/functions/meta-auth-start/
git commit -m "feat: add meta-auth-start edge function for Facebook Login OAuth"
```

---

### Task 5: Build meta-auth-callback edge function

This is the largest single task. It handles Meta's OAuth redirect, exchanges tokens, fetches Pages and Instagram accounts, subscribes to webhooks, and stores credentials.

**Files:**

- Create: `supabase/functions/meta-auth-callback/index.ts`
- Reference: `supabase/functions/aurinko-auth-callback/index.ts` (lines 8-22 for verifyState, lines 45-83 for redirect helpers, lines 162-168 for token exchange, lines 328-332 for store_encrypted_token)

**Step 1: Create the edge function**

Create `supabase/functions/meta-auth-callback/index.ts`. This is ~200 lines. Key responsibilities:

1. Verify HMAC-signed state
2. Exchange `code` for short-lived user token → exchange for long-lived user token
3. GET `/me/accounts` → list Pages with long-lived Page Access Tokens
4. For each Page: check for linked Instagram Business account
5. Subscribe Page to messaging webhook
6. Store encrypted token in `meta_provider_configs`
7. Upsert `workspace_channels` rows
8. Redirect back to app

The full implementation should follow the exact pattern from `aurinko-auth-callback/index.ts` for:

- State verification (lines 8-22 pattern but reversed for verify)
- Redirect URL building (lines 45-69 pattern)
- Error handling with user-facing redirects (lines 71-83 pattern)

Key Meta Graph API calls in the callback:

```
POST https://graph.facebook.com/v19.0/oauth/access_token
  ?client_id={app_id}
  &client_secret={app_secret}
  &redirect_uri={redirect_uri}
  &code={code}
→ { access_token: "short-lived-user-token", token_type, expires_in }

GET https://graph.facebook.com/v19.0/oauth/access_token
  ?grant_type=fb_exchange_token
  &client_id={app_id}
  &client_secret={app_secret}
  &fb_exchange_token={short_lived_token}
→ { access_token: "long-lived-user-token", token_type, expires_in: 5184000 }

GET https://graph.facebook.com/v19.0/me/accounts
  ?access_token={long_lived_user_token}
  &fields=id,name,access_token
→ { data: [{ id: "PAGE_ID", name: "Page Name", access_token: "long-lived-page-token" }] }

GET https://graph.facebook.com/v19.0/{PAGE_ID}
  ?fields=instagram_business_account{id,username}
  &access_token={page_token}
→ { instagram_business_account: { id: "IG_ID", username: "handle" } } (or absent)

POST https://graph.facebook.com/v19.0/{PAGE_ID}/subscribed_apps
  ?subscribed_fields=messages,messaging_postbacks
  &access_token={page_token}
→ { success: true }
```

After all API calls succeed:

- INSERT into `meta_provider_configs` (using service role client)
- Call `store_meta_encrypted_token` RPC
- UPSERT into `workspace_channels` for facebook (config: `{ pageId, pageName }`)
- UPSERT into `workspace_channels` for instagram if linked (config: `{ instagramAccountId, username }`)
- Redirect to `{origin}/onboarding?meta_connected=true&page_name={pageName}`

Env vars needed: `META_APP_ID`, `META_APP_SECRET` (already exists), `OAUTH_STATE_SECRET` or `SUPABASE_SERVICE_ROLE_KEY` (already exists).

**Step 2: Deploy**

Deploy via Supabase MCP. No JWT verification needed (this receives redirects from Meta, not authenticated API calls).

**Step 3: Commit**

```
git add supabase/functions/meta-auth-callback/
git commit -m "feat: add meta-auth-callback edge function for Meta OAuth token exchange"
```

---

## Day 2: Webhook Updates + Frontend

### Task 6: Update facebook-messenger-webhook for per-workspace tokens

**Files:**

- Modify: `supabase/functions/facebook-messenger-webhook/index.ts` around line 137

**Step 1: Add per-workspace token lookup**

After the workspace routing at line 113, add a lookup for the per-workspace token. Replace the global `META_PAGE_ACCESS_TOKEN` read at line 137 with:

```typescript
// Try per-workspace token first, fall back to global env var
let pageAccessToken: string | undefined;
const { data: metaConfig } = await supabase
  .from('meta_provider_configs')
  .select('id')
  .eq('workspace_id', workspaceId)
  .eq('status', 'active')
  .maybeSingle();

if (metaConfig) {
  const { data: decrypted } = await supabase.rpc('get_meta_decrypted_token', {
    p_config_id: metaConfig.id,
  });
  if (decrypted) pageAccessToken = decrypted;
}

if (!pageAccessToken) {
  pageAccessToken = Deno.env.get('META_PAGE_ACCESS_TOKEN');
}
```

Use `pageAccessToken` everywhere the function currently reads the env var.

**Step 2: Deploy + test**

Deploy via Supabase MCP. Test by sending a test message to the Facebook Page.

**Step 3: Commit**

```
git add supabase/functions/facebook-messenger-webhook/
git commit -m "feat: facebook webhook uses per-workspace Meta token with global fallback"
```

---

### Task 7: Update instagram-webhook for per-workspace tokens

**Files:**

- Modify: `supabase/functions/instagram-webhook/index.ts` around line 144

**Step 1: Same pattern as Task 6**

Identical change — add per-workspace token lookup after workspace routing. Replace the global `META_PAGE_ACCESS_TOKEN` read at line 144.

**Step 2: Deploy + commit**

```
git add supabase/functions/instagram-webhook/
git commit -m "feat: instagram webhook uses per-workspace Meta token with global fallback"
```

---

### Task 8: Update send-reply for per-workspace tokens

**Files:**

- Modify: `supabase/functions/send-reply/index.ts` lines 388-450 (facebook/instagram case)

**Step 1: Replace global token with per-workspace lookup**

In the `case 'facebook': case 'instagram':` block (line 388), replace:

```typescript
const pageAccessToken = Deno.env.get('META_PAGE_ACCESS_TOKEN');
if (!pageAccessToken) {
  throw new Error('META_PAGE_ACCESS_TOKEN not configured.');
}
```

With the same per-workspace lookup pattern from Task 6 (using the conversation's workspace_id, which should already be available in the send-reply flow).

**Step 2: Deploy + commit**

```
git add supabase/functions/send-reply/
git commit -m "feat: send-reply uses per-workspace Meta token for facebook/instagram outbound"
```

---

### Task 9: Build meta-data-deletion-callback

Required by Meta for App Review. Receives signed POST when a user requests data deletion.

**Files:**

- Create: `supabase/functions/meta-data-deletion-callback/index.ts`

**Step 1: Create the edge function (~60 lines)**

Key responsibilities:

- Verify `X-Hub-Signature-256` using `META_APP_SECRET`
- Parse the `signed_request` from the POST body
- Look up and soft-delete (set status='deleted') any `meta_provider_configs` rows for that user
- Return JSON with `{ url: "https://bizzybee.co.uk/data-deletion-status?id={confirmation_code}", confirmation_code: "{uuid}" }`

**Step 2: Deploy + commit**

```
git add supabase/functions/meta-data-deletion-callback/
git commit -m "feat: add meta-data-deletion-callback for Meta App Review compliance"
```

---

### Task 10: Add "Connect with Facebook" button

**Files:**

- Modify: `src/components/settings/ChannelManagementPanel.tsx`
- Modify: `src/lib/channels.ts`

**Step 1: Update channel definitions**

In `src/lib/channels.ts`, change `setupMode` for facebook and instagram from `'account_linking'` to `'self_serve'`:

```typescript
facebook: {
  // ...
  setupMode: 'self_serve',  // was 'account_linking'
}
instagram: {
  // ...
  setupMode: 'self_serve',  // was 'account_linking'
}
```

**Step 2: Add Meta OAuth handler to ChannelManagementPanel**

In `src/components/settings/ChannelManagementPanel.tsx`, add a `handleConnectMeta` function (mirror `handleConnectEmail` at lines 319-368):

```typescript
const handleConnectMeta = async () => {
  if (!activeWorkspaceId) {
    toast({ title: 'Workspace not loaded', variant: 'destructive' });
    return;
  }
  setConnecting(true);
  try {
    const { data, error } = await supabase.functions.invoke('meta-auth-start', {
      body: { workspaceId: activeWorkspaceId, origin: window.location.origin },
    });
    if (error) throw error;
    if (data?.authUrl) {
      window.location.href = data.authUrl;
    } else {
      toast({ title: 'Failed to get Facebook auth URL', variant: 'destructive' });
      setConnecting(false);
    }
  } catch (err) {
    logger.error('Error starting Meta OAuth', err);
    toast({ title: 'Failed to connect Facebook', variant: 'destructive' });
    setConnecting(false);
  }
};
```

**Step 3: Update renderConnectionAction**

In the `renderConnectionAction` function (around line 743), add a case for facebook/instagram that shows a "Connect with Facebook" button calling `handleConnectMeta`:

```typescript
if (
  (definition.key === 'facebook' || definition.key === 'instagram') &&
  state === 'needs_connection'
) {
  return (
    <Button size="sm" variant="outline" onClick={handleConnectMeta} disabled={connecting}>
      {connecting ? 'Connecting...' : 'Connect with Facebook'}
    </Button>
  );
}
```

**Step 4: Handle ?meta_connected redirect**

Add a useEffect (mirror the email_connected handler at lines 264-282):

```typescript
useEffect(() => {
  const metaConnected = searchParams.get('meta_connected');
  const pageName = searchParams.get('page_name');

  if (metaConnected === 'true') {
    toast({
      title: 'Facebook connected!',
      description: pageName
        ? `${pageName} is now connected for Messenger and Instagram.`
        : 'Messenger and Instagram are ready.',
    });
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('meta_connected');
    nextParams.delete('page_name');
    setSearchParams(nextParams, { replace: true });
    void refresh();
  }
}, [refresh, searchParams, setSearchParams, toast]);
```

**Step 5: Commit**

```
git add src/lib/channels.ts src/components/settings/ChannelManagementPanel.tsx
git commit -m "feat: Connect with Facebook button for Messenger + Instagram OAuth"
```

---

## Day 3: Token Refresh + Testing + Deploy

### Task 11: Build meta-refresh-tokens scheduled function

**Files:**

- Create: `supabase/functions/meta-refresh-tokens/index.ts`

**Step 1: Create the function (~50 lines)**

- Query `meta_provider_configs` where `token_expires_at < now() + interval '7 days'` and `status = 'active'`
- For each, call `GET /oauth/access_token?grant_type=fb_exchange_token&client_id=...&client_secret=...&fb_exchange_token={current_token}`
- Update with new encrypted token and new expiry
- On failure, set `status = 'token_expired'`
- Schedule via pg_cron or a Supabase scheduled invocation (daily)

**Step 2: Deploy + commit**

```
git add supabase/functions/meta-refresh-tokens/
git commit -m "feat: add meta-refresh-tokens for 60-day Page Access Token renewal"
```

---

### Task 12: Add META_APP_ID to Supabase secrets

**Step 1: Set the environment variable**

Via Supabase dashboard or CLI, add `META_APP_ID` to the Edge Function secrets. The value comes from the Meta App Dashboard (Settings > Basic > App ID).

`META_APP_SECRET` and `META_VERIFY_TOKEN` should already be set (they're used by the existing webhook handlers).

---

### Task 13: Configure Meta App Dashboard

This is Michael's task, guided by Claude. Checklist:

1. Go to developers.facebook.com → Your Apps → Select BizzyBee app
2. Add products: **Facebook Login for Business**, **Messenger**, **Instagram**
3. Facebook Login for Business settings:
   - Valid OAuth Redirect URIs: `https://atukvssploxwyqpwjmrc.supabase.co/functions/v1/meta-auth-callback`
4. Messenger settings:
   - Webhook callback URL: `https://atukvssploxwyqpwjmrc.supabase.co/functions/v1/facebook-messenger-webhook`
   - Verify token: value of `META_VERIFY_TOKEN`
   - Subscribe to: `messages`, `messaging_postbacks`
5. Instagram settings:
   - Webhook callback URL: `https://atukvssploxwyqpwjmrc.supabase.co/functions/v1/instagram-webhook`
   - Same verify token
   - Subscribe to: `messages`
6. App Settings > Basic:
   - App icon (1024x1024)
   - Privacy policy URL
   - Data deletion callback URL: `https://atukvssploxwyqpwjmrc.supabase.co/functions/v1/meta-data-deletion-callback`

---

### Task 14: End-to-end testing in development mode

**Test 1: OAuth flow**

1. Navigate to channels step in onboarding
2. Click "Connect with Facebook" on the Facebook card
3. Should redirect to Facebook consent screen
4. Grant permissions, pick a Page
5. Should redirect back to BizzyBee with `?meta_connected=true`
6. Facebook card should show "Ready"
7. If Page has linked Instagram, Instagram card should also show "Ready"

**Test 2: Inbound Messenger**

1. From a test Facebook account (with developer role on the app), send a message to the connected Page
2. Message should appear as a new conversation in BizzyBee with channel='facebook'

**Test 3: Outbound Messenger**

1. Reply to the conversation from BizzyBee
2. Reply should appear in the Facebook Messenger chat

**Test 4: Inbound Instagram**

1. From a test Instagram account, send a DM to the connected Instagram Business account
2. Message should appear as a new conversation with channel='instagram'

**Test 5: Outbound Instagram**

1. Reply from BizzyBee
2. Reply should appear in the Instagram DM thread

**Test 6: Token storage**

```sql
SELECT id, workspace_id, page_id, page_name, instagram_account_id,
       instagram_username, status, token_expires_at
FROM meta_provider_configs;
```

Verify encrypted_page_access_token is NOT plaintext.

---

### Task 15: Submit for App Review

Once E2E tests pass:

1. Record screencast videos (Michael):
   - Messenger flow: inbound → BizzyBee inbox → reply → appears in Messenger
   - Instagram flow: same
   - Privacy policy visible
   - Permission denial handling

2. Write permission justifications:
   - `pages_messaging`: "BizzyBee is an AI customer service platform. We use pages_messaging to receive customer enquiries sent to our users' Facebook Pages and send replies on their behalf, so small businesses can manage all their customer messages in one inbox."
   - `instagram_manage_messages`: Same justification adapted for Instagram DMs.
   - `pages_manage_metadata`: "Required to subscribe Facebook Pages to our webhook endpoint so BizzyBee receives real-time message notifications."

3. Provide test credentials for the Meta reviewer

4. Submit via App Dashboard > App Review > Permissions and Features

---

## Summary of all files created/modified

| Action       | File                                                                 |
| ------------ | -------------------------------------------------------------------- |
| Create       | `supabase/functions/meta-auth-start/index.ts`                        |
| Create       | `supabase/functions/meta-auth-callback/index.ts`                     |
| Create       | `supabase/functions/meta-data-deletion-callback/index.ts`            |
| Create       | `supabase/functions/meta-refresh-tokens/index.ts`                    |
| Modify       | `supabase/functions/facebook-messenger-webhook/index.ts` (~20 lines) |
| Modify       | `supabase/functions/instagram-webhook/index.ts` (~20 lines)          |
| Modify       | `supabase/functions/send-reply/index.ts` (~15 lines)                 |
| Modify       | `supabase/functions/unified-ingest/index.ts` (1 line)                |
| Modify       | `supabase/functions/_shared/types.ts` (1 line)                       |
| Modify       | `src/lib/channels.ts` (2 lines)                                      |
| Modify       | `src/components/settings/ChannelManagementPanel.tsx` (~50 lines)     |
| DB migration | `widen_channel_check_constraints`                                    |
| DB migration | `create_meta_provider_configs`                                       |
