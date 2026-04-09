import { validateAuth, AuthError, authErrorResponse } from '../_shared/auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
    const { workspaceId, origin } = await req.json();

    await validateAuth(req, workspaceId).catch((e) => {
      if (e instanceof AuthError) throw e;
      throw new AuthError('Authentication failed', 401);
    });

    console.log('[meta-auth-start] Starting Meta OAuth for workspace:', workspaceId);

    const META_APP_ID = Deno.env.get('META_APP_ID');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');

    if (!META_APP_ID) {
      throw new Error('META_APP_ID not configured');
    }

    const redirectUri = `${SUPABASE_URL}/functions/v1/meta-auth-callback`;

    // Use the actual browser origin for redirects, not the APP_URL env var
    // (which may point to a domain like app.bizzybee.co.uk that doesn't exist yet)
    const appOrigin = origin || Deno.env.get('APP_URL') || 'https://bizzybee-app.pages.dev';
    const statePayload = btoa(
      JSON.stringify({
        workspaceId,
        origin: appOrigin,
      }),
    );
    const state = await signState(statePayload);

    // Facebook Login for Business uses a config_id instead of inline scopes.
    // The configuration (created in Meta App Dashboard → FLfB → Configurations)
    // defines which permissions are requested. Using inline `scope` only grants
    // user-level access; config_id properly grants Page-level access so that
    // /me/accounts returns the user's Pages with access tokens.
    const META_FLFB_CONFIG_ID = Deno.env.get('META_FLFB_CONFIG_ID') || '2081766425888659';

    const authUrl = new URL('https://www.facebook.com/v19.0/dialog/oauth');
    authUrl.searchParams.set('client_id', META_APP_ID);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('config_id', META_FLFB_CONFIG_ID);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('state', state);

    console.log('[meta-auth-start] Generated Facebook OAuth URL');

    return new Response(JSON.stringify({ authUrl: authUrl.toString() }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return authErrorResponse(error);
    }
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[meta-auth-start] Error:', error);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
