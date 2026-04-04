import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { resolveWorkspaceIdForChannel } from '../_shared/channel-routing.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // GET — Meta webhook verification
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    const verifyToken = Deno.env.get('META_VERIFY_TOKEN');

    if (mode === 'subscribe' && token === verifyToken) {
      console.log('[facebook-messenger-webhook] Webhook verified');
      return new Response(challenge, { status: 200 });
    }

    console.error('[facebook-messenger-webhook] Verification failed');
    return new Response('Forbidden', { status: 403 });
  }

  // POST — incoming messages
  try {
    // Read raw body for signature verification before parsing as JSON
    const rawBody = await req.text();

    // --- Meta X-Hub-Signature-256 verification ---
    const metaAppSecret = Deno.env.get('META_APP_SECRET');
    const hubSignature = req.headers.get('X-Hub-Signature-256');
    if (metaAppSecret) {
      if (!hubSignature || !hubSignature.startsWith('sha256=')) {
        console.error(
          '[facebook-messenger-webhook] Missing or malformed X-Hub-Signature-256 header',
        );
        return new Response('Invalid signature', { status: 403 });
      }
      const encoder = new TextEncoder();
      const keyData = encoder.encode(metaAppSecret);
      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      );
      const sigBytes = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(rawBody));
      const expectedHex = [...new Uint8Array(sigBytes)]
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      const receivedHex = hubSignature.slice('sha256='.length);
      if (expectedHex !== receivedHex) {
        console.error('[facebook-messenger-webhook] Meta signature mismatch');
        return new Response('Invalid signature', { status: 403 });
      }
    } else {
      console.warn(
        '[facebook-messenger-webhook] META_APP_SECRET not set — skipping signature verification',
      );
    }

    const body = JSON.parse(rawBody);

    // Meta sends an object field to identify the platform
    if (body.object !== 'page') {
      return new Response('EVENT_RECEIVED', { status: 200 });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Process each entry (usually one)
    for (const entry of body.entry || []) {
      for (const event of entry.messaging || []) {
        // Only handle text messages (skip deliveries, reads, postbacks, etc.)
        if (!event.message || !event.message.text) {
          continue;
        }

        const senderId = event.sender?.id;
        const messageText = event.message.text;
        const messageId = event.message.mid;

        if (!senderId) {
          console.warn('[facebook-messenger-webhook] No sender ID, skipping');
          continue;
        }

        const maskedSenderId = senderId.length > 4 ? `${senderId.slice(0, 4)}***` : '***';
        console.log('[facebook-messenger-webhook] Inbound message:', {
          senderId: maskedSenderId,
          bodyLength: messageText.length,
          messageId,
        });

        const workspaceId = await resolveWorkspaceIdForChannel(
          supabase,
          'facebook',
          {
            raw: [String(entry.id || ''), String(event.recipient?.id || '')],
          },
          '[facebook-messenger-webhook]',
        );

        if (!workspaceId) {
          console.error(
            '[facebook-messenger-webhook] No workspace_channels config found for Facebook',
          );
          continue;
        }

        // Store Facebook sender ID as fb:SENDER_ID since we don't have a phone number
        const customerPhone = `fb:${senderId}`;

        // Find or create customer by Facebook sender ID
        let { data: customer } = await supabase
          .from('customers')
          .select('id, name, email, phone')
          .eq('workspace_id', workspaceId)
          .eq('phone', customerPhone)
          .maybeSingle();

        if (!customer) {
          // Try to get the user's name from the Messenger Profile API
          let profileName = customerPhone;
          try {
            const pageAccessToken = Deno.env.get('META_PAGE_ACCESS_TOKEN');
            if (pageAccessToken) {
              const profileRes = await fetch(
                `https://graph.facebook.com/v19.0/${senderId}?fields=first_name,last_name&access_token=${pageAccessToken}`,
              );
              if (profileRes.ok) {
                const profile = await profileRes.json();
                if (profile.first_name) {
                  profileName = [profile.first_name, profile.last_name].filter(Boolean).join(' ');
                }
              }
            }
          } catch (e) {
            console.warn('[facebook-messenger-webhook] Failed to fetch profile name:', e);
          }

          const { data: newCustomer, error: custError } = await supabase
            .from('customers')
            .insert({
              workspace_id: workspaceId,
              phone: customerPhone,
              name: profileName,
              preferred_channel: 'facebook',
            })
            .select('id, name, email, phone')
            .single();

          if (custError) {
            console.error('[facebook-messenger-webhook] Failed to create customer:', custError);
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
          .eq('channel', 'facebook')
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
              channel: 'facebook',
              title: `Messenger from ${customer.name || customerPhone}`,
              status: 'new',
              decision_bucket: 'act_now',
              requires_reply: true,
              metadata: { facebook_sender_id: senderId },
            })
            .select('id')
            .single();

          if (convError) {
            console.error('[facebook-messenger-webhook] Failed to create conversation:', convError);
            throw new Error(`Failed to create conversation: ${convError.message}`);
          }
          conversation = newConv;
        }

        // Save the inbound message
        const { error: msgError } = await supabase.from('messages').insert({
          conversation_id: conversation.id,
          direction: 'inbound',
          channel: 'facebook',
          body: messageText,
          actor_type: 'customer',
          actor_name: customer.name || customerPhone,
          external_id: messageId,
          is_internal: false,
          created_at: new Date().toISOString(),
        });

        if (msgError) {
          console.error('[facebook-messenger-webhook] Failed to save message:', msgError);
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
        }).catch((e) => console.warn('[facebook-messenger-webhook] ai-enrich trigger failed:', e));

        console.log('[facebook-messenger-webhook] Processed successfully:', {
          conversationId: conversation.id,
          customerId: customer.id,
        });
      }
    }

    // Always return 200 to Meta to acknowledge receipt
    return new Response('EVENT_RECEIVED', { status: 200 });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[facebook-messenger-webhook] Error:', errorMessage);

    // Always return 200 to Meta to prevent retries
    return new Response('EVENT_RECEIVED', { status: 200 });
  }
});
