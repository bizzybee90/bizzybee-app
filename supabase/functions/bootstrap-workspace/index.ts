import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'bizzybee-workspace';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid or expired session' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: existingUser, error: existingUserError } = await adminClient
      .from('users')
      .select('id, email, name, workspace_id, onboarding_step')
      .eq('id', user.id)
      .maybeSingle();

    if (existingUserError) {
      throw existingUserError;
    }

    if (!existingUser) {
      const { error: insertUserError } = await adminClient.from('users').insert({
        id: user.id,
        email: user.email ?? '',
        name:
          (typeof user.user_metadata?.name === 'string' && user.user_metadata.name.trim()) ||
          user.email ||
          'BizzyBee User',
        onboarding_completed: false,
        onboarding_step: 'welcome',
      });

      if (insertUserError) {
        throw insertUserError;
      }
    }

    const currentWorkspaceId = existingUser?.workspace_id ?? null;
    if (currentWorkspaceId) {
      const { data: currentWorkspace, error: currentWorkspaceError } = await adminClient
        .from('workspaces')
        .select('*')
        .eq('id', currentWorkspaceId)
        .maybeSingle();

      if (currentWorkspaceError) {
        throw currentWorkspaceError;
      }

      if (currentWorkspace) {
        return new Response(
          JSON.stringify({
            success: true,
            workspace_id: currentWorkspace.id,
            workspace: currentWorkspace,
            created: false,
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        );
      }
    }

    const displayName =
      (typeof user.user_metadata?.name === 'string' && user.user_metadata.name.trim()) ||
      existingUser?.name ||
      user.email?.split('@')[0] ||
      'BizzyBee Workspace';

    const slug = `${slugify(displayName)}-${crypto.randomUUID().slice(0, 8)}`;

    const { data: newWorkspace, error: newWorkspaceError } = await adminClient
      .from('workspaces')
      .insert({
        name: displayName,
        slug,
        timezone: 'Europe/London',
      })
      .select('*')
      .single();

    if (newWorkspaceError || !newWorkspace) {
      throw newWorkspaceError ?? new Error('Failed to create workspace');
    }

    const { error: updateUserError } = await adminClient
      .from('users')
      .update({
        workspace_id: newWorkspace.id,
        onboarding_completed: false,
        onboarding_step: existingUser?.onboarding_step ?? 'welcome',
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id);

    if (updateUserError) {
      throw updateUserError;
    }

    const { error: roleError } = await adminClient.from('user_roles').insert({
      user_id: user.id,
      role: 'admin',
    });

    if (roleError && !roleError.message.includes('duplicate key')) {
      throw roleError;
    }

    return new Response(
      JSON.stringify({
        success: true,
        workspace_id: newWorkspace.id,
        workspace: newWorkspace,
        created: true,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  } catch (error) {
    console.error('[bootstrap-workspace] Failed to prepare workspace:', error);

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
