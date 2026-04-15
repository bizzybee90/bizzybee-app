import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { resolveWorkspaceIdForChannel } from '../_shared/channel-routing.ts';
import { captureEdgeException } from '../_shared/sentry.ts';

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

async function verifyTwilioSignature(rawBody: string, req: Request): Promise<void> {
  const twilioAuthToken = Deno.env.get('TWILIO_AUTH_TOKEN')?.trim();
  if (!twilioAuthToken) {
    console.warn('[sms-webhook] TWILIO_AUTH_TOKEN not set - skipping signature verification');
    return;
  }

  const twilioSignature = req.headers.get('X-Twilio-Signature')?.trim();
  if (!twilioSignature) {
    console.error('[sms-webhook] Missing X-Twilio-Signature header');
    throw new WebhookAuthError('Invalid signature');
  }

  try {
    const webhookUrl = new URL(req.url).toString();
    const params = new URLSearchParams(rawBody);
    const sortedKeys = [...params.keys()].sort();
    let dataString = webhookUrl;
    for (const key of sortedKeys) {
      dataString += key + params.get(key);
    }

    const encoder = new TextEncoder();
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      encoder.encode(twilioAuthToken),
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign'],
    );
    const sigBytes = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(dataString));
    const expectedSig = btoa(String.fromCharCode(...new Uint8Array(sigBytes)));

    if (!timingSafeEqual(expectedSig, twilioSignature)) {
      console.error('[sms-webhook] Twilio signature mismatch');
      throw new WebhookAuthError('Invalid signature');
    }
  } catch (error) {
    if (error instanceof WebhookAuthError) {
      throw error;
    }

    console.error('[sms-webhook] Signature verification failed:', error);
    throw new WebhookAuthError('Invalid signature');
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    // Read raw body for signature verification, then parse form data
    const rawBody = await req.text();
    await verifyTwilioSignature(rawBody, req);

    // Parse form-urlencoded data from the raw body
    const formParams = new URLSearchParams(rawBody);
    const from = formParams.get('From') || '';
    const to = formParams.get('To') || '';
    const body = formParams.get('Body') || '';
    const messageSid = formParams.get('MessageSid') || '';
    const numMedia = parseInt(formParams.get('NumMedia') || '0', 10);

    const maskedFrom = from.length > 3 ? `+44***${from.slice(-3)}` : '***';
    const maskedTo = to.length > 3 ? `+44***${to.slice(-3)}` : '***';
    console.log('[sms-webhook] Inbound SMS:', {
      from: maskedFrom,
      to: maskedTo,
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

    const workspaceId = await resolveWorkspaceIdForChannel(
      supabase,
      'sms',
      { raw: [to], phone: [to] },
      '[sms-webhook]',
    );

    if (!workspaceId) {
      console.error('[sms-webhook] No workspace_channels config found for SMS. Number:', maskedTo);
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
    const { error: msgError } = await supabase.from('messages').insert({
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
        Authorization: `Bearer ${supabaseKey}`,
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
    if (error instanceof WebhookAuthError) {
      return new Response(error.message, { status: error.status });
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[sms-webhook] Error:', errorMessage);
    await captureEdgeException({
      functionName: 'twilio-sms-webhook',
      error,
      tags: { channel: 'sms' },
    });

    // Always return 200 to Twilio to prevent retries
    return new Response('<Response></Response>', {
      headers: { 'Content-Type': 'text/xml' },
    });
  }
});
