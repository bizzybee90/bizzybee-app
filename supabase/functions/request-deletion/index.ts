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
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // =============================================
    // SECURITY: Validate JWT authentication
    // =============================================
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized - missing token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Create client with user's auth to verify JWT
    const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: authError,
    } = await userSupabase.auth.getUser();

    if (authError || !user) {
      console.error('[request-deletion] JWT validation failed:', authError);
      return new Response(JSON.stringify({ error: 'Unauthorized - invalid token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userId = user.id;
    console.log(`[request-deletion] Authenticated user: ${userId}`);

    // Get user's workspace
    const { data: userData, error: userError } = await userSupabase
      .from('users')
      .select('workspace_id')
      .eq('id', userId)
      .single();

    if (userError || !userData?.workspace_id) {
      return new Response(JSON.stringify({ error: 'User not associated with a workspace' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const workspaceId = userData.workspace_id;

    // Use service role for data operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { customer_identifier, reason, deletion_type } = await req.json();

    if (!customer_identifier) {
      return new Response(JSON.stringify({ error: 'customer_identifier is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Creating deletion request for:', customer_identifier);

    // =============================================
    // SECURITY: Only find customers in user's workspace
    // =============================================
    let { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('id, name, email')
      .eq('workspace_id', workspaceId)
      .eq('email', customer_identifier)
      .maybeSingle();

    if (!customer) {
      const result = await supabase
        .from('customers')
        .select('id, name, email')
        .eq('workspace_id', workspaceId)
        .eq('phone', customer_identifier)
        .maybeSingle();
      customer = result.data;
      customerError = result.error;
    }

    if (customerError || !customer) {
      return new Response(JSON.stringify({ error: 'Customer not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Create deletion request
    const { data: deletionRequest, error: requestError } = await supabase
      .from('data_deletion_requests')
      .insert({
        customer_id: customer.id,
        status: 'pending',
        reason: reason || 'Customer requested data deletion',
        deletion_type: deletion_type || 'full',
        notes: 'Request created via API',
        requested_by: userId,
      })
      .select('id')
      .single();

    if (requestError) {
      console.error('Error creating deletion request:', requestError);
      throw requestError;
    }

    // Calculate estimated completion (30 days from now)
    const estimatedCompletion = new Date();
    estimatedCompletion.setDate(estimatedCompletion.getDate() + 30);

    console.log('Deletion request created:', deletionRequest.id);

    return new Response(
      JSON.stringify({
        request_id: deletionRequest.id,
        status: 'pending',
        estimated_completion: estimatedCompletion.toISOString(),
        message:
          'Your deletion request has been received and will be processed within 30 days. An administrator will review your request.',
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error: any) {
    console.error('Error creating deletion request:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
