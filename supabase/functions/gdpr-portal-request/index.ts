import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface GDPRRequest {
  email: string;
  request_type: 'export' | 'deletion';
  reason?: string;
  workspace_slug: string;
}

// Create HMAC signature for token verification
async function createHmacSignature(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const data = encoder.encode(payload);
  
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign('HMAC', key, data);
  const signatureArray = new Uint8Array(signature);
  return Array.from(signatureArray).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Create signed GDPR token
async function createSignedToken(data: Record<string, unknown>, secret: string): Promise<string> {
  const payload = btoa(JSON.stringify(data));
  const signature = await createHmacSignature(payload, secret);
  return `${payload}.${signature}`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const postmarkApiKey = Deno.env.get('POSTMARK_API_KEY');
    const gdprSecret = Deno.env.get('GDPR_TOKEN_SECRET');
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (!gdprSecret) {
      console.error('GDPR_TOKEN_SECRET not configured');
      return new Response(
        JSON.stringify({ error: 'GDPR service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { email, request_type, reason, workspace_slug }: GDPRRequest = await req.json();

    if (!email || !request_type) {
      return new Response(
        JSON.stringify({ error: 'Email and request_type are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return new Response(
        JSON.stringify({ error: 'Invalid email format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('GDPR request received:', { email, request_type, workspace_slug });

    // Find workspace by slug (optional - for multi-tenant)
    let workspaceId: string | null = null;
    if (workspace_slug && workspace_slug !== 'default') {
      const { data: workspace } = await supabase
        .from('workspaces')
        .select('id')
        .eq('slug', workspace_slug)
        .single();
      workspaceId = workspace?.id || null;
    }

    // Find customer by email
    const { data: customer } = await supabase
      .from('customers')
      .select('id, name, workspace_id')
      .eq('email', email.toLowerCase())
      .maybeSingle();

    // Generate verification token with expiration
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Create token data to be signed
    const requestData = {
      email: email.toLowerCase(),
      request_type,
      reason,
      customer_id: customer?.id || null,
      workspace_id: workspaceId || customer?.workspace_id || null,
      created_at: new Date().toISOString(),
      expires_at: expiresAt.toISOString()
    };

    // Create HMAC-signed token (payload.signature format)
    const verificationToken = await createSignedToken(requestData, gdprSecret);

    // Build verification URL
    const appUrl = Deno.env.get('APP_URL') || 'https://bizzybee.app';
    const verificationUrl = `${appUrl}/gdpr-portal?token=${encodeURIComponent(verificationToken)}&action=${request_type}`;

    // Send verification email
    if (postmarkApiKey) {
      const emailSubject = request_type === 'export' 
        ? 'Verify Your Data Export Request'
        : 'Verify Your Data Deletion Request';

      const emailBody = `
        <h2>Verify Your GDPR Request</h2>
        <p>Hello${customer?.name ? ` ${customer.name}` : ''},</p>
        <p>We received a request to ${request_type === 'export' ? 'export your personal data' : 'delete your personal data'}.</p>
        <p>To confirm this request, please click the button below:</p>
        <p style="margin: 30px 0;">
          <a href="${verificationUrl}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
            ${request_type === 'export' ? 'Confirm Data Export' : 'Confirm Data Deletion'}
          </a>
        </p>
        <p>If you didn't make this request, you can safely ignore this email.</p>
        <p>This link will expire in 24 hours.</p>
        <hr style="margin: 30px 0; border: none; border-top: 1px solid #e5e7eb;" />
        <p style="color: #6b7280; font-size: 12px;">
          This email was sent because a ${request_type === 'export' ? 'data export' : 'data deletion'} request was made for this email address.
          If you did not make this request, no action is required.
        </p>
      `;

      const emailResponse = await fetch('https://api.postmarkapp.com/email', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'X-Postmark-Server-Token': postmarkApiKey
        },
        body: JSON.stringify({
          From: 'noreply@bizzybee.ai',
          To: email,
          Subject: emailSubject,
          HtmlBody: emailBody,
          MessageStream: 'outbound'
        })
      });

      if (!emailResponse.ok) {
        const errorText = await emailResponse.text();
        console.error('Postmark error:', errorText);
        throw new Error('Failed to send verification email');
      }

      console.log('Verification email sent to:', email);
    } else {
      console.warn('POSTMARK_API_KEY not configured, skipping email');
      // In development, log the verification URL
      console.log('Verification URL:', verificationUrl);
    }

    // Log the request for audit
    await supabase.from('data_access_logs').insert({
      action: `gdpr_${request_type}_request`,
      customer_id: customer?.id || null,
      metadata: {
        email,
        request_type,
        reason,
        verification_pending: true
      }
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Verification email sent'
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error processing GDPR request:', error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
