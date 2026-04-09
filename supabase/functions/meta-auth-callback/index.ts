import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ALLOWED_ORIGIN_PATTERNS: Array<string | RegExp> = [
  'https://bizzybee.app',
  'https://app.bizzybee.co.uk',
  'https://bizzybee-app.pages.dev',
  /^https:\/\/[a-z0-9-]+\.bizzybee-app\.pages\.dev$/,
  'http://localhost:5173',
  'http://localhost:8080',
];

function isAllowedOrigin(origin: string): boolean {
  return ALLOWED_ORIGIN_PATTERNS.some((pattern) =>
    typeof pattern === 'string' ? pattern === origin : pattern.test(origin),
  );
}

async function verifyStateSignature(signedState: string): Promise<string> {
  const dotIndex = signedState.lastIndexOf('.');
  if (dotIndex === -1) throw new Error('State parameter missing signature');

  const payload = signedState.slice(0, dotIndex);
  const receivedHmac = signedState.slice(dotIndex + 1);

  const secret = Deno.env.get('OAUTH_STATE_SECRET') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const expectedHmac = [...new Uint8Array(signature)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  if (receivedHmac !== expectedHmac) throw new Error('Invalid state signature');
  return payload;
}

function redirectToApp(
  origin: string,
  type: 'success' | 'error' | 'cancelled',
  params?: Record<string, string>,
) {
  const url = new URL('/onboarding', origin);
  url.searchParams.set('step', 'channels');
  url.searchParams.set('meta', type);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  return new Response(null, {
    status: 302,
    headers: {
      Location: url.toString(),
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  });
}

const GRAPH_API = 'https://graph.facebook.com/v19.0';

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const stateParam = url.searchParams.get('state');
  const errorParam = url.searchParams.get('error');
  const errorReason = url.searchParams.get('error_reason');

  // Fallback origin if state verification fails
  const fallbackOrigin = Deno.env.get('APP_URL') || 'https://bizzybee-app.pages.dev';

  // --- Handle user cancellation or Meta error ---
  if (errorParam) {
    console.warn('[meta-auth-callback] Meta returned error:', errorParam, errorReason);
    return redirectToApp(fallbackOrigin, errorParam === 'access_denied' ? 'cancelled' : 'error', {
      message: errorReason || errorParam,
    });
  }

  if (!code || !stateParam) {
    console.error('[meta-auth-callback] Missing code or state');
    return redirectToApp(fallbackOrigin, 'error', { message: 'Missing authorization code' });
  }

  // --- Verify state signature ---
  let workspaceId: string;
  let appOrigin: string;
  try {
    const rawPayload = await verifyStateSignature(stateParam);
    const stateData = JSON.parse(atob(rawPayload));
    workspaceId = stateData.workspaceId;
    appOrigin = stateData.origin || fallbackOrigin;

    if (!isAllowedOrigin(appOrigin)) {
      console.error('[meta-auth-callback] Origin not allowed:', appOrigin);
      appOrigin = fallbackOrigin;
    }
  } catch (err) {
    console.error('[meta-auth-callback] State verification failed:', err);
    return redirectToApp(fallbackOrigin, 'error', { message: 'Invalid state parameter' });
  }

  try {
    const META_APP_ID = Deno.env.get('META_APP_ID')!;
    const META_APP_SECRET = Deno.env.get('META_APP_SECRET')!;
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const redirectUri = `${SUPABASE_URL}/functions/v1/meta-auth-callback`;

    // Debug helper — writes to _meta_auth_debug table so we can see
    // exactly which step fails (console.log isn't visible in Supabase logs)
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const dbg = async (step: string, detail?: string) => {
      await supabaseAdmin
        .from('_meta_auth_debug')
        .insert({ step, detail: detail?.slice(0, 500) })
        .then(() => {});
    };

    await dbg('start', `workspace=${workspaceId}, appId=${META_APP_ID}, secret=${META_APP_SECRET.slice(0, 4)}...`);

    // --- Step 1: Exchange code for short-lived user token ---
    const tokenUrl = new URL(`${GRAPH_API}/oauth/access_token`);
    tokenUrl.searchParams.set('client_id', META_APP_ID);
    tokenUrl.searchParams.set('client_secret', META_APP_SECRET);
    tokenUrl.searchParams.set('redirect_uri', redirectUri);
    tokenUrl.searchParams.set('code', code);

    const tokenRes = await fetch(tokenUrl.toString());
    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      await dbg('step1_FAIL', `status=${tokenRes.status} body=${body}`);
      return redirectToApp(appOrigin, 'error', {
        message: `Token exchange failed (${tokenRes.status}): ${body.slice(0, 100)}`,
      });
    }
    const tokenData = await tokenRes.json();
    const shortLivedToken = tokenData.access_token;
    await dbg('step1_OK', `hasToken=${!!shortLivedToken}, tokenLen=${shortLivedToken?.length}`);

    // --- Step 2: Exchange for long-lived user token (60 days) ---
    const longLivedUrl = new URL(`${GRAPH_API}/oauth/access_token`);
    longLivedUrl.searchParams.set('grant_type', 'fb_exchange_token');
    longLivedUrl.searchParams.set('client_id', META_APP_ID);
    longLivedUrl.searchParams.set('client_secret', META_APP_SECRET);
    longLivedUrl.searchParams.set('fb_exchange_token', shortLivedToken);

    const longLivedRes = await fetch(longLivedUrl.toString());
    const longLivedBody = await longLivedRes.text();
    let longLivedData: Record<string, unknown> | null = null;
    try {
      longLivedData = JSON.parse(longLivedBody);
    } catch {
      // not JSON
    }
    await dbg('step2', `ok=${longLivedRes.ok}, status=${longLivedRes.status}, body=${longLivedBody.slice(0, 200)}`);

    const longLivedUserToken = (longLivedData?.access_token as string) || shortLivedToken;
    const expiresInSeconds = (longLivedData?.expires_in as number) || 3600;

    // --- Step 3: Get list of Pages the user manages ---
    const pagesRes = await fetch(
      `${GRAPH_API}/me/accounts?access_token=${longLivedUserToken}&fields=id,name,access_token`,
    );
    const pagesBody = await pagesRes.text();
    await dbg('step3_raw', `ok=${pagesRes.ok}, status=${pagesRes.status}, body=${pagesBody.slice(0, 300)}`);

    if (!pagesRes.ok) {
      return redirectToApp(appOrigin, 'error', { message: `Could not fetch Pages: ${pagesBody.slice(0, 100)}` });
    }

    let pagesData: { data?: Array<{ id: string; name: string; access_token: string }> };
    try {
      pagesData = JSON.parse(pagesBody);
    } catch {
      await dbg('step3_PARSE_FAIL', pagesBody.slice(0, 200));
      return redirectToApp(appOrigin, 'error', { message: 'Invalid response from Facebook Pages API' });
    }

    const pages = pagesData.data || [];
    await dbg('step3_pages', `count=${pages.length}, names=${pages.map((p) => p.name).join(',')}`);

    if (pages.length === 0) {
      return redirectToApp(appOrigin, 'error', {
        message: 'No Facebook Pages found. Make sure you manage at least one Page.',
      });
    }

    // Use the first page (MVP — multi-page selection is a v2 enhancement)
    const page = pages[0];
    const pageId = page.id;
    const pageName = page.name;
    const pageAccessToken = page.access_token; // Long-lived when user token is long-lived

    console.log(`[meta-auth-callback] Using Page: ${pageName} (${pageId})`);

    // --- Step 4: Check for linked Instagram Business account ---
    let instagramAccountId: string | null = null;
    let instagramUsername: string | null = null;
    try {
      const igRes = await fetch(
        `${GRAPH_API}/${pageId}?fields=instagram_business_account{id,username}&access_token=${pageAccessToken}`,
      );
      if (igRes.ok) {
        const igData = await igRes.json();
        if (igData.instagram_business_account) {
          instagramAccountId = igData.instagram_business_account.id;
          instagramUsername = igData.instagram_business_account.username || null;
          console.log(
            `[meta-auth-callback] Found linked Instagram: @${instagramUsername} (${instagramAccountId})`,
          );
        } else {
          console.log('[meta-auth-callback] No Instagram Business account linked to this Page');
        }
      }
    } catch (igErr) {
      console.warn('[meta-auth-callback] Instagram check failed (non-fatal):', igErr);
    }

    // --- Step 5: Subscribe Page to messaging webhook ---
    try {
      const subRes = await fetch(
        `${GRAPH_API}/${pageId}/subscribed_apps?subscribed_fields=messages,messaging_postbacks&access_token=${pageAccessToken}`,
        { method: 'POST' },
      );
      if (!subRes.ok) {
        const body = await subRes.text();
        console.warn('[meta-auth-callback] Webhook subscription failed (non-fatal):', body);
      } else {
        console.log('[meta-auth-callback] Page subscribed to messaging webhooks');
      }
    } catch (subErr) {
      console.warn('[meta-auth-callback] Webhook subscription error (non-fatal):', subErr);
    }

    // --- Step 6: Store credentials in meta_provider_configs ---
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Get the user's ID from the state (we stored it during auth-start)
    let metaUserId: string | null = null;
    try {
      const meRes = await fetch(`${GRAPH_API}/me?access_token=${longLivedUserToken}`);
      if (meRes.ok) {
        const meData = await meRes.json();
        metaUserId = meData.id || null;
      }
    } catch {
      // Non-fatal
    }

    const tokenExpiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

    // Upsert meta_provider_configs — use placeholder for encrypted token,
    // then call the RPC to encrypt it properly
    const { data: configData, error: configError } = await supabase
      .from('meta_provider_configs')
      .upsert(
        {
          workspace_id: workspaceId,
          page_id: pageId,
          page_name: pageName,
          instagram_account_id: instagramAccountId,
          instagram_username: instagramUsername,
          encrypted_page_access_token: '__PENDING_ENCRYPTION__',
          token_expires_at: tokenExpiresAt,
          meta_user_id: metaUserId,
          status: 'active',
          connected_at: new Date().toISOString(),
        },
        { onConflict: 'workspace_id,page_id' },
      )
      .select('id')
      .single();

    if (configError) {
      console.error('[meta-auth-callback] Failed to store config:', configError);
      return redirectToApp(appOrigin, 'error', { message: 'Failed to save connection' });
    }

    // Encrypt the token via RPC
    const { error: encryptError } = await supabase.rpc('store_meta_encrypted_token', {
      p_config_id: configData.id,
      p_page_access_token: pageAccessToken,
    });

    if (encryptError) {
      console.error('[meta-auth-callback] Token encryption failed:', encryptError);
      // Token was saved as placeholder — clean up
      await supabase.from('meta_provider_configs').delete().eq('id', configData.id);
      return redirectToApp(appOrigin, 'error', { message: 'Failed to secure connection token' });
    }

    // --- Step 7: Upsert workspace_channels ---
    // Facebook Messenger channel
    await supabase
      .from('workspace_channels')
      .upsert(
        {
          workspace_id: workspaceId,
          channel: 'facebook',
          enabled: true,
          automation_level: 'draft_only',
          config: { pageId, pageName },
        },
        { onConflict: 'workspace_id,channel' },
      )
      .then(({ error }) => {
        if (error) console.error('[meta-auth-callback] Facebook channel upsert error:', error);
      });

    // Instagram channel (if linked)
    if (instagramAccountId) {
      await supabase
        .from('workspace_channels')
        .upsert(
          {
            workspace_id: workspaceId,
            channel: 'instagram',
            enabled: true,
            automation_level: 'draft_only',
            config: { instagramAccountId, username: instagramUsername },
          },
          { onConflict: 'workspace_id,channel' },
        )
        .then(({ error }) => {
          if (error) console.error('[meta-auth-callback] Instagram channel upsert error:', error);
        });
    }

    console.log(
      `[meta-auth-callback] Success! Connected Page "${pageName}"${instagramUsername ? ` + Instagram @${instagramUsername}` : ''}`,
    );

    // --- Step 8: Redirect back to app ---
    return redirectToApp(appOrigin, 'success', {
      meta_connected: 'true',
      page_name: pageName,
      ...(instagramUsername ? { instagram: instagramUsername } : {}),
    });
  } catch (err) {
    console.error('[meta-auth-callback] Unexpected error:', err);
    return redirectToApp(appOrigin, 'error', {
      message: err instanceof Error ? err.message.slice(0, 200) : 'Unexpected error',
    });
  }
});
