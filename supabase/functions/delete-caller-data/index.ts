import { validateAuth, AuthError, authErrorResponse } from "../_shared/auth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    let auth;
    try {
      auth = await validateAuth(req);
    } catch (err) {
      if (err instanceof AuthError) return authErrorResponse(err);
      throw err;
    }

    const { workspaceId } = auth;
    const { phone_number } = await req.json();

    if (!phone_number || typeof phone_number !== 'string') {
      return new Response(
        JSON.stringify({ error: 'phone_number is required and must be a string.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Delete call logs for this caller in this workspace
    const { data: deletedRows, error: deleteError } = await supabase
      .from('call_logs')
      .delete()
      .eq('caller_number', phone_number)
      .eq('workspace_id', workspaceId)
      .select('id');

    if (deleteError) {
      throw new Error(`Failed to delete caller data: ${deleteError.message}`);
    }

    const deletedCount = deletedRows?.length ?? 0;

    console.log(`GDPR deletion: removed ${deletedCount} call log(s) for ${phone_number} in workspace ${workspaceId}`);

    return new Response(
      JSON.stringify({ deleted_count: deletedCount }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('delete-caller-data error:', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
