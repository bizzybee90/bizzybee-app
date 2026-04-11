import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { validateAuth, AuthError, authErrorResponse } from '../_shared/auth.ts';
import {
  EntitlementGuardError,
  entitlementGuardErrorResponse,
  requireEntitlement,
  type BillingAddonKey,
} from '../_shared/entitlements.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SendReplyRequest {
  conversation_id?: string;
  content?: string;
  workspace_id?: string;
  status_after_send?: string;
  actor_type?: string;
  actor_name?: string;
  actor_id?: string | null;
}

function resolvePremiumAddonGuard(channel: string, actorType: string): BillingAddonKey | null {
  const normalizedActorType = actorType.trim().toLowerCase();
  const isAiDrivenActor =
    normalizedActorType === 'ai_agent' || normalizedActorType === 'ai' || normalizedActorType === 'system';

  if (!isAiDrivenActor) return null;
  if (channel === 'whatsapp') return 'whatsapp_ai';
  if (channel === 'sms') return 'sms_ai';
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    // --- Auth validation ---
    let body: SendReplyRequest;
    try {
      body = await req.clone().json();
    } catch {
      body = {};
    }

    let auth;
    try {
      auth = await validateAuth(req, body.workspace_id);
    } catch (authErr: unknown) {
      if (authErr instanceof AuthError) return authErrorResponse(authErr);
      throw authErr;
    }

    // --- Validate input ---
    const conversationId = body.conversation_id;
    const content = body.content;
    const workspaceId = body.workspace_id;
    const statusAfterSend = body.status_after_send?.trim() || 'resolved';
    const actorType = body.actor_type?.trim() || 'human_agent';

    if (!conversationId) throw new Error('conversation_id is required');
    if (!workspaceId) throw new Error('workspace_id is required');
    if (!content || content.trim().length === 0)
      throw new Error('content is required and cannot be empty');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // --- Fetch conversation with customer ---
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select(
        `
        id, title, status, channel, workspace_id, external_conversation_id, metadata, first_response_at,
        customer:customers(id, email, name)
      `,
      )
      .eq('id', conversationId)
      .eq('workspace_id', workspaceId)
      .single();

    if (convError || !conversation) {
      throw new Error(`Conversation not found: ${convError?.message || conversationId}`);
    }

    const channel = conversation.channel || 'email';
    const customer = Array.isArray(conversation.customer)
      ? conversation.customer[0]
      : conversation.customer;
    const actorId = body.actor_id ?? (auth.userId === 'service_role' ? null : auth.userId);
    let actorName = body.actor_name?.trim() || null;

    if (!customer) throw new Error(`No customer associated with conversation ${conversationId}`);

    if (!actorName && auth.userId !== 'service_role') {
      const { data: user } = await supabase
        .from('users')
        .select('name')
        .eq('id', auth.userId)
        .maybeSingle();

      actorName = user?.name?.trim() || null;
    }

    const premiumAddonGuard = resolvePremiumAddonGuard(channel, actorType);
    if (premiumAddonGuard) {
      await requireEntitlement({
        supabase,
        workspaceId,
        entitlementKey: premiumAddonGuard,
        functionName: 'send-reply',
        action: `send_${channel}_message`,
        context: {
          conversationId,
          actorType,
          channel,
        },
      });
    }

    const updateConversationAfterSend = async () => {
      const timestamp = new Date().toISOString();
      const updates: Record<string, string> = {
        status: statusAfterSend,
        last_message_at: timestamp,
        updated_at: timestamp,
      };

      if (!conversation.first_response_at) {
        updates.first_response_at = timestamp;
      }

      await supabase.from('conversations').update(updates).eq('id', conversationId);
    };

    const successResponse = (messageId: string | null, externalId: string | null) =>
      new Response(
        JSON.stringify({
          success: true,
          message_id: messageId,
          external_id: externalId,
          duration_ms: Date.now() - startTime,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );

    // --- Channel-specific send ---
    switch (channel) {
      case 'email': {
        if (!customer.email) {
          throw new Error(`Customer has no email address for conversation ${conversationId}`);
        }

        // Get email provider config
        const { data: emailConfig, error: configError } = await supabase
          .from('email_provider_configs')
          .select('id, account_id, email_address')
          .eq('workspace_id', workspaceId)
          .single();

        if (configError || !emailConfig) {
          throw new Error('No email provider configured. Please connect your email first.');
        }

        // Get access token
        const { data: accessToken, error: tokenError } = await supabase.rpc(
          'get_decrypted_access_token',
          { config_id: emailConfig.id },
        );

        if (tokenError || !accessToken) {
          throw new Error('Email access token missing. Please reconnect your email.');
        }

        // Fetch the latest inbound message for threading headers
        const { data: latestInbound } = await supabase
          .from('messages')
          .select('external_id, external_thread_id')
          .eq('conversation_id', conversationId)
          .eq('direction', 'inbound')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const subject = conversation.title || 'Re: Your inquiry';
        const emailPayload: Record<string, unknown> = {
          to: [{ email: customer.email, name: customer.name || '' }],
          subject: subject.startsWith('Re:') ? subject : `Re: ${subject}`,
          body: content,
          bodyType: 'text',
        };

        // Thread into the existing conversation
        const threadId =
          latestInbound?.external_thread_id ||
          conversation.external_conversation_id ||
          (conversation.metadata as Record<string, unknown>)?.aurinko_thread_id;

        if (threadId) {
          emailPayload.threadId = threadId;
        }

        // Set In-Reply-To header for proper email threading
        if (latestInbound?.external_id) {
          emailPayload.inReplyTo = latestInbound.external_id;
        }

        // Send via Aurinko
        const aurinkoResponse = await fetch('https://api.aurinko.io/v1/email/messages', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(emailPayload),
        });

        if (!aurinkoResponse.ok) {
          const errorBody = await aurinkoResponse.text();
          if (aurinkoResponse.status === 401) {
            throw new Error('Email access token expired. Please reconnect your email account.');
          }
          throw new Error(`Aurinko API error ${aurinkoResponse.status}: ${errorBody}`);
        }

        const aurinkoData = await aurinkoResponse.json();
        const externalMessageId = aurinkoData.id;

        // Save outbound message
        const { data: savedMessage, error: messageError } = await supabase
          .from('messages')
          .insert({
            conversation_id: conversationId,
            direction: 'outbound',
            channel: 'email',
            body: content,
            actor_id: actorId,
            actor_type: actorType,
            actor_name: actorName || emailConfig.email_address,
            from_email: emailConfig.email_address,
            to_email: customer.email,
            external_id: externalMessageId ? String(externalMessageId) : null,
            external_thread_id: threadId ? String(threadId) : null,
            config_id: emailConfig.id,
            is_ai_draft: false,
            is_internal: false,
            created_at: new Date().toISOString(),
          })
          .select('id')
          .single();

        if (messageError) {
          console.error('[send-reply] Warning: Failed to save message:', messageError);
        }

        await updateConversationAfterSend();

        // Fire-and-forget: mark email as read in Gmail
        fetch(`${supabaseUrl}/functions/v1/mark-email-read`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${supabaseKey}`,
          },
          body: JSON.stringify({ conversationId, markAsRead: true }),
        }).catch((e) => console.warn('[send-reply] mark-email-read failed:', e));

        return successResponse(savedMessage?.id || null, externalMessageId || null);
      }

      case 'whatsapp': {
        const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
        const authToken = Deno.env.get('TWILIO_AUTH_TOKEN');
        const whatsappNumber = Deno.env.get('TWILIO_WHATSAPP_NUMBER');

        if (!accountSid || !authToken || !whatsappNumber) {
          throw new Error(
            'Twilio WhatsApp credentials not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_WHATSAPP_NUMBER.',
          );
        }

        const customerPhone =
          customer.phone || (conversation.metadata as Record<string, unknown>)?.whatsapp_number;
        if (!customerPhone) {
          throw new Error(`No phone number for customer in conversation ${conversationId}`);
        }

        const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
        const twilioAuth = btoa(`${accountSid}:${authToken}`);

        const twilioBody = new URLSearchParams({
          From: `whatsapp:${whatsappNumber}`,
          To: `whatsapp:${customerPhone}`,
          Body: content,
        });

        const twilioResponse = await fetch(twilioUrl, {
          method: 'POST',
          headers: {
            Authorization: `Basic ${twilioAuth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: twilioBody.toString(),
        });

        if (!twilioResponse.ok) {
          const errorBody = await twilioResponse.text();
          throw new Error(`Twilio WhatsApp error ${twilioResponse.status}: ${errorBody}`);
        }

        const twilioData = await twilioResponse.json();

        // Save outbound message
        const { data: whatsappMessage, error: whatsappMsgError } = await supabase
          .from('messages')
          .insert({
            conversation_id: conversationId,
            direction: 'outbound',
            channel: 'whatsapp',
            body: content,
            actor_id: actorId,
            actor_type: actorType,
            actor_name: actorName || whatsappNumber,
            external_id: twilioData.sid || null,
            is_ai_draft: false,
            is_internal: false,
            created_at: new Date().toISOString(),
          })
          .select('id')
          .single();

        if (whatsappMsgError) {
          console.error('[send-reply] Warning: Failed to save WhatsApp message:', whatsappMsgError);
        }

        await updateConversationAfterSend();

        return successResponse(whatsappMessage?.id || null, twilioData.sid || null);
      }

      case 'sms': {
        const smsAccountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
        const smsAuthToken = Deno.env.get('TWILIO_AUTH_TOKEN');
        const smsFromNumber =
          Deno.env.get('TWILIO_SMS_NUMBER') || Deno.env.get('TWILIO_WHATSAPP_NUMBER');

        if (!smsAccountSid || !smsAuthToken || !smsFromNumber) {
          throw new Error(
            'Twilio SMS credentials not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_SMS_NUMBER.',
          );
        }

        const smsCustomerPhone =
          customer.phone || (conversation.metadata as Record<string, unknown>)?.phone_number;
        if (!smsCustomerPhone) {
          throw new Error(`No phone number for customer in conversation ${conversationId}`);
        }

        const smsTwilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${smsAccountSid}/Messages.json`;
        const smsTwilioAuth = btoa(`${smsAccountSid}:${smsAuthToken}`);

        const smsBody = new URLSearchParams({
          From: smsFromNumber,
          To: String(smsCustomerPhone),
          Body: content,
        });

        const smsResponse = await fetch(smsTwilioUrl, {
          method: 'POST',
          headers: {
            Authorization: `Basic ${smsTwilioAuth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: smsBody.toString(),
        });

        if (!smsResponse.ok) {
          const errorBody = await smsResponse.text();
          throw new Error(`Twilio SMS error ${smsResponse.status}: ${errorBody}`);
        }

        const smsData = await smsResponse.json();

        // Save outbound message
        const { data: smsMessage, error: smsMsgError } = await supabase
          .from('messages')
          .insert({
            conversation_id: conversationId,
            direction: 'outbound',
            channel: 'sms',
            body: content,
            actor_id: actorId,
            actor_type: actorType,
            actor_name: actorName || smsFromNumber,
            external_id: smsData.sid || null,
            is_ai_draft: false,
            is_internal: false,
            created_at: new Date().toISOString(),
          })
          .select('id')
          .single();

        if (smsMsgError) {
          console.error('[send-reply] Warning: Failed to save SMS message:', smsMsgError);
        }

        await updateConversationAfterSend();

        return successResponse(smsMessage?.id || null, smsData.sid || null);
      }

      case 'facebook':
      case 'instagram': {
        // Per-workspace token from meta_provider_configs, global env fallback
        let pageAccessToken: string | undefined;
        const { data: metaConfig } = await supabase
          .from('meta_provider_configs')
          .select('id')
          .eq('workspace_id', conversation.workspace_id)
          .eq('status', 'active')
          .maybeSingle();
        if (metaConfig) {
          const { data: decrypted } = await supabase.rpc('get_meta_decrypted_token', {
            p_config_id: metaConfig.id,
          });
          if (decrypted) pageAccessToken = decrypted;
        }
        if (!pageAccessToken) {
          pageAccessToken = Deno.env.get('META_PAGE_ACCESS_TOKEN');
        }
        if (!pageAccessToken) {
          throw new Error('No Meta Page Access Token configured for this workspace.');
        }

        // Customer identifier is stored as fb:SENDER_ID or ig:SENDER_ID
        const prefix = channel === 'facebook' ? 'fb:' : 'ig:';
        const recipientId = customer.phone?.startsWith(prefix)
          ? customer.phone.replace(prefix, '')
          : customer.phone || (conversation.metadata as Record<string, unknown>)?.sender_id;

        if (!recipientId) {
          throw new Error(
            `No ${channel} recipient ID for customer in conversation ${conversationId}`,
          );
        }

        const graphUrl = 'https://graph.facebook.com/v19.0/me/messages';
        const metaResponse = await fetch(`${graphUrl}?access_token=${pageAccessToken}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipient: { id: recipientId },
            message: { text: content },
          }),
        });

        if (!metaResponse.ok) {
          const errorBody = await metaResponse.text();
          throw new Error(`Meta ${channel} API error ${metaResponse.status}: ${errorBody}`);
        }

        const metaData = await metaResponse.json();

        // Save outbound message
        const { data: metaMessage, error: metaMsgError } = await supabase
          .from('messages')
          .insert({
            conversation_id: conversationId,
            direction: 'outbound',
            channel,
            body: content,
            actor_id: actorId,
            actor_type: actorType,
            actor_name: actorName || (channel === 'facebook' ? 'Facebook Page' : 'Instagram'),
            external_id: metaData.message_id || null,
            is_ai_draft: false,
            is_internal: false,
            created_at: new Date().toISOString(),
          })
          .select('id')
          .single();

        if (metaMsgError) {
          console.error(`[send-reply] Warning: Failed to save ${channel} message:`, metaMsgError);
        }

        await updateConversationAfterSend();

        return successResponse(metaMessage?.id || null, metaData.message_id || null);
      }

      case 'google_business': {
        const gbmApiKey = Deno.env.get('GOOGLE_BUSINESS_API_KEY');
        if (!gbmApiKey) {
          throw new Error('GOOGLE_BUSINESS_API_KEY not configured.');
        }

        // Customer identifier is stored as gbm:CONVERSATION_ID
        const gbmConversationId = customer.phone?.startsWith('gbm:')
          ? customer.phone.replace('gbm:', '')
          : (conversation.metadata as Record<string, unknown>)?.gbm_conversation_id;

        if (!gbmConversationId) {
          throw new Error(
            `No Google Business conversation ID for customer in conversation ${conversationId}`,
          );
        }

        // Send via Google Business Messages API
        const gbmUrl = `https://businessmessages.googleapis.com/v1/conversations/${gbmConversationId}/messages`;
        const gbmResponse = await fetch(`${gbmUrl}?key=${gbmApiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messageId: crypto.randomUUID(),
            text: content,
            representative: {
              representativeType: 'BOT',
            },
          }),
        });

        if (!gbmResponse.ok) {
          const errorBody = await gbmResponse.text();
          throw new Error(`Google Business Messages error ${gbmResponse.status}: ${errorBody}`);
        }

        const gbmData = await gbmResponse.json();

        // Save outbound message
        const { data: gbmMessage, error: gbmMsgError } = await supabase
          .from('messages')
          .insert({
            conversation_id: conversationId,
            direction: 'outbound',
            channel: 'google_business',
            body: content,
            actor_id: actorId,
            actor_type: actorType,
            actor_name: actorName || 'Google Business',
            external_id: gbmData.name || null,
            is_ai_draft: false,
            is_internal: false,
            created_at: new Date().toISOString(),
          })
          .select('id')
          .single();

        if (gbmMsgError) {
          console.error(
            '[send-reply] Warning: Failed to save Google Business message:',
            gbmMsgError,
          );
        }

        await updateConversationAfterSend();

        return successResponse(gbmMessage?.id || null, gbmData.name || null);
      }

      default:
        throw new Error(
          `Unsupported channel: ${channel}. Supported: email, whatsapp, sms, facebook, instagram, google_business.`,
        );
    }
  } catch (error: unknown) {
    if (error instanceof EntitlementGuardError) {
      return entitlementGuardErrorResponse(error, corsHeaders);
    }
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[send-reply] Error:', errorMessage);
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Failed to send message. Please try again.',
        duration_ms: Date.now() - startTime,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  }
});
