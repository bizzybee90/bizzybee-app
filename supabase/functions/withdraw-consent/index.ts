import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { validateAuth, AuthError, authErrorResponse } from '../_shared/auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface WithdrawConsentRequest {
  customer_id?: string;
  customer_email?: string;
  customer_phone?: string;
  channel: string;
  reason?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Validate authentication
    const { workspaceId } = await validateAuth(req);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body: WithdrawConsentRequest = await req.json();
    console.log('📤 [withdraw-consent] Processing request:', JSON.stringify(body, null, 2));

    // Find customer by ID, email, or phone - scoped to workspace
    let customerId = body.customer_id;

    if (!customerId && (body.customer_email || body.customer_phone)) {
      const query = supabase.from('customers').select('id').eq('workspace_id', workspaceId);

      if (body.customer_email) {
        query.eq('email', body.customer_email);
      } else if (body.customer_phone) {
        query.eq('phone', body.customer_phone);
      }

      const { data: customer, error: customerError } = await query.single();

      if (customerError || !customer) {
        console.log('❌ [withdraw-consent] Customer not found');
        return new Response(JSON.stringify({ error: 'Customer not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      customerId = customer.id;
    }

    if (!customerId) {
      return new Response(
        JSON.stringify({
          error: 'Customer identifier required (customer_id, customer_email, or customer_phone)',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Verify customer belongs to caller's workspace
    if (body.customer_id) {
      const { data: customerCheck } = await supabase
        .from('customers')
        .select('id')
        .eq('id', customerId)
        .eq('workspace_id', workspaceId)
        .maybeSingle();

      if (!customerCheck) {
        return new Response(JSON.stringify({ error: 'Customer not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    console.log('👤 [withdraw-consent] Found customer:', customerId);

    // Find existing consent record
    const { data: existingConsent, error: consentError } = await supabase
      .from('customer_consents')
      .select('*')
      .eq('customer_id', customerId)
      .eq('channel', body.channel)
      .single();

    const now = new Date().toISOString();

    if (existingConsent) {
      const { error: updateError } = await supabase
        .from('customer_consents')
        .update({
          consent_given: false,
          withdrawn_date: now,
          notes: body.reason || 'Consent withdrawn via GDPR request',
          updated_at: now,
        })
        .eq('id', existingConsent.id);

      if (updateError) {
        console.error('❌ [withdraw-consent] Update error:', updateError);
        throw updateError;
      }

      console.log('✅ [withdraw-consent] Consent updated to withdrawn');
    } else {
      const { error: insertError } = await supabase.from('customer_consents').insert({
        customer_id: customerId,
        channel: body.channel,
        consent_given: false,
        withdrawn_date: now,
        notes: body.reason || 'Consent never given / withdrawn via GDPR request',
        consent_method: 'gdpr_request',
        lawful_basis: 'consent',
        purpose: 'customer_service',
      });

      if (insertError) {
        console.error('❌ [withdraw-consent] Insert error:', insertError);
        throw insertError;
      }

      console.log('✅ [withdraw-consent] New withdrawn consent record created');
    }

    // Log the withdrawal action
    await supabase.from('data_access_logs').insert({
      action: 'consent_withdrawal',
      customer_id: customerId,
      metadata: {
        channel: body.channel,
        reason: body.reason,
        method: 'api',
      },
    });

    // Optionally create a deletion request if this is a full "forget me"
    if (body.channel === 'all') {
      console.log('🗑️ [withdraw-consent] Creating deletion request for full withdrawal');

      await supabase.from('data_deletion_requests').insert({
        customer_id: customerId,
        reason: body.reason || 'Full consent withdrawal',
        deletion_type: 'full',
        status: 'pending',
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        customer_id: customerId,
        channel: body.channel,
        withdrawn_at: now,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error: any) {
    if (error instanceof AuthError) {
      return authErrorResponse(error);
    }
    console.error('❌ [withdraw-consent] Error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
