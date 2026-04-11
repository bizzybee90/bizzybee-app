import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { validateAuth, AuthError, authErrorResponse } from '../_shared/auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GRAPH_API = 'https://graph.facebook.com/v19.0';

/**
 * Re-syncs Instagram (and future channel) info for a workspace's Meta connection.
 * Uses the stored Page Access Token to re-query the Graph API.
 * POST { workspace_id }
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { workspace_id } = await req.json();
    if (!workspace_id) {
      return new Response(JSON.stringify({ error: 'workspace_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let workspaceId = workspace_id;
    try {
      const auth = await validateAuth(req, workspace_id);
      workspaceId = auth.workspaceId;
    } catch (error) {
      if (error instanceof AuthError) {
        return authErrorResponse(error);
      }
      throw error;
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Get the active meta config for this workspace
    const { data: config, error: configError } = await supabase
      .from('meta_provider_configs')
      .select('id, page_id, page_name, instagram_account_id, instagram_username')
      .eq('workspace_id', workspaceId)
      .eq('status', 'active')
      .maybeSingle();

    if (configError || !config) {
      return new Response(
        JSON.stringify({ error: 'No active Meta connection found', detail: configError }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Decrypt the Page Access Token
    const { data: pageAccessToken, error: tokenError } = await supabase.rpc(
      'get_meta_decrypted_token',
      { p_config_id: config.id },
    );

    if (tokenError || !pageAccessToken) {
      return new Response(
        JSON.stringify({ error: 'Failed to decrypt token', detail: tokenError }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const results: Record<string, unknown> = {
      page_id: config.page_id,
      page_name: config.page_name,
      previous_instagram_id: config.instagram_account_id,
    };

    // Try multiple methods to discover Instagram Business account
    let instagramAccountId: string | null = null;
    let instagramUsername: string | null = null;

    // Method A: Page query (needs pages_read_engagement)
    const igRes = await fetch(
      `${GRAPH_API}/${config.page_id}?fields=instagram_business_account{id,username}&access_token=${pageAccessToken}`,
    );
    const igData = await igRes.json();
    results.method_a = igRes.ok
      ? { instagram_business_account: igData.instagram_business_account || null }
      : { error: igData.error };

    if (igRes.ok && igData.instagram_business_account) {
      instagramAccountId = igData.instagram_business_account.id;
      instagramUsername = igData.instagram_business_account.username || null;
      results.discovered_via = 'page_query';
    }

    // Method B: Business route (needs business_management)
    if (!instagramAccountId) {
      // We need a user token for /me/businesses — the page token won't work.
      // Try page_backed_instagram_accounts on the Page instead.
      const pbiRes = await fetch(
        `${GRAPH_API}/${config.page_id}/page_backed_instagram_accounts?access_token=${pageAccessToken}&fields=id,username`,
      );
      if (pbiRes.ok) {
        const pbiData = await pbiRes.json();
        results.method_b = { page_backed: pbiData?.data || [] };
        if (pbiData?.data?.length > 0) {
          instagramAccountId = pbiData.data[0].id;
          instagramUsername = pbiData.data[0].username || null;
          results.discovered_via = 'page_backed_instagram_accounts';
        }
      } else {
        const pbiErr = await pbiRes.json().catch(() => ({}));
        results.method_b = { error: pbiErr };
      }
    }

    if (instagramAccountId) {
      results.instagram_account_id = instagramAccountId!;
      results.instagram_username = instagramUsername;

      // Update meta_provider_configs
      const { error: updateError } = await supabase
        .from('meta_provider_configs')
        .update({
          instagram_account_id: instagramAccountId,
          instagram_username: instagramUsername,
        })
        .eq('id', config.id);

      if (updateError) {
        results.config_update = { error: updateError };
      } else {
        results.config_update = 'success';
      }

      // Upsert workspace_channels for Instagram
      const { error: channelError } = await supabase.from('workspace_channels').upsert(
        {
          workspace_id: workspaceId,
          channel: 'instagram',
          enabled: true,
          automation_level: 'draft_only',
          config: { instagramAccountId, username: instagramUsername },
        },
        { onConflict: 'workspace_id,channel' },
      );

      if (channelError) {
        results.channel_upsert = { error: channelError };
      } else {
        results.channel_upsert = 'success';
      }

      results.synced = true;
    } else {
      results.synced = false;
      results.reason = igRes.ok
        ? 'No Instagram Business account linked to this Page'
        : 'Graph API error';
    }

    return new Response(JSON.stringify(results, null, 2), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
