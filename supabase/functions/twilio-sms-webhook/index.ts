import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  try {
    // Twilio sends form-urlencoded data
    const formData = await req.formData();
    const from = formData.get('From')?.toString() || '';
    const to = formData.get('To')?.toString() || '';
    const body = formData.get('Body')?.toString() || '';
    const messageSid = formData.get('MessageSid')?.toString() || '';
    const numMedia = parseInt(formData.get('NumMedia')?.toString() || '0', 10);

    console.log('[sms-webhook] Inbound SMS:', {
      from,
      to,
      bodyLength: body.length,
      numMedia,
      messageSid,
    });

    if (!body && numMedia === 0) {
      return new Response('<Response></Response>', {
        headers: { 'Content-Type': 'text/xml' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Find workspace by SMS number
    const { data: workspace } = await supabase
      .from('workspace_channels')
      .select('workspace_id')
      .eq('channel_type', 'sms')
      .eq('channel_identifier', to)
      .maybeSingle();

    // Fallback: use first workspace
    let workspaceId = workspace?.workspace_id;
    if (!workspaceId) {
      const { data: firstWorkspace } = await supabase
        .from('workspaces')
        .select('id')
        .limit(1)
        .single();
      workspaceId = firstWorkspace?.id;
    }

    if (!workspaceId) {
      console.error('[sms-webhook] No workspace found for number:', to);
      return new Response('<Response></Response>', {
        headers: { 'Content-Type': 'text/xml' },
      });
    }

    // Find or create customer by phone number
    let { data: customer } = await supabase
      .from('customers')
      .select('id, name, email, phone')
      .eq('workspace_id', workspaceId)
      .eq('phone', from)
      .maybeSingle();

    if (!customer) {
      const { data: newCustomer, error: custError } = await supabase
        .from('customers')
        .insert({
          workspace_id: workspaceId,
          phone: from,
          name: from,
          preferred_channel: 'sms',
        })
        .select('id, name, email, phone')
        .single();

      if (custError) {
        throw new Error(`Failed to create customer: ${custError.message}`);
      }
      customer = newCustomer;
    }

    // Find existing open conversation or create new one
    let { data: conversation } = await supabase
      .from('conversations')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('customer_id', customer.id)
      .eq('channel', 'sms')
      .in('status', ['new', 'open', 'waiting_internal', 'ai_handling', 'escalated'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!conversation) {
      const { data: newConv, error: convError } = await supabase
        .from('conversations')
        .insert({
          workspace_id: workspaceId,
          customer_id: customer.id,
          channel: 'sms',
          title: `SMS from ${from}`,
          status: 'new',
          decision_bucket: 'act_now',
          requires_reply: true,
          metadata: { phone_number: from },
        })
        .select('id')
        .single();

      if (convError) {
        throw new Error(`Failed to create conversation: ${convError.message}`);
      }
      conversation = newConv;
    }

    // Save the inbound message
    const { error: msgError } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversation.id,
        direction: 'inbound',
        channel: 'sms',
        body: body || `[Media received (${numMedia} file${numMedia > 1 ? 's' : ''})]`,
        actor_type: 'customer',
        actor_name: from,
        external_id: messageSid,
        is_internal: false,
        created_at: new Date().toISOString(),
      });

    if (msgError) {
      console.error('[sms-webhook] Failed to save message:', msgError);
    }

    // Update conversation timestamps
    await supabase
      .from('conversations')
      .update({
        status: 'new',
        requires_reply: true,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversation.id);

    // Fire-and-forget: trigger AI enrichment
    fetch(`${supabaseUrl}/functions/v1/ai-enrich-conversation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({
        conversation_id: conversation.id,
        workspace_id: workspaceId,
      }),
    }).catch((e) => console.warn('[sms-webhook] ai-enrich trigger failed:', e));

    console.log('[sms-webhook] Processed successfully:', {
      conversationId: conversation.id,
      customerId: customer.id,
    });

    return new Response('<Response></Response>', {
      headers: { 'Content-Type': 'text/xml' },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[sms-webhook] Error:', errorMessage);

    // Always return 200 to Twilio to prevent retries
    return new Response('<Response></Response>', {
      headers: { 'Content-Type': 'text/xml' },
    });
  }
});
