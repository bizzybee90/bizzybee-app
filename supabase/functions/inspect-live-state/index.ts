import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { validateAuth, AuthError, authErrorResponse } from '../_shared/auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function isInspectLiveStateEnabled(): boolean {
  return Deno.env.get('ENABLE_INSPECT_LIVE_STATE') === 'true';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (!isInspectLiveStateEnabled()) {
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const url = new URL(req.url);
    let requestedWorkspaceId = url.searchParams.get('workspace_id');

    if (!requestedWorkspaceId) {
      try {
        const body = await req.clone().json();
        if (body && typeof body.workspace_id === 'string') {
          requestedWorkspaceId = body.workspace_id;
        }
      } catch {
        // Ignore non-JSON body for GET requests.
      }
    }

    if (!requestedWorkspaceId) {
      return new Response(JSON.stringify({ error: 'workspace_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let auth;
    try {
      auth = await validateAuth(req, requestedWorkspaceId);
    } catch (error) {
      if (error instanceof AuthError) {
        return authErrorResponse(error);
      }
      throw error;
    }

    // Require user JWT context for this debug endpoint; disallow raw service-role bearer calls.
    if (auth.userId === 'service_role') {
      return new Response(JSON.stringify({ error: 'Service role access is not allowed' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(JSON.stringify({ error: 'Missing Supabase configuration' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const workspaceId = auth.workspaceId;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('id, email, workspace_id, onboarding_completed, onboarding_step, updated_at')
      .eq('workspace_id', workspaceId)
      .order('updated_at', { ascending: false })
      .limit(20);

    const { data: workspace, error: workspaceError } = await supabase
      .from('workspaces')
      .select('id, name, slug, created_at')
      .eq('id', workspaceId)
      .maybeSingle();

    const { data: businessContext, error: businessContextError } = await supabase
      .from('business_context')
      .select('workspace_id, company_name, website_url, service_area')
      .eq('workspace_id', workspaceId)
      .limit(20);

    return new Response(
      JSON.stringify({
        workspace_id: workspaceId,
        usersError,
        workspaceError,
        businessContextError,
        users,
        workspace,
        businessContext,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  }
});
