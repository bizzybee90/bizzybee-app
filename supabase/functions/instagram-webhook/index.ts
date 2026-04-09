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

  // GET: Meta webhook verification
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    const verifyToken = Deno.env.get('META_VERIFY_TOKEN');

    if (mode === 'subscribe' && token === verifyToken) {
      console.log('[instagram-webhook] Webhook verified successfully');
      return new Response(challenge, { status: 200 });
    } else {
      console.warn('[instagram-webhook] Webhook verification failed');
      return new Response('Forbidden', { status: 403 });
    }
  }

  // POST: Incoming Instagram DMs
  try {
    // Read raw body for signature verification before parsing as JSON
    const rawBody = await req.text();

    // --- Meta X-Hub-Signature-256 verification ---
    const metaAppSecret = Deno.env.get('META_APP_SECRET');
    const hubSignature = req.headers.get('X-Hub-Signature-256');
    if (metaAppSecret) {
      if (!hubSignature || !hubSignature.startsWith('sha256=')) {
        console.error('[instagram-webhook] Missing or malformed X-Hub-Signature-256 header');
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
        console.error('[instagram-webhook] Meta signature mismatch');
        return new Response('Invalid signature', { status: 403 });
      }
    } else {
      console.error('[instagram-webhook] META_APP_SECRET not set — rejecting unsigned request');
      return new Response('Server misconfigured', { status: 500 });
    }

    const body = JSON.parse(rawBody);

    // Meta sends an object field to identify the platform
    if (body.object !== 'instagram') {
      console.log('[instagram-webhook] Ignoring non-instagram event:', body.object);
      return new Response('EVENT_RECEIVED', { status: 200 });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Process each entry
    for (const entry of body.entry || []) {
      for (const event of entry.messaging || []) {
        // Skip non-message events (e.g. delivery confirmations, read receipts)
        if (!event.message) {
          continue;
        }

        const senderId = event.sender?.id;
        const messageText = event.message?.text || '';
        const messageId = event.message?.mid || '';
        const timestamp = event.timestamp;

        if (!senderId) {
          console.warn('[instagram-webhook] No sender ID found, skipping');
          continue;
        }

        // Skip echo messages (messages sent by the page itself)
        if (event.message?.is_echo) {
          console.log('[instagram-webhook] Skipping echo message');
          continue;
        }

        const igIdentifier = `ig:${senderId}`;
        const hasAttachments = event.message?.attachments && event.message.attachments.length > 0;

        const maskedSenderId = senderId.length > 4 ? `${senderId.slice(0, 4)}***` : '***';
        console.log('[instagram-webhook] Processing message:', {
          senderId: maskedSenderId,
          messageId,
          textLength: messageText.length,
          hasAttachments,
        });

        if (!messageText && !hasAttachments) {
          console.log('[instagram-webhook] Empty message, skipping');
          continue;
        }

        const workspaceId = await resolveWorkspaceIdForChannel(
          supabase,
          'instagram',
          {
            raw: [String(entry.id || ''), String(event.recipient?.id || '')],
          },
          '[instagram-webhook]',
        );

        if (!workspaceId) {
          console.error('[instagram-webhook] No workspace_channels config found for Instagram');
          continue;
        }

        // Per-workspace token lookup with global fallback
        let pageAccessToken: string | undefined;
        const { data: metaConfig } = await supabase
          .from('meta_provider_configs')
          .select('id')
          .eq('workspace_id', workspaceId)
          .eq('status', 'active')
          .maybeSingle();
        if (metaConfig) {
          const { data: decrypted } = await supabase.rpc('get_meta_decrypted_token', {
            p_config_id: metaConfig.id,
          });
          if (decrypted) pageAccessToken = decrypted;
        }
        if (!pageAccessToken) {
          pageAccessToken = Deno.env.get('META_PAGE_ACCESS_TOKEN') || undefined;
        }

        // Find or create customer by Instagram sender ID (stored as ig:SENDER_ID)
        let { data: customer } = await supabase
          .from('customers')
          .select('id, name, email, phone')
          .eq('workspace_id', workspaceId)
          .eq('phone', igIdentifier)
          .maybeSingle();

        if (!customer) {
          // Try to fetch Instagram profile name via Graph API
          let profileName = igIdentifier;
          if (pageAccessToken) {
            try {
              const profileRes = await fetch(
                `https://graph.instagram.com/v21.0/${senderId}?fields=name,username&access_token=${pageAccessToken}`,
              );
              if (profileRes.ok) {
                const profileData = await profileRes.json();
                profileName = profileData.name || profileData.username || igIdentifier;
              }
            } catch (e) {
              console.warn('[instagram-webhook] Failed to fetch Instagram profile:', e);
            }
          }

          // Use upsert to handle race condition from concurrent webhook deliveries
          const { data: newCustomer, error: custError } = await supabase
            .from('customers')
            .upsert(
              {
                workspace_id: workspaceId,
                phone: igIdentifier,
                name: profileName,
                preferred_channel: 'instagram',
              },
              { onConflict: 'workspace_id,phone', ignoreDuplicates: true },
            )
            .select('id, name, email, phone')
            .single();

          if (custError) {
            // If upsert returned nothing (ignoreDuplicates), re-fetch
            const { data: existingCustomer } = await supabase
              .from('customers')
              .select('id, name, email, phone')
              .eq('workspace_id', workspaceId)
              .eq('phone', igIdentifier)
              .single();
            if (existingCustomer) {
              customer = existingCustomer;
            } else {
              console.error('[instagram-webhook] Failed to create customer:', custError);
              throw new Error(`Failed to create customer: ${custError.message}`);
            }
          } else {
            customer = newCustomer;
          }
        }

        // Find existing open conversation or create new one
        let conversation: { id: string } | null = null;
        let isNewConversation = false;

        const { data: existingConv } = await supabase
          .from('conversations')
          .select('id')
          .eq('workspace_id', workspaceId)
          .eq('customer_id', customer.id)
          .eq('channel', 'instagram')
          .in('status', ['new', 'open', 'waiting_internal', 'ai_handling', 'escalated'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (existingConv) {
          conversation = existingConv;
        } else {
          const { data: newConv, error: convError } = await supabase
            .from('conversations')
            .insert({
              workspace_id: workspaceId,
              customer_id: customer.id,
              channel: 'instagram',
              title: `Instagram DM from ${customer.name || igIdentifier}`,
              status: 'new',
              decision_bucket: 'act_now',
              requires_reply: true,
              metadata: { instagram_sender_id: senderId },
            })
            .select('id')
            .single();

          if (convError) {
            console.error('[instagram-webhook] Failed to create conversation:', convError);
            throw new Error(`Failed to create conversation: ${convError.message}`);
          }
          conversation = newConv;
          isNewConversation = true;
        }

        // Save the inbound message (unique index on conversation_id+external_id prevents duplicates)
        const messageBody =
          hasAttachments && !messageText
            ? `[Media attachment received (${event.message.attachments.length} file${event.message.attachments.length > 1 ? 's' : ''})]`
            : messageText;

        const { error: msgError } = await supabase.from('messages').insert({
          conversation_id: conversation.id,
          direction: 'inbound',
          channel: 'instagram',
          body: messageBody,
          actor_type: 'customer',
          actor_name: customer.name || igIdentifier,
          external_id: messageId,
          is_internal: false,
          created_at: new Date().toISOString(),
        });

        if (msgError) {
          // If duplicate (unique constraint on external_id), skip silently
          if (msgError.code === '23505') {
            console.log('[instagram-webhook] Duplicate message skipped:', messageId);
            continue;
          }
          console.error('[instagram-webhook] Failed to save message:', msgError);
        }

        // Update conversation — only reset status to 'new' for brand new conversations
        const convUpdate: Record<string, unknown> = {
          requires_reply: true,
          last_message_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        if (isNewConversation) {
          convUpdate.status = 'new';
        }
        await supabase.from('conversations').update(convUpdate).eq('id', conversation.id);

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
        }).catch((e) => console.warn('[instagram-webhook] ai-enrich trigger failed:', e));

        console.log('[instagram-webhook] Processed successfully:', {
          conversationId: conversation.id,
          customerId: customer.id,
        });
      }
    }

    return new Response('EVENT_RECEIVED', { status: 200 });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[instagram-webhook] Error:', errorMessage);

    // Always return 200 to Meta to prevent retries
    return new Response('EVENT_RECEIVED', { status: 200 });
  }
});
