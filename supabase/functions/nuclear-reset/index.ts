import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type WarningCollector = string[];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function deleteByWorkspace(
  supabase: SupabaseClient,
  table: string,
  workspaceId: string,
  warnings: WarningCollector,
  options: { strict?: boolean; ignoreMissingTable?: boolean } = {},
) {
  const { error } = await supabase.from(table).delete().eq('workspace_id', workspaceId);
  if (!error) return;

  if (options.ignoreMissingTable && error.message.includes('Could not find the table')) {
    return;
  }

  if (options.strict) {
    throw new Error(`${table}: ${error.message}`);
  }

  warnings.push(`${table}: ${error.message}`);
}

async function deleteByIds(
  supabase: SupabaseClient,
  table: string,
  column: string,
  ids: string[],
  warnings: WarningCollector,
  options: { strict?: boolean; chunkSize?: number } = {},
) {
  if (!ids.length) return;

  const chunkSize = options.chunkSize ?? 200;

  for (let index = 0; index < ids.length; index += chunkSize) {
    const chunk = ids.slice(index, index + chunkSize);
    const { error } = await supabase.from(table).delete().in(column, chunk);
    if (!error) continue;

    if (options.strict) {
      throw new Error(`${table}: ${error.message}`);
    }

    warnings.push(`${table}: ${error.message}`);
    return;
  }
}

async function countRows(supabase: SupabaseClient, table: string, workspaceId: string) {
  const { count, error } = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId);

  if (error) {
    throw new Error(`${table}: ${error.message}`);
  }

  return count ?? 0;
}

