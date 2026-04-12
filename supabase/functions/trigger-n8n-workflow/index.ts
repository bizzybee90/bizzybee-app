const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const IMPORT_CAP_BY_MODE: Record<string, number> = {
  new_only: 250,
  last_1000: 1000,
  last_10000: 10000,
  last_30000: 10000,
  all_history: 10000,
};

function jsonResponse(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function invokeNativeFunction(
  functionName: string,
  authHeader: string | null,
  body: Record<string, unknown>,
) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  if (!supabaseUrl) {
    throw new Error('SUPABASE_URL is not configured');
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let data: Record<string, unknown> | null = null;
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    data = text ? { raw: text } : {};
  }

  return { response, data: data || {} };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (req.method !== 'POST') {
      return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
    }

    const body = (await req.json()) as Record<string, unknown>;
    const workflowType = String(body.workflow_type || '').trim();
    const workspaceId = String(body.workspace_id || body.workspaceId || '').trim();
    const authHeader = req.headers.get('Authorization');

    if (!workflowType) {
      return jsonResponse({ ok: false, error: 'workflow_type is required' }, 400);
    }

    const triggerSource = String(body.trigger_source || 'legacy_trigger_router').trim();

    if (
      ['competitor_discovery', 'own_website_scrape', 'faq_generation', 'email_import'].includes(
        workflowType,
      ) &&
      !workspaceId
    ) {
      return jsonResponse({ ok: false, error: 'workspace_id is required' }, 400);
    }

    switch (workflowType) {
      case 'competitor_discovery': {
        const { response, data } = await invokeNativeFunction(
          'start-onboarding-discovery',
          authHeader,
          {
            workspace_id: workspaceId,
            search_queries: body.search_queries,
            target_count: body.target_count,
            trigger_source: triggerSource,
          },
        );
        return jsonResponse(
          { ...data, success: response.ok, workflow: workflowType, legacy_router: true },
          response.status,
        );
      }
      case 'own_website_scrape': {
        const { response, data } = await invokeNativeFunction(
          'start-own-website-analysis',
          authHeader,
          {
            workspace_id: workspaceId,
            website_url: body.website_url || body.websiteUrl,
            trigger_source: triggerSource,
          },
        );
        return jsonResponse(
          { ...data, success: response.ok, workflow: workflowType, legacy_router: true },
          response.status,
        );
      }
      case 'faq_generation': {
        const { response, data } = await invokeNativeFunction('start-faq-generation', authHeader, {
          workspace_id: workspaceId,
          selected_competitor_ids: body.selected_competitor_ids || body.selectedCompetitorIds,
          target_count: body.target_count,
          trigger_source: triggerSource,
        });
        return jsonResponse(
          { ...data, success: response.ok, workflow: workflowType, legacy_router: true },
          response.status,
        );
      }
      case 'email_import': {
        const requestedMode = String(body.mode || '').trim();
        const mode =
          requestedMode === 'onboarding' || requestedMode === 'backfill'
            ? requestedMode
            : 'backfill';
        const importMode = String(body.import_mode || body.importMode || body.mode || '').trim();
        const { response, data } = await invokeNativeFunction('start-email-import', authHeader, {
          workspace_id: workspaceId,
          config_id: body.config_id || body.configId,
          mode,
          cap: IMPORT_CAP_BY_MODE[importMode] || undefined,
        });
        return jsonResponse(
          {
            ...data,
            success: response.ok,
            workflow: workflowType,
            legacy_router: true,
            queued: response.ok,
            messagesProcessed: 0,
          },
          response.status,
        );
      }
      case 'email_classification': {
        const { response, data } = await invokeNativeFunction('classify-conversation', authHeader, {
          workspace_id: workspaceId || body.workspace_id || body.workspaceId,
          conversation_id: body.conversation_id || body.conversationId,
        });
        return jsonResponse(
          { ...data, success: response.ok, legacy_router: true },
          response.status,
        );
      }
      default:
        return jsonResponse(
          {
            ok: false,
            retired: true,
            error: `Unsupported legacy workflow_type: ${workflowType}`,
          },
          410,
        );
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[trigger-n8n-workflow] compatibility router error:', message);
    return jsonResponse({ ok: false, error: message }, 500);
  }
});
