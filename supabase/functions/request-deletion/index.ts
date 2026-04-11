import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { AuthError, authErrorResponse, validateAuth } from '../_shared/auth.ts';

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
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const auth = await validateAuth(req);
    const userId = auth.userId;
    const workspaceId = auth.workspaceId;
    console.log(`[request-deletion] Authenticated user: ${userId}`);

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
    if (error instanceof AuthError) {
      return authErrorResponse(error);
    }
    console.error('Error creating deletion request:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
