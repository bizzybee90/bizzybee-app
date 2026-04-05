import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { validateAuth, AuthError, authErrorResponse } = await import('../_shared/auth.ts');

    let auth;
    try {
      auth = await validateAuth(req);
    } catch (authErr: unknown) {
      if (authErr instanceof AuthError) {
        return authErrorResponse(authErr);
      }
      throw authErr;
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: workspaceMembers, error: membersError } = await supabase
      .from('users')
      .select('id')
      .eq('workspace_id', auth.workspaceId);

    if (membersError) {
      throw membersError;
    }

    const memberIds = workspaceMembers?.map((member) => member.id) ?? [];

    if (memberIds.length === 0) {
      throw new Error('No workspace members found');
    }

    const { count: adminCount, error: adminCountError } = await supabase
      .from('user_roles')
      .select('id', { count: 'exact', head: true })
      .in('user_id', memberIds)
      .eq('role', 'admin');

    if (adminCountError) {
      throw adminCountError;
    }

    if ((adminCount ?? 0) > 0) {
      return new Response(
        JSON.stringify({
          error:
            'This workspace already has an admin. Ask them to change permissions from Workspace & Access.',
        }),
        {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    const { error: deleteError } = await supabase
      .from('user_roles')
      .delete()
      .eq('user_id', auth.userId);

    if (deleteError) {
      throw deleteError;
    }

    const { error: insertError } = await supabase.from('user_roles').insert({
      user_id: auth.userId,
      role: 'admin',
    });

    if (insertError) {
      throw insertError;
    }

    return new Response(
      JSON.stringify({
        success: true,
        role: 'admin',
        workspace_id: auth.workspaceId,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  } catch (error) {
    console.error('[claim-workspace-admin] Failed to claim admin access:', error);

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  }
});
