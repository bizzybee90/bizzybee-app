import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { AuthError, authErrorResponse, validateAuth } from '../_shared/auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { conversationId, markAsRead = true, archive = false } = await req.clone().json();

    if (!conversationId) {
      return new Response(JSON.stringify({ error: 'conversationId is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(
      `mark-email-read: conversationId=${conversationId}, markAsRead=${markAsRead}, archive=${archive}`,
    );

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Resolve the canonical workspace before continuing so access checks bind to the
    // actual target conversation instead of trusting the caller.
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('id, workspace_id, channel, metadata, external_conversation_id')
      .eq('id', conversationId)
      .single();

    if (convError || !conversation) {
      console.error('Conversation not found:', convError);
      return new Response(JSON.stringify({ error: 'Conversation not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    await validateAuth(req, conversation.workspace_id);

    // Only process email conversations
    if (conversation.channel !== 'email') {
      console.log('Not an email conversation, skipping');
      return new Response(JSON.stringify({ success: true, message: 'Not an email conversation' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Try to find external_id from messages table (more reliable than metadata)
    let aurinkoMessageId: string | null = null;
    let configId: string | null = null;

    // First try: get from the latest inbound message
    const { data: latestMsg } = await supabase
      .from('messages')
      .select('external_id, config_id')
      .eq('conversation_id', conversationId)
      .eq('direction', 'inbound')
      .not('external_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestMsg?.external_id) {
      aurinkoMessageId = latestMsg.external_id;
      configId = latestMsg.config_id;
    } else {
      // Fallback to metadata
      const metadata = conversation.metadata || {};
      aurinkoMessageId =
        ((metadata as Record<string, unknown>).aurinko_message_id as string) || null;
    }

    if (!aurinkoMessageId) {
      console.log('No external message ID found, skipping');
      return new Response(JSON.stringify({ success: true, message: 'No external message ID' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch the email provider config
    let emailConfig: Record<string, unknown> | null = null;

    if (configId) {
      const { data } = await supabase
        .from('email_provider_configs')
        .select('id, account_id, email_address')
        .eq('id', configId)
        .maybeSingle();
      emailConfig = data;
    }

    if (!emailConfig) {
      // Fallback: get any config for this workspace
      const { data } = await supabase
        .from('email_provider_configs')
        .select('id, account_id, email_address')
        .eq('workspace_id', conversation.workspace_id)
        .limit(1)
        .maybeSingle();
      emailConfig = data;
    }

    if (!emailConfig) {
      console.error('Email config not found');
      return new Response(JSON.stringify({ error: 'Email configuration not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get decrypted access token securely
    const { data: tokenData, error: tokenError } = await supabase.rpc(
      'get_decrypted_access_token',
      { p_config_id: emailConfig.id },
    );

    if (tokenError || !tokenData) {
      console.error('Failed to get access token:', tokenError);
      return new Response(JSON.stringify({ error: 'Failed to retrieve access token' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const accessToken = tokenData;
    const aurinkoBaseUrl = Deno.env.get('AURINKO_API_BASE_URL') || 'https://api.aurinko.io';

    // Build the PATCH body
    const patchBody: Record<string, unknown> = {
      unread: !markAsRead,
    };

    // If archiving, also remove Inbox and Unread labels
    if (archive) {
      patchBody.removeSysLabels = ['\\Inbox', '\\Unread'];
    }

    // Mark email as read/unread (and optionally archive) in Aurinko/Gmail
    console.log(`Patching email ${aurinkoMessageId}: ${JSON.stringify(patchBody)}`);

    const response = await fetch(`${aurinkoBaseUrl}/v1/email/messages/${aurinkoMessageId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(patchBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Failed to update email:', response.status, errorText);
      return new Response(JSON.stringify({ error: 'Failed to update email', details: errorText }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(
      `Email ${aurinkoMessageId} updated successfully (read=${markAsRead}, archive=${archive})`,
    );

    return new Response(
      JSON.stringify({
        success: true,
        messageId: aurinkoMessageId,
        markedAsRead: markAsRead,
        archived: archive,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return authErrorResponse(error);
    }
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error in mark-email-read:', error);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
