import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ALLOWED_ORIGINS = [
  'https://bizzybee.app',
  'https://app.bizzybee.co.uk',
  'http://localhost:5173',
  'http://localhost:8080',
];

async function verifyStateSignature(signedState: string): Promise<string> {
  const dotIndex = signedState.lastIndexOf('.');
  if (dotIndex === -1) {
    throw new Error('State parameter missing signature');
  }
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
  const expectedHmac = [...new Uint8Array(signature)].map(b => b.toString(16).padStart(2, '0')).join('');

  if (receivedHmac !== expectedHmac) {
    throw new Error('Invalid state signature');
  }
  return payload;
}

// Redirect helper that uses origin from state

const redirectTo = (baseUrl: string, path: string, params?: Record<string, string>) => {
  const url = new URL(path, baseUrl);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  return new Response(null, {
    status: 302,
    headers: { 'Location': url.toString() },
  });
};

const buildRedirectUrl = (
  origin: string,
  type: 'cancelled' | 'error' | 'success',
  message?: string
) => {
  // Always return to onboarding so the app can immediately refresh connection state.
  const url = new URL('/onboarding', origin);
  url.searchParams.set('step', 'email');
  url.searchParams.set('aurinko', type);
  if (message) url.searchParams.set('message', message.slice(0, 200));
  return url.toString();
};

