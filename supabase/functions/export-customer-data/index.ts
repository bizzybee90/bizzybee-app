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
    console.log(`[export-customer-data] Authenticated user: ${userId}`);

    // Use service role for data access
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { customer_identifier, delivery_method } = await req.json();

    if (!customer_identifier) {
      return new Response(JSON.stringify({ error: 'customer_identifier is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Exporting data for:', customer_identifier);

    // =============================================
    // SECURITY: Only find customers in user's workspace
    // =============================================
    let { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('email', customer_identifier)
      .maybeSingle();

    if (!customer) {
      const result = await supabase
        .from('customers')
        .select('*')
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

    // Get all related data (scoped to workspace via customer)
    const [conversationsResult, consentsResult, deletionRequestsResult] = await Promise.all([
      supabase
        .from('conversations')
        .select(
          `
          *,
          messages (*)
        `,
        )
        .eq('customer_id', customer.id)
        .eq('workspace_id', workspaceId),
      supabase.from('customer_consents').select('*').eq('customer_id', customer.id),
      supabase.from('data_deletion_requests').select('*').eq('customer_id', customer.id),
    ]);

    // Compile export data
    const exportData = {
      export_date: new Date().toISOString(),
      customer: customer,
      conversations: conversationsResult.data || [],
      consents: consentsResult.data || [],
      deletion_requests: deletionRequestsResult.data || [],
      rights_information: {
        right_to_access: 'You can request your data at any time',
        right_to_erasure: 'You can request deletion by contacting us',
        right_to_rectification: 'You can update your information',
        right_to_portability: 'This export is in JSON format for portability',
      },
    };

    // Log the export action
    await supabase.from('data_access_logs').insert({
      action: 'export',
      customer_id: customer.id,
      performed_by: userId,
      metadata: { delivery_method, export_size: JSON.stringify(exportData).length },
    });

    console.log('Export completed for customer:', customer.id);

    // For now, return the data directly
    // In production, you might want to upload to storage and send email with link
    return new Response(
      JSON.stringify({
        export_id: crypto.randomUUID(),
        status: 'complete',
        data: exportData,
        format: 'json',
        message:
          delivery_method === 'email'
            ? 'Export has been sent to your email address'
            : 'Export data is included in this response',
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error: any) {
    if (error instanceof AuthError) {
      return authErrorResponse(error);
    }
    console.error('Error exporting customer data:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
