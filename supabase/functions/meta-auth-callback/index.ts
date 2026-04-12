import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ALLOWED_ORIGIN_PATTERNS: Array<string | RegExp> = [
  'https://bizzybee.app',
  'https://bizzyb.ee',
  'https://bizzybee.ee',
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

  const secret = Deno.env.get('OAUTH_STATE_SECRET')?.trim();
  if (!secret) throw new Error('OAUTH_STATE_SECRET not configured');
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

type MetaPage = {
  id: string;
  name: string;
  access_token: string;
};

type MetaPageCandidate = MetaPage & {
  discoveryIndex: number;
  instagramAccountId: string | null;
  instagramUsername: string | null;
  selectionScore: number;
  selectionReason: string;
};

async function discoverPageInstagram(
  page: MetaPage,
  discoveryIndex: number,
): Promise<MetaPageCandidate> {
  let instagramAccountId: string | null = null;
  let instagramUsername: string | null = null;
  let selectionScore = 0;
  let selectionReason = 'No linked Instagram asset found';

  try {
    const igRes = await fetch(
      `${GRAPH_API}/${page.id}?fields=instagram_business_account{id,username}&access_token=${page.access_token}`,
    );
    if (igRes.ok) {
      const igData = await igRes.json();
      if (igData.instagram_business_account) {
        instagramAccountId = igData.instagram_business_account.id;
        instagramUsername = igData.instagram_business_account.username || null;
        selectionScore = 100;
        selectionReason = 'Matched via Page query';
      }
    }
  } catch (error) {
    console.warn('[meta-auth-callback] Page Instagram query failed:', page.id, error);
  }

  if (!instagramAccountId) {
    try {
      const pbiRes = await fetch(
        `${GRAPH_API}/${page.id}/page_backed_instagram_accounts?access_token=${page.access_token}&fields=id,username`,
      );
      if (pbiRes.ok) {
        const pbiData = await pbiRes.json();
        if (pbiData?.data?.length > 0) {
          instagramAccountId = pbiData.data[0].id;
          instagramUsername = pbiData.data[0].username || null;
          selectionScore = 80;
          selectionReason = 'Matched via page_backed_instagram_accounts';
        }
      }
    } catch (error) {
      console.warn('[meta-auth-callback] Page-backed Instagram query failed:', page.id, error);
    }
  }

  return {
    ...page,
    discoveryIndex,
    instagramAccountId,
    instagramUsername,
    selectionScore,
    selectionReason,
  };
}

async function discoverWorkspaceInstagram(
  longLivedUserToken: string,
): Promise<{ instagramAccountId: string; instagramUsername: string | null } | null> {
  try {
    const bizRes = await fetch(
      `${GRAPH_API}/me/businesses?access_token=${longLivedUserToken}&fields=id,name`,
    );
    if (!bizRes.ok) {
      return null;
    }

    const bizData = await bizRes.json();
    for (const biz of bizData?.data || []) {
      const igAccRes = await fetch(
        `${GRAPH_API}/${biz.id}/instagram_accounts?access_token=${longLivedUserToken}&fields=id,username`,
      );
      if (igAccRes.ok) {
        const igAccData = await igAccRes.json();
        if (igAccData?.data?.length > 0) {
          return {
            instagramAccountId: igAccData.data[0].id,
            instagramUsername: igAccData.data[0].username || null,
          };
        }
      }

      const ownedIgRes = await fetch(
        `${GRAPH_API}/${biz.id}/owned_instagram_accounts?access_token=${longLivedUserToken}&fields=id,username`,
      );
      if (ownedIgRes.ok) {
        const ownedIgData = await ownedIgRes.json();
        if (ownedIgData?.data?.length > 0) {
          return {
            instagramAccountId: ownedIgData.data[0].id,
            instagramUsername: ownedIgData.data[0].username || null,
          };
        }
      }
    }
  } catch (error) {
    console.warn('[meta-auth-callback] Business Instagram check failed:', error);
  }

  return null;
}

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

    // --- Step 1: Exchange code for short-lived user token ---
    console.log('[meta-auth-callback] Exchanging code for token...');
    const tokenUrl = new URL(`${GRAPH_API}/oauth/access_token`);
    tokenUrl.searchParams.set('client_id', META_APP_ID);
    tokenUrl.searchParams.set('client_secret', META_APP_SECRET);
    tokenUrl.searchParams.set('redirect_uri', redirectUri);
    tokenUrl.searchParams.set('code', code);

    const tokenRes = await fetch(tokenUrl.toString());
    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      console.error('[meta-auth-callback] Token exchange failed:', tokenRes.status, body);
      return redirectToApp(appOrigin, 'error', {
        message: `Token exchange failed (${tokenRes.status}): ${body.slice(0, 100)}`,
      });
    }
    const tokenData = await tokenRes.json();
    const shortLivedToken = tokenData.access_token;

    // --- Step 2: Exchange for long-lived token ---
    // System-user tokens (from FLfB with system-user access token config) never expire,
    // so this exchange may fail or return the same token. That's fine.
    let longLivedUserToken = shortLivedToken;
    let expiresInSeconds = tokenData.expires_in as number | undefined;

    // If the initial token already has a long/no expiry, skip the exchange
    const isSystemUserToken = !expiresInSeconds || expiresInSeconds === 0;

    if (!isSystemUserToken) {
      console.log('[meta-auth-callback] Exchanging for long-lived token...');
      const longLivedUrl = new URL(`${GRAPH_API}/oauth/access_token`);
      longLivedUrl.searchParams.set('grant_type', 'fb_exchange_token');
      longLivedUrl.searchParams.set('client_id', META_APP_ID);
      longLivedUrl.searchParams.set('client_secret', META_APP_SECRET);
      longLivedUrl.searchParams.set('fb_exchange_token', shortLivedToken);

      const longLivedRes = await fetch(longLivedUrl.toString());
      if (longLivedRes.ok) {
        try {
          const longLivedData = await longLivedRes.json();
          if (longLivedData.access_token) {
            longLivedUserToken = longLivedData.access_token;
            expiresInSeconds = longLivedData.expires_in || expiresInSeconds;
          }
        } catch {
          // not JSON — fall back to short-lived
        }
      }
    } else {
      console.log(
        '[meta-auth-callback] System-user token detected — never expires, skipping exchange',
      );
    }

    // Default: 10 years for non-expiring system-user tokens, 60 days for user tokens
    if (!expiresInSeconds || expiresInSeconds === 0) {
      expiresInSeconds = 10 * 365 * 24 * 3600; // ~10 years
    }

    // --- Step 3: Discover Pages via multiple strategies ---
    // Strategy A: /me/accounts (works for personal Page admins)
    // Strategy B: /me/businesses → /{biz}/owned_pages (works for Business Portfolio Pages)
    // Strategy C: /me/accounts with long-lived token (fallback)
    //
    // Many small businesses manage Pages through Business Portfolios, so
    // /me/accounts alone returns empty. The business_management permission
    // (granted via FLfB config) enables Strategy B.

    let pages: Array<{ id: string; name: string; access_token: string }> = [];

    // Strategy A: standard /me/accounts
    const pagesRes = await fetch(
      `${GRAPH_API}/me/accounts?access_token=${shortLivedToken}&fields=id,name,access_token`,
    );
    if (pagesRes.ok) {
      const pagesDataA = await pagesRes.json();
      if (pagesDataA?.data?.length > 0) {
        pages = pagesDataA.data;
        console.log(`[meta-auth-callback] Found ${pages.length} page(s) via /me/accounts`);
      }
    }

    // Strategy B: Business Portfolios → owned Pages
    if (pages.length === 0) {
      const bizRes = await fetch(
        `${GRAPH_API}/me/businesses?access_token=${shortLivedToken}&fields=id,name`,
      );
      if (bizRes.ok) {
        const bizData = await bizRes.json();
        const businesses = bizData?.data || [];
        console.log(`[meta-auth-callback] Found ${businesses.length} business portfolio(s)`);

        for (const biz of businesses) {
          const bizPagesRes = await fetch(
            `${GRAPH_API}/${biz.id}/owned_pages?access_token=${shortLivedToken}&fields=id,name,access_token`,
          );
          if (bizPagesRes.ok) {
            const bizPagesData = await bizPagesRes.json();
            if (bizPagesData?.data?.length > 0) {
              pages = [...pages, ...bizPagesData.data];
            }
          }
        }
        if (pages.length > 0) {
          console.log(`[meta-auth-callback] Found ${pages.length} page(s) via business portfolios`);
        }
      }
    }

    // Strategy C: long-lived token fallback
    if (pages.length === 0) {
      const pagesResLong = await fetch(
        `${GRAPH_API}/me/accounts?access_token=${longLivedUserToken}&fields=id,name,access_token`,
      );
      if (pagesResLong.ok) {
        const pagesDataC = await pagesResLong.json();
        if (pagesDataC?.data?.length > 0) {
          pages = pagesDataC.data;
        }
      }
    }

    if (pages.length === 0) {
      console.warn('[meta-auth-callback] No Pages found via any strategy');
      return redirectToApp(appOrigin, 'error', {
        message: 'No Facebook Pages found. Make sure you manage at least one Page.',
      });
    }

    const candidatePages = await Promise.all(
      pages.map((page, index) => discoverPageInstagram(page, index)),
    );
    const selectedPageCandidate = [...candidatePages].sort((left, right) => {
      if (right.selectionScore !== left.selectionScore) {
        return right.selectionScore - left.selectionScore;
      }

      return left.discoveryIndex - right.discoveryIndex;
    })[0];

    let selectedInstagramAccountId = selectedPageCandidate.instagramAccountId;
    let selectedInstagramUsername = selectedPageCandidate.instagramUsername;

    if (!selectedInstagramAccountId) {
      const workspaceInstagram = await discoverWorkspaceInstagram(longLivedUserToken);
      if (workspaceInstagram) {
        selectedInstagramAccountId = workspaceInstagram.instagramAccountId;
        selectedInstagramUsername = workspaceInstagram.instagramUsername;
      }
    }

    const pageId = selectedPageCandidate.id;
    const pageName = selectedPageCandidate.name;
    const pageAccessToken = selectedPageCandidate.access_token;

    console.log(
      `[meta-auth-callback] Using Page: ${pageName} (${pageId}) from ${candidatePages.length} candidate page(s)`,
    );

    if (selectedInstagramAccountId) {
      console.log(
        `[meta-auth-callback] Selected Instagram asset: @${selectedInstagramUsername ?? 'unknown'} (${selectedInstagramAccountId})`,
      );
    } else {
      console.log('[meta-auth-callback] No Instagram Business account found via any method');
    }

    const pageCandidatesForConfig = candidatePages.map(
      ({ access_token, ...candidate }) => candidate,
    );
    const selectedSelectionSource =
      selectedPageCandidate.selectionReason === 'Matched via Page query'
        ? 'page_query'
        : selectedPageCandidate.selectionReason === 'Matched via page_backed_instagram_accounts'
          ? 'page_backed_instagram_accounts'
          : selectedInstagramAccountId
            ? 'business_route'
            : 'first_page';

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
          instagram_account_id: selectedInstagramAccountId,
          instagram_username: selectedInstagramUsername,
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
          config: {
            pageId,
            pageName,
            instagramAccountId: selectedInstagramAccountId,
            instagramUsername: selectedInstagramUsername,
            metaSelection: {
              pageCount: candidatePages.length,
              selectedPageId: pageId,
              selectedPageName: pageName,
              selectedSelectionSource,
              candidates: pageCandidatesForConfig,
            },
          },
        },
        { onConflict: 'workspace_id,channel' },
      )
      .then(({ error }) => {
        if (error) console.error('[meta-auth-callback] Facebook channel upsert error:', error);
      });

    // Instagram channel (if linked)
    if (selectedInstagramAccountId) {
      await supabase
        .from('workspace_channels')
        .upsert(
          {
            workspace_id: workspaceId,
            channel: 'instagram',
            enabled: true,
            automation_level: 'draft_only',
            config: {
              instagramAccountId: selectedInstagramAccountId,
              username: selectedInstagramUsername,
              metaSelection: {
                pageId,
                pageName,
                pageCount: candidatePages.length,
                selectedSelectionSource,
              },
            },
          },
          { onConflict: 'workspace_id,channel' },
        )
        .then(({ error }) => {
          if (error) console.error('[meta-auth-callback] Instagram channel upsert error:', error);
        });
    }

    console.log(
      `[meta-auth-callback] Success! Connected Page "${pageName}"${selectedInstagramUsername ? ` + Instagram @${selectedInstagramUsername}` : ''}`,
    );

    // --- Step 8: Redirect back to app ---
    return redirectToApp(appOrigin, 'success', {
      meta_connected: 'true',
      page_name: pageName,
      page_count: String(candidatePages.length),
      meta_selection_source: selectedSelectionSource,
      ...(selectedInstagramUsername ? { instagram: selectedInstagramUsername } : {}),
    });
  } catch (err) {
    console.error('[meta-auth-callback] Unexpected error:', err);
    return redirectToApp(appOrigin, 'error', {
      message: err instanceof Error ? err.message.slice(0, 200) : 'Unexpected error',
    });
  }
});
