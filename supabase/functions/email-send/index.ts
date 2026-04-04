import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') || '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SendEmailRequest {
  conversation_id: string;
  workspace_id: string;
  message_body: string;
}

interface SendEmailResponse {
  success: boolean;
  message_id?: string;
  external_id?: string;
  error?: string;
  function?: string;
  step?: string;
  duration_ms?: number;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const functionName = 'email-send';
  let currentStep = 'initializing';

  try {
    // Auth validation
    const { validateAuth, AuthError, authErrorResponse } = await import('../_shared/auth.ts');
    let bodyRaw: any;
    try {
      bodyRaw = await req.clone().json();
    } catch {
      bodyRaw = {};
    }
    try {
      await validateAuth(req, bodyRaw.workspace_id);
    } catch (authErr: any) {
      if (authErr instanceof AuthError) return authErrorResponse(authErr);
      throw authErr;
    }

    // ========================================
    // STEP 1: Parse and validate input
    // ========================================
    currentStep = 'parsing_input';

    const body: SendEmailRequest = bodyRaw;

    if (!body.conversation_id) {
      throw new Error('conversation_id is required');
    }
    if (!body.workspace_id) {
      throw new Error('workspace_id is required');
    }
    if (!body.message_body) {
      throw new Error('message_body is required');
    }
    if (body.message_body.trim().length === 0) {
      throw new Error('message_body cannot be empty');
    }

    console.log(`[${functionName}] Starting:`, {
      conversation_id: body.conversation_id,
      workspace_id: body.workspace_id,
      message_length: body.message_body.length,
    });

    // ========================================
    // STEP 2: Initialize Supabase client
    // ========================================
    currentStep = 'initializing_supabase';

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl) throw new Error('SUPABASE_URL environment variable not configured');
    if (!supabaseKey)
      throw new Error('SUPABASE_SERVICE_ROLE_KEY environment variable not configured');

    const supabase = createClient(supabaseUrl, supabaseKey);

    // ========================================
    // STEP 3: Get conversation with customer
    // ========================================
    currentStep = 'fetching_conversation';

    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select(
        `
        id,
        source_id,
        subject,
        status,
        workspace_id,
        customer:customers(id, email, name)
      `,
      )
      .eq('id', body.conversation_id)
      .eq('workspace_id', body.workspace_id)
      .single();

    if (convError) {
      throw new Error(`Failed to fetch conversation: ${convError.message}`);
    }
    if (!conversation) {
      throw new Error(`Conversation not found: ${body.conversation_id}`);
    }

    const customer = Array.isArray(conversation.customer)
      ? conversation.customer[0]
      : conversation.customer;

    if (!customer) {
      throw new Error(`No customer associated with conversation: ${body.conversation_id}`);
    }
    if (!customer.email) {
      throw new Error(`Customer has no email address for conversation: ${body.conversation_id}`);
    }

    const threadId = conversation.source_id;
    const recipientEmail = customer.email;
    const recipientName = customer.name || '';
    const subject = conversation.subject || 'Re: Your inquiry';

    console.log(`[${functionName}] Conversation loaded:`, {
      thread_id: threadId,
      recipient: recipientEmail,
      subject: subject,
    });

    // ========================================
    // STEP 4: Get email provider config
    // ========================================
    currentStep = 'fetching_email_config';

    const { data: emailConfig, error: configError } = await supabase
      .from('email_provider_configs')
      .select('id, account_id, email_address')
      .eq('workspace_id', body.workspace_id)
      .single();

    if (configError) {
      throw new Error(`Failed to fetch email config: ${configError.message}`);
    }
    if (!emailConfig) {
      throw new Error(
        'No email provider configured for this workspace. Please connect your email first.',
      );
    }
    if (!emailConfig.account_id) {
      throw new Error('Email account ID is missing. Please reconnect your email.');
    }

    // Get decrypted access token securely
    const { data: accessToken, error: tokenError } = await supabase.rpc(
      'get_decrypted_access_token',
      { config_id: emailConfig.id },
    );

    if (tokenError || !accessToken) {
      throw new Error('Email access token is missing. Please reconnect your email.');
    }

    const senderEmail = emailConfig.email_address;
    console.log(`[${functionName}] Email config loaded, sending from: ${senderEmail}`);

    // ========================================
    // STEP 5: Send email via Aurinko
    // ========================================
    currentStep = 'sending_via_aurinko';

    // Build the email payload for Aurinko
    const emailPayload: Record<string, unknown> = {
      to: [{ email: recipientEmail, name: recipientName }],
      subject: subject.startsWith('Re:') ? subject : `Re: ${subject}`,
      body: body.message_body,
      bodyType: 'text', // Use 'html' if sending HTML emails
    };

    // If we have a thread ID, include it to reply in-thread
    if (threadId) {
      emailPayload.threadId = threadId;
    }

    const aurinkoResponse = await fetch(`https://api.aurinko.io/v1/email/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(emailPayload),
    });

    if (!aurinkoResponse.ok) {
      const errorBody = await aurinkoResponse.text();

      // Check for token expiration
      if (aurinkoResponse.status === 401) {
        throw new Error('Email access token expired. Please reconnect your email account.');
      }

      throw new Error(`Aurinko API error ${aurinkoResponse.status}: ${errorBody}`);
    }

    const aurinkoData = await aurinkoResponse.json();

    if (!aurinkoData.id) {
      throw new Error('Aurinko returned success but no message ID');
    }

    const externalMessageId = aurinkoData.id;
    console.log(`[${functionName}] Email sent via Aurinko:`, { external_id: externalMessageId });

    // ========================================
    // STEP 6: Save message to database
    // ========================================
    currentStep = 'saving_message';

    const { data: savedMessage, error: messageError } = await supabase
      .from('messages')
      .insert({
        conversation_id: body.conversation_id,
        direction: 'outbound',
        body: body.message_body,
        from_email: senderEmail,
        to_email: recipientEmail,
        external_id: externalMessageId,
        is_ai_draft: false,
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (messageError) {
      // Log the error but don't fail - email was already sent
      console.error(`[${functionName}] Warning: Failed to save message to database:`, messageError);
    }

    const messageId = savedMessage?.id || null;
    console.log(`[${functionName}] Message saved:`, { message_id: messageId });

    // ========================================
    // STEP 7: Update conversation status
    // ========================================
    currentStep = 'updating_conversation';

    const { error: updateError } = await supabase
      .from('conversations')
      .update({
        status: 'awaiting_reply',
        updated_at: new Date().toISOString(),
      })
      .eq('id', body.conversation_id);

    if (updateError) {
      // Log but don't fail - email was sent and message was saved
      console.error(
        `[${functionName}] Warning: Failed to update conversation status:`,
        updateError,
      );
    }

    // ========================================
    // STEP 8: Return success
    // ========================================
    const duration = Date.now() - startTime;
    console.log(`[${functionName}] Completed in ${duration}ms:`, {
      message_id: messageId,
      external_id: externalMessageId,
      recipient: recipientEmail,
    });

    const response: SendEmailResponse = {
      success: true,
      message_id: messageId,
      external_id: externalMessageId,
      duration_ms: duration,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    const duration = Date.now() - startTime;

    console.error(`[${functionName}] Error at step "${currentStep}":`, errorMessage);

    const response: SendEmailResponse = {
      success: false,
      error: errorMessage,
      function: functionName,
      step: currentStep,
      duration_ms: duration,
    };

    return new Response(JSON.stringify(response), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
