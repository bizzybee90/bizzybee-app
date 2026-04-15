import { createServiceClient, HttpError } from '../_shared/pipeline.ts';
import { AuthError, authErrorResponse, validateAuth } from '../_shared/auth.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function corsResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

type ManageAction = 'list' | 'toggle_selection' | 'bulk_set_selected' | 'delete' | 'rescrape';

type ManageBody = {
  action?: ManageAction;
  workspace_id?: string;
  job_id?: string | null;
  run_id?: string | null;
  competitor_id?: string;
  competitor_ids?: string[];
  is_selected?: boolean;
};

function normalizeIds(values: unknown): string[] {
  return Array.isArray(values)
    ? values.filter(
        (value): value is string => typeof value === 'string' && value.trim().length > 0,
      )
    : [];
}

async function listCompetitors(workspaceId: string, requestedJobId?: string | null) {
  const supabase = createServiceClient();

  let resolvedJobId = requestedJobId?.trim() || null;
  if (!resolvedJobId) {
    const { data: latestJob, error: latestJobError } = await supabase
      .from('competitor_research_jobs')
      .select('id')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestJobError) {
      throw new HttpError(500, `Failed to load competitor job: ${latestJobError.message}`);
    }

    resolvedJobId = latestJob?.id ?? null;
  }

  let query = supabase
    .from('competitor_sites')
    .select(
      'id, business_name, domain, url, rating, reviews_count, is_selected, discovery_source, validation_status, location_data, distance_miles, match_reason, relevance_score, scrape_status',
    )
    .eq('workspace_id', workspaceId)
    .not('status', 'eq', 'rejected')
    .order('distance_miles', { ascending: true, nullsFirst: false })
    .order('relevance_score', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });

  if (resolvedJobId) {
    query = query.eq('job_id', resolvedJobId);
  }

  const { data, error } = await query.limit(100);
  if (error) {
    throw new HttpError(500, `Failed to load competitors: ${error.message}`);
  }

  const competitors = data || [];
  const selectedCount = competitors.filter((row) => row.is_selected !== false).length;
  const persistedCount = competitors.length;

  return {
    ok: true,
    job_id: resolvedJobId,
    competitors,
    selected_count: selectedCount,
    persisted_count: persistedCount,
    loaded_from: 'persisted',
  };
}

async function mutateCompetitor(workspaceId: string, body: ManageBody) {
  const supabase = createServiceClient();

  if (body.action === 'toggle_selection') {
    if (!body.competitor_id || typeof body.is_selected !== 'boolean') {
      throw new HttpError(400, 'competitor_id and is_selected are required');
    }

    const { error } = await supabase
      .from('competitor_sites')
      .update({ is_selected: body.is_selected })
      .eq('workspace_id', workspaceId)
      .eq('id', body.competitor_id);

    if (error) {
      throw new HttpError(500, `Failed to update competitor selection: ${error.message}`);
    }

    return { ok: true };
  }

  if (body.action === 'bulk_set_selected') {
    const competitorIds = normalizeIds(body.competitor_ids);
    if (competitorIds.length === 0 || typeof body.is_selected !== 'boolean') {
      throw new HttpError(400, 'competitor_ids and is_selected are required');
    }

    const { error } = await supabase
      .from('competitor_sites')
      .update({ is_selected: body.is_selected })
      .eq('workspace_id', workspaceId)
      .in('id', competitorIds);

    if (error) {
      throw new HttpError(500, `Failed to update competitors: ${error.message}`);
    }

    return { ok: true };
  }

  if (body.action === 'delete') {
    if (!body.competitor_id) {
      throw new HttpError(400, 'competitor_id is required');
    }

    const { error } = await supabase
      .from('competitor_sites')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('id', body.competitor_id);

    if (error) {
      throw new HttpError(500, `Failed to delete competitor: ${error.message}`);
    }

    return { ok: true };
  }

  if (body.action === 'rescrape') {
    if (!body.competitor_id) {
      throw new HttpError(400, 'competitor_id is required');
    }

    const { error } = await supabase
      .from('competitor_sites')
      .update({ scrape_status: 'pending', scraped_at: null, pages_scraped: 0 })
      .eq('workspace_id', workspaceId)
      .eq('id', body.competitor_id);

    if (error) {
      throw new HttpError(500, `Failed to queue competitor re-scrape: ${error.message}`);
    }

    return { ok: true };
  }

  throw new HttpError(400, 'Unsupported action');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    if (req.method !== 'POST') {
      throw new HttpError(405, 'Method not allowed');
    }

    const body = (await req.json()) as ManageBody;
    const workspaceId = body.workspace_id?.trim();
    if (!workspaceId) {
      throw new HttpError(400, 'workspace_id is required');
    }

    try {
      await validateAuth(req, workspaceId);
    } catch (error) {
      if (error instanceof AuthError) return authErrorResponse(error);
      throw error;
    }

    if (body.action === 'list') {
      return corsResponse(await listCompetitors(workspaceId, body.job_id));
    }

    return corsResponse(await mutateCompetitor(workspaceId, body));
  } catch (error) {
    console.error('onboarding-competitors error', error);
    if (error instanceof HttpError) {
      return corsResponse({ ok: false, error: error.message }, error.status);
    }

    return corsResponse(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unexpected error',
      },
      500,
    );
  }
});