const redirectToApp = (
  origin: string,
  type: 'cancelled' | 'error' | 'success',
  message?: string
) => {
  return new Response(null, {
    status: 302,
    headers: {
      Location: buildRedirectUrl(origin, type, message),
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  });
};

function safeMessage(text: string): string {
  // keep URL safe and short
  return text.replace(/\s+/g, ' ').trim().slice(0, 200);
}

// Default app origin for redirects — reads from APP_URL env var
const defaultOrigin = Deno.env.get('APP_URL') || 'https://bizzybee.app';

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    console.log('Aurinko callback received:', { code: !!code, state: !!state, error });

    // Handle cancellation scenarios
    if (error === 'access_denied' || error === 'user_cancelled' || error === 'consent_required') {
      console.log('User cancelled OAuth flow:', error);
      let cancelOrigin = defaultOrigin;
      try {
        if (state) {
          const payload = await verifyStateSignature(state);
          const stateData = JSON.parse(atob(payload));
          const candidateOrigin = stateData.origin || defaultOrigin;
          cancelOrigin = ALLOWED_ORIGINS.includes(candidateOrigin) ? candidateOrigin : defaultOrigin;
        }
      } catch (e) {
        // ignore – use default origin
      }
      return redirectToApp(cancelOrigin, 'cancelled');
    }

    // If no code and no explicit error, treat as cancellation
    if (!code) {
      console.log('No code provided, treating as cancellation');
      return redirectToApp(defaultOrigin, 'cancelled');
    }

    if (error) {
      console.error('Aurinko auth error:', error);
      return redirectToApp(defaultOrigin, 'error', safeMessage(error));
    }

    if (!state) {
      return redirectToApp(defaultOrigin, 'error', 'Missing state');
    }

    // Decode and verify state signature
    let stateData;
    try {
      const payload = await verifyStateSignature(state);
      stateData = JSON.parse(atob(payload));
    } catch (e) {
      console.error('State verification failed:', e);
      return new Response(JSON.stringify({ error: 'Invalid state parameter' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { workspaceId, importMode, provider, origin } = stateData;
    // Validate origin against allowlist, fall back to default if not allowed
    const appOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : defaultOrigin;
    console.log('Decoded state:', { workspaceId, importMode, provider, origin: appOrigin });

    const AURINKO_CLIENT_ID = Deno.env.get('AURINKO_CLIENT_ID');
    const AURINKO_CLIENT_SECRET = Deno.env.get('AURINKO_CLIENT_SECRET');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!AURINKO_CLIENT_ID || !AURINKO_CLIENT_SECRET) {
      return redirectToApp(appOrigin, 'error', 'Aurinko credentials not configured');
    }

    // Exchange code for access token
    const tokenResponse = await fetch('https://api.aurinko.io/v1/auth/token/' + code, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(`${AURINKO_CLIENT_ID}:${AURINKO_CLIENT_SECRET}`),
        'Content-Type': 'application/json',
      },
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('Token exchange failed:', errorText);
      return redirectToApp(appOrigin, 'error', 'Failed to exchange authorization code. Please try again.');
    }

    const tokenData = await tokenResponse.json();
    console.log('Token exchange successful for account:', tokenData.accountId || 'unknown');

    // Extract email from token response
    let emailAddress = tokenData.email || tokenData.userEmail || 'unknown@email.com';

    // If not in token response, get from /v1/account endpoint using Bearer token
    if (emailAddress === 'unknown@email.com') {
      try {
        const accountResponse = await fetch('https://api.aurinko.io/v1/account', {
          headers: {
            'Authorization': `Bearer ${tokenData.accessToken}`,
          },
        });

        if (accountResponse.ok) {
          const accountData = await accountResponse.json();
          console.log('Account data:', JSON.stringify(accountData));
          emailAddress = accountData.email || accountData.email2 || accountData.mailboxAddress || accountData.loginString || emailAddress;
        } else {
          console.log('Account fetch failed:', accountResponse.status, await accountResponse.text());
        }
      } catch (e) {
        console.log('Failed to fetch account info:', e);
      }
    }
    
    console.log('Final email address:', emailAddress);

    // Auto-detect aliases
    let aliases: string[] = [];
    console.log('Provider type:', provider, '- detecting aliases for:', emailAddress);
    
    // For maccleaning.uk domain, we know the aliases
    const emailDomain = emailAddress.split('@')[1]?.toLowerCase();
    if (emailDomain === 'maccleaning.uk') {
      const knownAliases = ['info@maccleaning.uk', 'hello@maccleaning.uk', 'michael@maccleaning.uk'];
      aliases = knownAliases.filter(a => a.toLowerCase() !== emailAddress.toLowerCase());
      console.log('Using known maccleaning.uk aliases:', aliases);
    }

    // Create webhook subscription for email notifications
    const webhookUrl = `${SUPABASE_URL}/functions/v1/aurinko-webhook`;
    console.log('Creating email subscription with webhook URL:', webhookUrl);
    
    let subscriptionId: string | null = null;
    try {
      const subscriptionResponse = await fetch('https://api.aurinko.io/v1/subscriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokenData.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          resource: '/email/messages',
          notificationUrl: webhookUrl,
        }),
      });

      if (subscriptionResponse.ok) {
        const subscriptionData = await subscriptionResponse.json();
        subscriptionId = subscriptionData.id?.toString() || null;
        console.log('Email subscription created successfully:', JSON.stringify(subscriptionData));
      } else {
        const subscriptionError = await subscriptionResponse.text();
        console.error('Failed to create email subscription:', subscriptionResponse.status, subscriptionError);
        // Continue anyway - we can still store the config
      }
    } catch (subError) {
      console.error('Error creating subscription:', subError);
      // Continue anyway
    }

    // Store in database
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // =============================================
    // IDEMPOTENCY CHECK: Prevent double-triggering
    // =============================================
    const { data: existingProgress } = await supabase
      .from('email_import_progress')
      .select('current_phase, updated_at')
      .eq('workspace_id', workspaceId)
      .single();

    const isAlreadyRunning = existingProgress && 
      ['importing', 'classifying', 'learning'].includes(existingProgress.current_phase) &&
      new Date(existingProgress.updated_at).getTime() > Date.now() - 2 * 60 * 1000; // Updated within 2 min

    if (isAlreadyRunning) {
      console.log('[aurinko-auth-callback] Import already running, skipping trigger');
      return redirectToApp(appOrigin, 'success');
    }

    // =============================================
    // SECURITY: First insert record WITHOUT plaintext tokens
    // =============================================
    const { data: configData, error: dbError } = await supabase
      .from('email_provider_configs')
      .upsert({
        workspace_id: workspaceId,
        provider: provider,
        account_id: tokenData.accountId.toString(),
        // SECURITY: Don't store plaintext - will encrypt via RPC
        access_token: null,
        refresh_token: null,
        email_address: emailAddress,
        import_mode: importMode,
        connected_at: new Date().toISOString(),
        aliases: aliases,
        subscription_id: subscriptionId,
        sync_status: 'pending',
        sync_stage: 'queued',
      }, {
        onConflict: 'workspace_id,email_address'
      })
      .select()
      .single();

    if (dbError) {
      console.error('Database error:', dbError);
      return redirectToApp(appOrigin, 'error', 'Failed to save email configuration');
    }

    // =============================================
    // SECURITY: Store tokens encrypted via secure RPC
    // =============================================
    const { error: encryptError } = await supabase.rpc('store_encrypted_token', {
      p_config_id: configData.id,
      p_access_token: tokenData.accessToken,
      p_refresh_token: tokenData.refreshToken || null
    });

    if (encryptError) {
      console.error('Failed to encrypt token:', encryptError);
      // Don't fail the flow, but log it - the token is not stored which is safe
      // The user will need to reconnect if decryption fails later
    }

    console.log('Email provider config saved successfully with', aliases.length, 'aliases, configId:', configData?.id, '(tokens encrypted)');

    // =============================================
    // INITIALIZE PROGRESS TRACKING
    // =============================================
    await supabase
      .from('email_import_progress')
      .upsert({
        workspace_id: workspaceId,
        current_phase: 'importing',
        emails_received: 0,
        emails_classified: 0,
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'workspace_id' });

    // Redirect back into the app instead of showing an inline HTML page.
    // This avoids browsers showing raw HTML (text/plain) and keeps the UX consistent.
    return redirectToApp(appOrigin, 'success');
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error in aurinko-auth-callback:', error);
    return redirectToApp(defaultOrigin, 'error', safeMessage(errorMessage));
  }
});
