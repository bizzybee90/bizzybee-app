import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { validateAuth, AuthError, authErrorResponse } from '../_shared/auth.ts';

/**
 * CLASSIFY-EMAILS-DISPATCHER
 *
 * Thin orchestrator that counts unclassified emails and fires N parallel
 * workers (email-classify-bulk) with partition parameters.
 * Returns immediately after dispatching.
 *
 * Called by n8n with: { workspace_id, callback_url }
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const EMAILS_PER_WORKER = 2500;
const MAX_WORKERS = 10;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { workspace_id, callback_url } = await req.json();

    if (!workspace_id) {
      return new Response(JSON.stringify({ error: 'workspace_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate auth — supports both user JWT and service-to-service calls
    try {
      await validateAuth(req, workspace_id);
    } catch (err) {
      if (err instanceof AuthError) return authErrorResponse(err);
      throw err;
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Count unclassified emails
    const { data: countResult, error: countError } = await supabase.rpc(
      'count_unclassified_emails',
      { p_workspace_id: workspace_id },
    );

    if (countError) throw countError;

    const totalEmails = Number(countResult) || 0;

    if (totalEmails === 0) {
      console.log('[dispatcher] No unclassified emails found');
      return new Response(
        JSON.stringify({
          status: 'no_work',
          total_emails: 0,
          message: 'No unclassified emails to process',
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    // Calculate worker count
    const workers = Math.min(Math.ceil(totalEmails / EMAILS_PER_WORKER), MAX_WORKERS);
    console.log(`[dispatcher] ${totalEmails} emails → dispatching ${workers} workers`);

    // Update progress
    await supabase.from('email_import_progress').upsert(
      {
        workspace_id,
        current_phase: 'classifying',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'workspace_id' },
    );

    // Fire N parallel workers (fire-and-forget)
    const bulkUrl = `${supabaseUrl}/functions/v1/email-classify-bulk`;
    for (let i = 0; i < workers; i++) {
      fetch(bulkUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({
          workspace_id,
          partition_id: i,
          total_partitions: workers,
          callback_url: callback_url || null,
        }),
      }).catch((e) => console.error(`[dispatcher] Failed to launch worker ${i}:`, e));
    }

    return new Response(
      JSON.stringify({
        status: 'dispatched',
        workers,
        total_emails: totalEmails,
        message: `Dispatched ${workers} parallel workers for ${totalEmails} emails`,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  } catch (error) {
    console.error('[dispatcher] Error:', error);
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
