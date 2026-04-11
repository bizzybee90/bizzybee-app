import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Meta Token Refresh
 *
 * Long-lived Page Access Tokens expire after ~60 days. This function
 * queries meta_provider_configs for tokens expiring within 7 days and
 * refreshes them via the fb_exchange_token grant. Run daily via cron.
 */

const GRAPH_API = 'https://graph.facebook.com/v19.0';

Deno.serve(async (req) => {
  // Only allow POST (from cron/scheduler) or service-role calls
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  try {
    const META_APP_ID = Deno.env.get('META_APP_ID')!;
    const META_APP_SECRET = Deno.env.get('META_APP_SECRET')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const serviceBearer = `Bearer ${serviceRoleKey}`;
    const workerToken = Deno.env.get('BB_WORKER_TOKEN')?.trim();
    const authHeader = req.headers.get('Authorization');
    const providedWorkerToken = req.headers.get('x-bb-worker-token')?.trim();

    if (authHeader !== serviceBearer && (!workerToken || providedWorkerToken !== workerToken)) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, serviceRoleKey);

    // Find tokens expiring within 7 days
    const { data: expiring, error: queryError } = await supabase
      .from('meta_provider_configs')
      .select('id, page_id, page_name, token_expires_at')
      .eq('status', 'active')
      .lt('token_expires_at', new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString())
      .gt('token_expires_at', new Date().toISOString());

    if (queryError) {
      console.error('[meta-refresh-tokens] Query error:', queryError);
      return new Response(JSON.stringify({ error: queryError.message }), { status: 500 });
    }

    if (!expiring || expiring.length === 0) {
      console.log('[meta-refresh-tokens] No tokens need refreshing');
      return new Response(JSON.stringify({ refreshed: 0 }), { status: 200 });
    }

    console.log(`[meta-refresh-tokens] Found ${expiring.length} tokens to refresh`);

    let refreshed = 0;
    let failed = 0;

    for (const config of expiring) {
      try {
        // Decrypt the current token
        const { data: currentToken } = await supabase.rpc('get_meta_decrypted_token', {
          p_config_id: config.id,
        });

        if (!currentToken) {
          console.warn(`[meta-refresh-tokens] No token for config ${config.id}, skipping`);
          continue;
        }

        // Exchange for a new long-lived token
        const refreshUrl = new URL(`${GRAPH_API}/oauth/access_token`);
        refreshUrl.searchParams.set('grant_type', 'fb_exchange_token');
        refreshUrl.searchParams.set('client_id', META_APP_ID);
        refreshUrl.searchParams.set('client_secret', META_APP_SECRET);
        refreshUrl.searchParams.set('fb_exchange_token', currentToken);

        const res = await fetch(refreshUrl.toString());
        if (!res.ok) {
          const body = await res.text();
          console.error(
            `[meta-refresh-tokens] Refresh failed for Page "${config.page_name}" (${config.page_id}):`,
            body,
          );

          // Mark as expired so the user sees a warning
          await supabase
            .from('meta_provider_configs')
            .update({ status: 'token_expired' })
            .eq('id', config.id);

          failed++;
          continue;
        }

        const data = await res.json();
        const newExpiresAt = new Date(
          Date.now() + (data.expires_in || 5184000) * 1000,
        ).toISOString();

        // Store the new encrypted token
        const { error: encryptError } = await supabase.rpc('store_meta_encrypted_token', {
          p_config_id: config.id,
          p_page_access_token: data.access_token,
        });

        if (encryptError) {
          console.error(`[meta-refresh-tokens] Encrypt error for ${config.id}:`, encryptError);
          failed++;
          continue;
        }

        // Update expiry
        await supabase
          .from('meta_provider_configs')
          .update({ token_expires_at: newExpiresAt })
          .eq('id', config.id);

        console.log(
          `[meta-refresh-tokens] Refreshed token for Page "${config.page_name}", expires ${newExpiresAt}`,
        );
        refreshed++;
      } catch (err) {
        console.error(`[meta-refresh-tokens] Error refreshing config ${config.id}:`, err);
        failed++;
      }
    }

    console.log(`[meta-refresh-tokens] Done: ${refreshed} refreshed, ${failed} failed`);

    return new Response(JSON.stringify({ refreshed, failed, total: expiring.length }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[meta-refresh-tokens] Fatal error:', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }),
      { status: 500 },
    );
  }
});