async function countMessagesForConversationIds(
  supabase: SupabaseClient,
  conversationIds: string[],
) {
  if (!conversationIds.length) return 0;

  let total = 0;
  const chunkSize = 200;

  for (let index = 0; index < conversationIds.length; index += chunkSize) {
    const chunk = conversationIds.slice(index, index + chunkSize);
    const { count, error } = await supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .in('conversation_id', chunk);

    if (error) {
      throw new Error(`messages: ${error.message}`);
    }

    total += count ?? 0;
  }

  return total;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      throw new Error('Supabase environment is not configured');
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return jsonResponse({ error: 'Unauthorized - missing token' }, 401);
    }

    const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: authError,
    } = await userSupabase.auth.getUser();

    if (authError || !user) {
      console.error('[nuclear-reset] JWT validation failed:', authError);
      return jsonResponse({ error: 'Unauthorized - invalid token' }, 401);
    }

    const { workspaceId, confirm } = await req.json();

    if (!workspaceId) {
      return jsonResponse({ error: 'workspaceId is required' }, 400);
    }

    if (confirm !== 'CONFIRM_NUCLEAR_RESET') {
      return jsonResponse({ error: 'Must send confirm: "CONFIRM_NUCLEAR_RESET"' }, 400);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('workspace_id')
      .eq('id', user.id)
      .single();

    if (userError || !userData?.workspace_id) {
      console.error('[nuclear-reset] User workspace lookup failed:', userError);
      return jsonResponse({ error: 'User not associated with a workspace' }, 403);
    }

    if (workspaceId !== userData.workspace_id) {
      return jsonResponse({ error: 'Cannot reset a workspace you do not belong to' }, 403);
    }

    console.log(
      `[nuclear-reset] Starting direct server-side reset for workspace ${workspaceId} by user ${user.id}`,
    );

    const warnings: WarningCollector = [];

    const [conversationCount, customerCount] = await Promise.all([
      countRows(supabase, 'conversations', workspaceId),
      countRows(supabase, 'customers', workspaceId),
    ]);

    const { data: conversations, error: conversationsError } = await supabase
      .from('conversations')
      .select('id')
      .eq('workspace_id', workspaceId);

    if (conversationsError) {
      throw new Error(`conversations: ${conversationsError.message}`);
    }

    const conversationIds = (conversations ?? []).map((conversation) => conversation.id);
    const messageCount = await countMessagesForConversationIds(supabase, conversationIds);

    const { data: agentRuns, error: agentRunsError } = await supabase
      .from('agent_runs')
      .select('id')
      .eq('workspace_id', workspaceId);

    if (agentRunsError) {
      throw new Error(`agent_runs: ${agentRunsError.message}`);
    }

    const agentRunIds = (agentRuns ?? []).map((run) => run.id);

    const { data: documents, error: documentsError } = await supabase
      .from('documents')
      .select('id, file_path')
      .eq('workspace_id', workspaceId);

    if (documentsError) {
      warnings.push(`documents(select): ${documentsError.message}`);
    }

    const documentIds = (documents ?? []).map((document) => document.id);
    const documentPaths = (documents ?? [])
      .map((document) => document.file_path)
      .filter((path): path is string => Boolean(path));

    await deleteByWorkspace(supabase, 'message_events', workspaceId, warnings, {
      strict: true,
    });
    await deleteByIds(supabase, 'messages', 'conversation_id', conversationIds, warnings, {
      strict: true,
    });
    await deleteByWorkspace(supabase, 'conversation_pairs', workspaceId, warnings);
    await deleteByWorkspace(supabase, 'email_pairs', workspaceId, warnings);
    await deleteByWorkspace(supabase, 'draft_edits', workspaceId, warnings);

    await deleteByWorkspace(supabase, 'triage_corrections', workspaceId, warnings);
    await deleteByWorkspace(supabase, 'sender_behaviour_stats', workspaceId, warnings);
    await deleteByWorkspace(supabase, 'sender_rules', workspaceId, warnings);
    await deleteByWorkspace(supabase, 'classification_corrections', workspaceId, warnings);
    await deleteByWorkspace(supabase, 'correction_examples', workspaceId, warnings);
    await deleteByWorkspace(supabase, 'voice_profiles', workspaceId, warnings);
    await deleteByWorkspace(supabase, 'house_rules', workspaceId, warnings);

    await deleteByWorkspace(supabase, 'raw_emails', workspaceId, warnings, { strict: true });
    await deleteByWorkspace(supabase, 'email_import_queue', workspaceId, warnings, {
      strict: true,
    });
    await deleteByWorkspace(supabase, 'email_import_progress', workspaceId, warnings, {
      strict: true,
    });
    await deleteByWorkspace(supabase, 'email_import_jobs', workspaceId, warnings, {
      strict: true,
    });
    await deleteByWorkspace(supabase, 'email_fetch_retries', workspaceId, warnings);
    await deleteByWorkspace(supabase, 'pipeline_incidents', workspaceId, warnings);
    await deleteByWorkspace(supabase, 'pipeline_job_audit', workspaceId, warnings);
    await deleteByWorkspace(supabase, 'pipeline_runs', workspaceId, warnings);

    await deleteByWorkspace(supabase, 'faq_database', workspaceId, warnings, { strict: true });
    await deleteByWorkspace(supabase, 'example_responses', workspaceId, warnings, {
      ignoreMissingTable: true,
    });
    await deleteByWorkspace(supabase, 'business_facts', workspaceId, warnings);
    await deleteByWorkspace(supabase, 'price_list', workspaceId, warnings);
    await deleteByIds(supabase, 'document_chunks', 'document_id', documentIds, warnings);
    await deleteByWorkspace(supabase, 'documents', workspaceId, warnings);

    if (documentPaths.length) {
      const { error: storageError } = await supabase.storage
        .from('documents')
        .remove(documentPaths);

      if (storageError) {
        warnings.push(`documents(storage): ${storageError.message}`);
      }
    }

    await deleteByWorkspace(supabase, 'competitor_faq_candidates', workspaceId, warnings, {
      strict: true,
    });
    await deleteByWorkspace(supabase, 'competitor_faqs_raw', workspaceId, warnings, {
      strict: true,
    });
    await deleteByWorkspace(supabase, 'competitor_pages', workspaceId, warnings, {
      strict: true,
    });
    await deleteByWorkspace(supabase, 'competitor_sites', workspaceId, warnings, {
      strict: true,
    });
    await deleteByWorkspace(supabase, 'competitor_research_jobs', workspaceId, warnings, {
      strict: true,
    });
    await deleteByWorkspace(supabase, 'scraping_jobs', workspaceId, warnings, { strict: true });

    await deleteByWorkspace(supabase, 'agent_run_events', workspaceId, warnings);
    await deleteByIds(supabase, 'agent_run_artifacts', 'run_id', agentRunIds, warnings);
    await deleteByIds(supabase, 'agent_run_steps', 'run_id', agentRunIds, warnings);
    await deleteByWorkspace(supabase, 'agent_runs', workspaceId, warnings, { strict: true });

    await deleteByWorkspace(supabase, 'customers', workspaceId, warnings, { strict: true });
    await deleteByWorkspace(supabase, 'conversations', workspaceId, warnings, { strict: true });

    const { error: emailConfigError } = await supabase
      .from('email_provider_configs')
      .update({
        sync_status: 'pending',
        sync_stage: null,
        sync_progress: 0,
        sync_total: 0,
        inbound_emails_found: 0,
        outbound_emails_found: 0,
        inbound_total: 0,
        outbound_total: 0,
        threads_linked: 0,
        sync_started_at: null,
        sync_completed_at: null,
        sync_error: null,
        last_sync_at: null,
        active_job_id: null,
      })
      .eq('workspace_id', workspaceId);

    if (emailConfigError) {
      warnings.push(`email_provider_configs(update): ${emailConfigError.message}`);
    }

    await deleteByWorkspace(supabase, 'business_context', workspaceId, warnings);

    const { error: userResetError } = await supabase
      .from('users')
      .update({
        onboarding_completed: false,
        onboarding_step: 'welcome',
      })
      .eq('id', user.id);

    if (userResetError) {
      throw new Error(`users(update): ${userResetError.message}`);
    }

    console.log('[nuclear-reset] Reset complete', {
      workspaceId,
      warnings,
      messageCount,
      conversationCount,
      customerCount,
    });

    return jsonResponse({
      success: true,
      result: {
        success: true,
        wiped: true,
        messages_cleared: messageCount,
        conversations_cleared: conversationCount,
        customers_cleared: customerCount,
        warnings,
      },
    });
  } catch (error: any) {
    console.error('[nuclear-reset] Error:', error);
    return jsonResponse({ error: error?.message || 'Internal server error' }, 500);
  }
});
