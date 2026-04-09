import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-debug-token',
};

const DEBUG_TOKEN = 'bizzybee-debug-2026-04-06';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.headers.get('x-debug-token') !== DEBUG_TOKEN) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
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

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: users, error: usersError } = await supabase
    .from('users')
    .select('id, email, workspace_id, onboarding_completed, onboarding_step, updated_at')
    .order('updated_at', { ascending: false })
    .limit(20);

  const { data: workspaces, error: workspacesError } = await supabase
    .from('workspaces')
    .select('id, name, slug, created_at')
    .order('created_at', { ascending: false })
    .limit(20);

  const { data: businessContext, error: businessContextError } = await supabase
    .from('business_context')
    .select('workspace_id, company_name, website_url, service_area')
    .limit(20);

  return new Response(
    JSON.stringify({
      usersError,
      workspacesError,
      businessContextError,
      users,
      workspaces,
      businessContext,
    }),
    {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    },
  );
});
