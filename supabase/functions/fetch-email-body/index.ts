import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { AuthError, authErrorResponse, validateAuth } from '../_shared/auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email_id } = await req.clone().json();
    if (!email_id) {
      return new Response(JSON.stringify({ error: 'email_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get the email record with external_id and workspace_id
    const { data: email, error: emailError } = await supabase
      .from('email_import_queue')
      .select('id, external_id, workspace_id, body_html')
      .eq('id', email_id)
      .single();

    if (emailError || !email) {
      return new Response(JSON.stringify({ error: 'Email not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    await validateAuth(req, email.workspace_id);

    // If body_html already cached, return it
    if (email.body_html) {
      return new Response(JSON.stringify({ body_html: email.body_html }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!email.external_id) {
      return new Response(JSON.stringify({ error: 'No external_id for this email' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get the Aurinko access token for this workspace
    const { data: config, error: configError } = await supabase
      .from('email_provider_configs')
      .select('id')
      .eq('workspace_id', email.workspace_id)
      .maybeSingle();

    if (configError || !config) {
      return new Response(JSON.stringify({ error: 'No active email provider config found' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get decrypted access token
    const { data: accessToken, error: tokenError } = await supabase.rpc(
      'get_decrypted_access_token',
      { p_config_id: config.id },
    );

    if (tokenError || !accessToken) {
      return new Response(JSON.stringify({ error: 'Could not retrieve access token' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch full email from Aurinko
    console.log(`Fetching full email ${email.external_id} from Aurinko...`);
    const aurinkoResp = await fetch(
      `https://api.aurinko.io/v1/email/messages/${email.external_id}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      },
    );

    if (!aurinkoResp.ok) {
      const errText = await aurinkoResp.text();
      console.error(`Aurinko API error: ${aurinkoResp.status} - ${errText}`);
      return new Response(JSON.stringify({ error: `Aurinko API error: ${aurinkoResp.status}` }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const aurinkoData = await aurinkoResp.json();
    const htmlBody = aurinkoData.htmlBody || aurinkoData.body || null;

    if (htmlBody) {
      // Cache it back to the database
      await supabase.from('email_import_queue').update({ body_html: htmlBody }).eq('id', email_id);

      console.log(`Cached HTML body for email ${email_id} (${htmlBody.length} chars)`);
    }

    return new Response(JSON.stringify({ body_html: htmlBody }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return authErrorResponse(error);
    }
    console.error('[fetch-email-body] Error:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  }
});
