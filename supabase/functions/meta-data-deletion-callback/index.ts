import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Meta Data Deletion Callback
 *
 * Required for Meta App Review. When a user removes BizzyBee from their
 * Facebook settings or requests data deletion, Meta sends a signed POST
 * with the user's ID. We mark their meta_provider_configs as deleted and
 * return a confirmation URL.
 *
 * See: https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback/
 */

async function verifySignedRequest(
  signedRequest: string,
  appSecret: string,
): Promise<Record<string, unknown>> {
  const [encodedSig, payload] = signedRequest.split('.', 2);
  if (!encodedSig || !payload) {
    throw new Error('Invalid signed_request format');
  }

  // Base64url decode
  const base64UrlToBase64 = (str: string) =>
    str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (str.length % 4)) % 4);

  const sigBytes = Uint8Array.from(atob(base64UrlToBase64(encodedSig)), (c) => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const expectedSig = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)),
  );

  // Constant-time comparison
  if (sigBytes.length !== expectedSig.length) {
    throw new Error('Signature length mismatch');
  }
  let diff = 0;
  for (let i = 0; i < sigBytes.length; i++) {
    diff |= sigBytes[i] ^ expectedSig[i];
  }
  if (diff !== 0) {
    throw new Error('Invalid signature');
  }

  const decoded = JSON.parse(atob(base64UrlToBase64(payload)));
  return decoded;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const META_APP_SECRET = Deno.env.get('META_APP_SECRET');
    if (!META_APP_SECRET) {
      throw new Error('META_APP_SECRET not configured');
    }

    // Meta sends form-urlencoded with a signed_request field
    const formData = await req.formData();
    const signedRequest = formData.get('signed_request') as string;
    if (!signedRequest) {
      return new Response(JSON.stringify({ error: 'Missing signed_request' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await verifySignedRequest(signedRequest, META_APP_SECRET);
    const metaUserId = String(data.user_id || '');

    if (!metaUserId) {
      return new Response(JSON.stringify({ error: 'No user_id in request' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('[meta-data-deletion] Received deletion request for Meta user:', metaUserId);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Mark all meta_provider_configs for this user as deleted
    const { data: updated, error } = await supabase
      .from('meta_provider_configs')
      .update({ status: 'deleted' })
      .eq('meta_user_id', metaUserId)
      .select('id');

    if (error) {
      console.error('[meta-data-deletion] Update failed:', error);
    } else {
      console.log(`[meta-data-deletion] Marked ${updated?.length ?? 0} configs as deleted`);
    }

    // Generate a confirmation code Meta can track
    const confirmationCode = crypto.randomUUID();
    const APP_URL = Deno.env.get('APP_URL') || 'https://bizzybee-app.pages.dev';

    // Meta expects this exact response shape
    return new Response(
      JSON.stringify({
        url: `${APP_URL}/data-deletion-status?id=${confirmationCode}`,
        confirmation_code: confirmationCode,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  } catch (err) {
    console.error('[meta-data-deletion] Error:', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Internal error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  }
});
