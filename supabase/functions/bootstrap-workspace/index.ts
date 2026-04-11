import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type RequestBody = {
  force_reset?: boolean;
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const getBearerToken = (req: Request) => {
  const authHeader = req.headers.get('Authorization') ?? '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
};

const buildWorkspaceName = (email?: string | null) => {
  if (!email) return 'My Workspace';
  const localPart = email.split('@')[0]?.trim();
  if (!localPart) return 'My Workspace';
  return `${localPart.charAt(0).toUpperCase()}${localPart.slice(1)} workspace`;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const token = getBearerToken(req);
    if (!token) {
      return json(401, { error: 'Missing authorization token' });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
      return json(500, { error: 'Missing Supabase environment variables' });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return json(401, { error: 'Invalid or expired session' });
    }

    const body = req.method === 'POST' ? ((await req.json().catch(() => ({}))) as RequestBody) : {};
    const forceReset = Boolean(body.force_reset);

    const { data: userRow, error: userRowError } = await supabase
      .from('users')
      .select('workspace_id')
      .eq('id', user.id)
      .maybeSingle();

    if (userRowError) {
      throw userRowError;
    }

    if (userRow?.workspace_id && !forceReset) {
      return json(200, { workspace_id: userRow.workspace_id, reused: true });
    }

    const slug = `workspace-${user.id.slice(0, 8)}-${Date.now().toString(36)}`;
    const workspaceName = buildWorkspaceName(user.email);

    const { data: workspace, error: workspaceError } = await supabase
      .from('workspaces')
      .insert({
        name: workspaceName,
        slug,
      })
      .select('id')
      .single();

    if (workspaceError || !workspace) {
      throw workspaceError ?? new Error('Failed to create workspace');
    }

    const upsertPayload = {
      id: user.id,
      email: user.email ?? '',
      workspace_id: workspace.id,
      onboarding_completed: false,
      onboarding_step: 'welcome',
      updated_at: new Date().toISOString(),
    };

    const { error: upsertError } = await supabase.from('users').upsert(upsertPayload, {
      onConflict: 'id',
    });

    if (upsertError) {
      throw upsertError;
    }

    const { error: deleteWorkspaceMembershipsError } = await supabase
      .from('workspace_members')
      .delete()
      .eq('user_id', user.id);

    if (deleteWorkspaceMembershipsError) {
      throw deleteWorkspaceMembershipsError;
    }

    const { error: insertWorkspaceMembershipError } = await supabase
      .from('workspace_members')
      .insert({
        workspace_id: workspace.id,
        user_id: user.id,
        role: 'admin',
        joined_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

    if (insertWorkspaceMembershipError) {
      throw insertWorkspaceMembershipError;
    }

    return json(200, {
      workspace_id: workspace.id,
      reused: false,
    });
  } catch (error) {
    console.error('[bootstrap-workspace] Failed to bootstrap workspace:', error);
    return json(500, {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});
