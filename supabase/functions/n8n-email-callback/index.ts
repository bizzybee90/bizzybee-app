import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-n8n-signature',
};

async function verifyN8nSignature(
  payload: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  const computed = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  if (computed.length !== signature.length) return false;
  let result = 0;
  for (let i = 0; i < computed.length; i++) {
    result |= computed.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return result === 0;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const n8nSecret = Deno.env.get('N8N_WEBHOOK_SECRET');

    const rawBody = await req.text();

    // If the webhook secret is configured, signature verification is mandatory.
    const signature = req.headers.get('x-n8n-signature') || '';
    if (n8nSecret) {
      if (!signature) {
        console.error('[n8n-email-callback] Missing webhook signature');
        return new Response(JSON.stringify({ error: 'Missing signature' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (!(await verifyN8nSignature(rawBody, signature, n8nSecret))) {
        console.error('[n8n-email-callback] Invalid webhook signature');
        return new Response(JSON.stringify({ error: 'Invalid signature' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const body = JSON.parse(rawBody);
    const {
      workspace_id,
      status,
      message,
      total_emails,
      emails_imported,
      emails_classified,
      categories,
      error: errorMsg,
    } = body;

    if (!workspace_id) {
      return new Response(JSON.stringify({ error: 'workspace_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(
      `[n8n-email-callback] workspace=${workspace_id} status=${status} message=${message}`,
    );

    const details: Record<string, unknown> = {
      message,
      updated_at: new Date().toISOString(),
    };

    if (total_emails !== undefined) details.total_emails = total_emails;
    if (emails_imported !== undefined) details.emails_imported = emails_imported;
    if (emails_classified !== undefined) details.emails_classified = emails_classified;
    if (categories) details.categories = categories;
    if (errorMsg) details.error = errorMsg;

    const { error: upsertError } = await supabase.from('n8n_workflow_progress').upsert(
      {
        workspace_id,
        workflow_type: 'email_import',
        status: status || 'in_progress',
        details,
        updated_at: new Date().toISOString(),
        completed_at:
          status === 'complete' || status === 'classification_complete'
            ? new Date().toISOString()
            : null,
      },
      {
        onConflict: 'workspace_id,workflow_type',
      },
    );

    if (upsertError) {
      console.error('[n8n-email-callback] Upsert error:', upsertError);
      return new Response(JSON.stringify({ error: 'Failed to update progress' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true, status, workspace_id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[n8n-email-callback] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
