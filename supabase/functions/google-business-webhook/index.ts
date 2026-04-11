import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { resolveWorkspaceIdForChannel } from '../_shared/channel-routing.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

class WebhookAuthError extends Error {
  status: number;

  constructor(message: string, status = 403) {
    super(message);
    this.status = status;
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return diff === 0;
}

function verifyGoogleBusinessToken(req: Request): void {
  const expectedToken = Deno.env.get('GOOGLE_BUSINESS_WEBHOOK_TOKEN')?.trim();
  if (!expectedToken) {
    console.warn(
      '[google-business-webhook] GOOGLE_BUSINESS_WEBHOOK_TOKEN not set - skipping token verification',
    );
    return;
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const bearerToken = match?.[1]?.trim() ?? '';

  if (!bearerToken || !timingSafeEqual(expectedToken, bearerToken)) {
    console.error('[google-business-webhook] Invalid or missing bearer token');
    throw new WebhookAuthError('Forbidden');
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    verifyGoogleBusinessToken(req);

    const payload = await req.json();

    const conversationId = payload.conversationId || '';
    const messageText = payload.message?.text || '';
    const messageId = payload.message?.messageId || '';
    const displayName = payload.context?.userInfo?.displayName || '';

    console.log('[google-business-webhook] Inbound message:', {
      conversationId,
      messageId,
      displayName,
      bodyLength: messageText.length,
    });

    if (!messageText) {
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Store conversationId with gbm: prefix in phone field
    const customerPhone = `gbm:${conversationId}`;

    const workspaceId = await resolveWorkspaceIdForChannel(
      supabase,
      'google_business',
      {
        raw: [conversationId, String(payload.agent || ''), String(payload.context?.placeId || '')],
      },
      '[google-business-webhook]',
    );

    if (!workspaceId) {
      console.error(
        '[google-business-webhook] No workspace_channels config found for Google Business',
      );
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Find or create customer by conversationId (stored as gbm:CONVERSATION_ID)
    let { data: customer } = await supabase
      .from('customers')
      .select('id, name, email, phone')
      .eq('workspace_id', workspaceId)
      .eq('phone', customerPhone)
      .maybeSingle();

    if (!customer) {
      const { data: newCustomer, error: custError } = await supabase
        .from('customers')
        .insert({
          workspace_id: workspaceId,
          phone: customerPhone,
          name: displayName || customerPhone,
          preferred_channel: 'google_business',
        })
        .select('id, name, email, phone')
        .single();

      if (custError) {
        console.error('[google-business-webhook] Failed to create customer:', custError);
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
      .eq('channel', 'google_business')
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
          channel: 'google_business',
          title: `Google Business from ${displayName || conversationId}`,
          status: 'new',
          decision_bucket: 'act_now',
          requires_reply: true,
          metadata: { gbm_conversation_id: conversationId },
        })
        .select('id')
        .single();

      if (convError) {
        console.error('[google-business-webhook] Failed to create conversation:', convError);
        throw new Error(`Failed to create conversation: ${convError.message}`);
      }
      conversation = newConv;
    }

    // Save the inbound message
    const { error: msgError } = await supabase.from('messages').insert({
      conversation_id: conversation.id,
      direction: 'inbound',
      channel: 'google_business',
      body: messageText,
      actor_type: 'customer',
      actor_name: displayName || customerPhone,
      external_id: messageId,
      is_internal: false,
      created_at: new Date().toISOString(),
    });

    if (msgError) {
      console.error('[google-business-webhook] Failed to save message:', msgError);
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
        Authorization: `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({
        conversation_id: conversation.id,
        workspace_id: workspaceId,
      }),
    }).catch((e) => console.warn('[google-business-webhook] ai-enrich trigger failed:', e));

    console.log('[google-business-webhook] Processed successfully:', {
      conversationId: conversation.id,
      customerId: customer.id,
    });

    return new Response(JSON.stringify({ status: 'ok' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    if (error instanceof WebhookAuthError) {
      return new Response(error.message, { status: error.status });
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[google-business-webhook] Error:', errorMessage);

    // Return 200 to prevent retries from Google
    return new Response(JSON.stringify({ status: 'ok' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
